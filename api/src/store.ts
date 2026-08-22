import { randomUUID } from 'node:crypto';
import { ACCOUNT_TYPES, type AccountType } from '@chat/shared';
import { hashSessionToken } from './mysql/tokens.ts';
import type { RevokedSession, StoredSessionSummary } from './auth/store.ts';
/**
 * An account, whichever kind it is.
 *
 * Guests and registered users are the same record with different fields
 * filled in -- which is the point. `email` and `passwordHash` are null for a
 * guest, `guestName` survives registration, and `accountType` is the fact
 * itself rather than something inferred from the nulls.
 */
export type StoredAccount = {
  id: string;
  accountType: AccountType;
  email: string | null;
  passwordHash: string | null;
  emailVerifiedAt: string | null;
  displayName: string | null;
  guestName: string | null;
  registeredAt: string | null;
  createdAt: string | null;
  /** Set when this guest's work was moved into an account that existed. */
  mergedIntoUserId: string | null;
};

/** Where an account came from, as it is written to a row. */
export type StoredCreationContext = {
  creationMethod: string;
  creationSource: string;
  platform: string;
  deviceClass: string;
};

export type StoredSession = {
  token: string;
  userId: string;
  /** Which browser established it, when one is durably recognised. */
  installationId?: string | null;
  /** GUEST, REGISTERED_TEMPORARY, or REGISTERED_PERSISTENT. */
  sessionType?: string;
};

/**
 * A browser or app that is durably recognised as belonging to an account.
 *
 * Separate from a session on purpose. A session is the current authorised
 * interaction; this is recognition, and for a guest it is the only thing
 * between them and losing what they have written -- which is why signing out
 * must not touch it, and why forgetting it is its own deliberate action.
 */
export type StoredInstallation = {
  id: string;
  userId: string;
  installationId: string;
  credentialHash: string;
  persistenceType: string;
};

export type StoredInstallationInput = {
  userId: string;
  installationId: string;
  credentialHash: string;
  platform: string;
  persistenceType: string;
  deviceClass?: string | null;
  browserFamily?: string | null;
  osFamily?: string | null;
};

export type StoredConversation = {
  id: string;
  /*
   * Who wrote it. A guest's id and a registered user's id are the same kind of
   * thing, so a reflection never has to be told which sort of person made it,
   * and registering changes nothing here at all.
   */
  userId: string;
  /** Which content format's rules this reflection is validated against. */
  format: 'full' | 'condensed';
  title: string;
  scriptureReference: string | null;
  visibility: 'private' | 'shared';
  tags: { tag: string; label: string }[];
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  originalContent: string;
  authorOrigin: 'user' | 'ai_assisted' | 'ai_generated';
  createdAt: string;
  /**
   * A generated draft hanging off this reply, and the section it is offered for.
   *
   * Stored rather than held in the browser, because a draft that vanishes on
   * reload leaves a lead-in sentence pointing at nothing — which is exactly the
   * "transcript embedded in a form" feeling this work exists to remove.
   *
   * `draftSection` is written by trusted application code (see
   * `ai/draft-target.ts`), never by anything the model said. It may be null: a
   * draft whose destination could not be resolved is still a perfectly good
   * draft, and the interface asks the author where it belongs.
   */
  draftText?: string | null;
  draftSection?: string | null;
};

/**
 * A stored field of the artifact.
 *
 * The four C.H.A.T. sections and the two Condensed fields share this table as
 * separate rows — never the same row reused — so changing format can preserve
 * both drafts, which the format rules require in both directions.
 */
export type StoredSection = {
  type: 'content' | 'heart' | 'application' | 'testimony' | 'verse' | 'reflection';
  content: string;
  authorOrigin: 'user' | 'ai_assisted' | 'ai_generated';
};

/**
 * Sections, written one field at a time.
 *
 * `set` merges, exactly as the SQLite table's upsert does. The two backings
 * disagreeing about what `set` meant is precisely how a section write could
 * destroy the fields it was not writing: the same call merged in one store and
 * replaced in the other, and the tests ran against the forgiving one.
 */
export class MemorySectionTable {
  private readonly rows = new Map<string, Record<string, StoredSection>>();

  get(conversationId: string): Record<string, StoredSection> | undefined {
    const row = this.rows.get(conversationId);
    return row ? { ...row } : undefined;
  }

  set(conversationId: string, sections: Record<string, StoredSection>): this {
    this.rows.set(conversationId, { ...this.rows.get(conversationId), ...sections });
    return this;
  }

  delete(conversationId: string): boolean {
    return this.rows.delete(conversationId);
  }
}

/** Messages, with the same surface — and the same `append` — as the table. */
export class MemoryMessageTable {
  private readonly rows = new Map<string, StoredMessage[]>();

  get(conversationId: string): StoredMessage[] | undefined {
    const row = this.rows.get(conversationId);
    return row ? [...row] : undefined;
  }

  set(conversationId: string, messages: StoredMessage[]): this {
    this.rows.set(conversationId, [...messages]);
    return this;
  }

  append(conversationId: string, message: StoredMessage): this {
    this.rows.set(conversationId, [...(this.rows.get(conversationId) ?? []), message]);
    return this;
  }

  delete(conversationId: string): boolean {
    return this.rows.delete(conversationId);
  }
}

/**
 * The account surface the SQLite tables have, in memory.
 *
 * Kept behaviourally identical on purpose. The suite runs against this one and
 * the product runs against the other, so a difference here -- especially in
 * `merge`, which moves reflections -- would be a bug nothing could catch.
 */
export class MemoryAccountTable {
  private readonly rows = new Map<string, StoredAccount>();
  private readonly sequences = new Map<string, number>();
  private readonly conversations: Map<string, StoredConversation>;
  private readonly installations: MemoryInstallationTable;

  constructor(
    conversations: Map<string, StoredConversation>,
    installations: MemoryInstallationTable,
  ) {
    this.conversations = conversations;
    this.installations = installations;
  }

  get(id: string): StoredAccount | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  byEmail(email: string): StoredAccount | undefined {
    for (const row of this.rows.values()) if (row.email === email) return { ...row };
    return undefined;
  }

  private static blank(id: string, accountType: AccountType): StoredAccount {
    return {
      id,
      accountType,
      email: null,
      passwordHash: null,
      emailVerifiedAt: null,
      displayName: null,
      guestName: null,
      registeredAt: null,
      createdAt: new Date().toISOString(),
      mergedIntoUserId: null,
    };
  }

  createRegistered(email: string, passwordHash: string): StoredAccount {
    const row = MemoryAccountTable.blank(randomUUID(), ACCOUNT_TYPES.REGISTERED);
    row.email = email;
    row.passwordHash = passwordHash;
    row.registeredAt = new Date().toISOString();
    this.rows.set(row.id, row);
    return { ...row };
  }

  createGuest(name: string): StoredAccount {
    const row = MemoryAccountTable.blank(randomUUID(), ACCOUNT_TYPES.ANONYMOUS);
    row.guestName = name;
    this.rows.set(row.id, row);
    return { ...row };
  }

  claim(id: string, email: string, passwordHash: string): StoredAccount | undefined {
    const row = this.rows.get(id);
    if (!row || row.accountType !== ACCOUNT_TYPES.ANONYMOUS) return undefined;
    row.accountType = ACCOUNT_TYPES.REGISTERED;
    row.email = email;
    row.passwordHash = passwordHash;
    row.registeredAt = new Date().toISOString();
    return { ...row };
  }

  /** A registered account reached through a provider, with no password. */
  createForIdentity(email: string | null): StoredAccount {
    const free = email && !this.byEmail(email) ? email : null;
    return this.createRegistered(free ?? `identity+${randomUUID()}@invalid.local`, '');
  }

  /** The same upgrade as `claim`, without a password to set. */
  claimForIdentity(id: string, email: string | null): StoredAccount | undefined {
    const row = this.rows.get(id);
    if (!row || row.accountType !== ACCOUNT_TYPES.ANONYMOUS) return undefined;
    const taken = email ? this.byEmail(email) : undefined;
    row.accountType = ACCOUNT_TYPES.REGISTERED;
    if (email && (!taken || taken.id === id)) row.email = email;
    row.registeredAt = new Date().toISOString();
    return { ...row };
  }

  setPassword(id: string, passwordHash: string): void {
    const row = this.rows.get(id);
    if (row) row.passwordHash = passwordHash;
  }

  setEmailVerified(id: string, at = new Date().toISOString()): void {
    const row = this.rows.get(id);
    if (row) row.emailVerifiedAt = at;
  }

  touch(): void {
    /* Last-seen is a column in the table and nothing reads it back. */
  }

  merge(fromUserId: string, intoUserId: string): number {
    if (fromUserId === intoUserId) return 0;
    let moved = 0;
    for (const conversation of this.conversations.values()) {
      if (conversation.userId === fromUserId) {
        conversation.userId = intoUserId;
        moved += 1;
      }
    }
    const row = this.rows.get(fromUserId);
    if (row) row.mergedIntoUserId = intoUserId;
    this.installations.revokeForUser(fromUserId);
    return moved;
  }

  nextGuestSequence(baseName: string): number {
    const next = this.sequences.get(baseName) ?? 1;
    this.sequences.set(baseName, next + 1);
    return next;
  }
}

/** Installations in memory, stored as hashes exactly as the table does. */
export class MemoryInstallationTable {
  private readonly rows = new Map<string, StoredInstallation & { revoked: boolean }>();

  create(input: StoredInstallationInput): string {
    const id = randomUUID();
    this.rows.set(input.installationId, {
      id,
      userId: input.userId,
      installationId: input.installationId,
      credentialHash: input.credentialHash,
      persistenceType: input.persistenceType,
      revoked: false,
    });
    return id;
  }

  find(installationId: string): StoredInstallation | undefined {
    const row = this.rows.get(installationId);
    if (!row || row.revoked) return undefined;
    const { revoked: _revoked, ...rest } = row;
    return { ...rest };
  }

  touch(): void {
    /* Last-seen is a column in the table and nothing reads it back. */
  }

  revoke(installationId: string): void {
    const row = this.rows.get(installationId);
    if (row) row.revoked = true;
  }

  revokeForUser(userId: string): void {
    for (const row of this.rows.values()) if (row.userId === userId) row.revoked = true;
  }
}

/** Sessions in memory, revocable in the same way the table's are. */
export class MemorySessionTable {
  private readonly rows = new Map<string, StoredSession & { revoked: boolean }>();

  get(token: string): StoredSession | undefined {
    const hashed = hashSessionToken(token);
    const row = this.rows.get(hashed) ?? this.rows.get(token);
    if (!row || row.revoked) return undefined;
    const { revoked: _revoked, ...rest } = row;
    return { ...rest, token };
  }

  set(token: string, session: StoredSession): this {
    this.rows.set(hashSessionToken(token), { ...session, token, revoked: false });
    return this;
  }

  revoke(token: string): void {
    const hashed = hashSessionToken(token);
    const row = this.rows.get(hashed) ?? this.rows.get(token);
    if (row) row.revoked = true;
  }

  revokeForUser(userId: string): void {
    for (const row of this.rows.values()) if (row.userId === userId) row.revoked = true;
  }

  revokeForInstallation(installationId: string): void {
    for (const row of this.rows.values()) {
      if (row.installationId === installationId) row.revoked = true;
    }
  }

  delete(token: string): boolean {
    const hashed = hashSessionToken(token);
    const byHash = this.rows.delete(hashed);
    const byRaw = this.rows.delete(token);
    return byHash || byRaw;
  }

  /*
   * Session management, in memory. The device facts are null here because
   * nothing records them in this implementation — which is honest: a null
   * platform renders as "Unknown device" rather than inventing one.
   */
  listForUser(userId: string): StoredSessionSummary[] {
    return [...this.rows.entries()]
      .filter(([, row]) => row.userId === userId && !row.revoked)
      .map(([id, row]) => ({
        id,
        sessionType: row.sessionType ?? 'REGISTERED_TEMPORARY',
        createdAt: null,
        lastSeenAt: null,
        expiresAt: Date.now(),
        platform: null,
        deviceClass: null,
        browserFamily: null,
        osFamily: null,
      }));
  }

  revokeById(userId: string, id: string): RevokedSession | null {
    const row = this.rows.get(id);
    /* Scoped by owner, so another account's id simply does not match. */
    if (!row || row.userId !== userId || row.revoked) return null;
    row.revoked = true;
    return {
      installationId: row.installationId ?? null,
      sessionType: row.sessionType ?? 'REGISTERED_TEMPORARY',
    };
  }

  revokeOthersForUser(userId: string, exceptToken: string): RevokedSession[] {
    const keep = hashSessionToken(exceptToken);
    const revoked: RevokedSession[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (row.userId !== userId || id === keep || row.revoked) continue;
      row.revoked = true;
      revoked.push({
        installationId: row.installationId ?? null,
        sessionType: row.sessionType ?? 'REGISTERED_TEMPORARY',
      });
    }
    return revoked;
  }
}

/** Pending resets in memory, with the same surface the table has. */
export class MemoryPasswordResetTable {
  private readonly rows = new Map<
    string,
    { id: string; userId: string; expiresAt: number; used: boolean }
  >();

  create(userId: string, tokenHash: string, expiresAt: number): void {
    this.rows.set(tokenHash, { id: randomUUID(), userId, expiresAt, used: false });
  }

  live(tokenHash: string): { id: string; userId: string } | undefined {
    const row = this.rows.get(tokenHash);
    if (!row || row.used || row.expiresAt <= Date.now()) return undefined;
    return { id: row.id, userId: row.userId };
  }

  use(id: string): void {
    for (const row of this.rows.values()) if (row.id === id) row.used = true;
  }

  spendOthers(userId: string): void {
    for (const row of this.rows.values()) if (row.userId === userId) row.used = true;
  }
}

/**
 * The in-memory twin of the verifications table.
 *
 * Separate from the reset table for the same reason it is separate in SQLite:
 * a token that could do both would let a link sent to prove an address also
 * change the password on it.
 */
export class MemoryEmailVerificationTable {
  private readonly rows = new Map<
    string,
    { id: string; userId: string; expiresAt: number; used: boolean }
  >();

  create(userId: string, tokenHash: string, expiresAt: number): void {
    /* Asking again supersedes the last one; nobody holds two live keys. */
    for (const row of this.rows.values()) if (row.userId === userId) row.used = true;
    this.rows.set(tokenHash, { id: randomUUID(), userId, expiresAt, used: false });
  }

  live(tokenHash: string): { id: string; userId: string } | undefined {
    const row = this.rows.get(tokenHash);
    if (!row || row.used || row.expiresAt <= Date.now()) return undefined;
    return { id: row.id, userId: row.userId };
  }

  use(id: string): void {
    for (const row of this.rows.values()) if (row.id === id) row.used = true;
  }
}

/** The in-memory twin of the SQLite identity table; see db.ts for the rules. */
export class MemoryIdentityTable {
  private readonly rows = new Map<string, { userId: string; email: string | null }>();

  private static key(provider: string, providerUserId: string): string {
    return `${provider}::${providerUserId}`;
  }

  byProvider(provider: string, providerUserId: string): { userId: string } | undefined {
    const found = this.rows.get(MemoryIdentityTable.key(provider, providerUserId));
    return found ? { userId: found.userId } : undefined;
  }

  link(input: {
    userId: string;
    provider: string;
    providerUserId: string;
    email: string | null;
  }): boolean {
    const key = MemoryIdentityTable.key(input.provider, input.providerUserId);
    /* The unique key, kept honestly: a second link cannot replace the first. */
    if (this.rows.has(key)) return false;
    this.rows.set(key, { userId: input.userId, email: input.email });
    return true;
  }

  touch(provider: string, providerUserId: string, email: string | null): void {
    const found = this.rows.get(MemoryIdentityTable.key(provider, providerUserId));
    if (found && email) found.email = email;
  }
}

export class MemoryStore {
  identities = new MemoryIdentityTable();
  sessions = new MemorySessionTable();
  passwordResets = new MemoryPasswordResetTable();
  emailVerifications = new MemoryEmailVerificationTable();
  conversations = new Map<string, StoredConversation>();
  messages = new MemoryMessageTable();
  sections = new MemorySectionTable();
  installations = new MemoryInstallationTable();
  accounts = new MemoryAccountTable(this.conversations, this.installations);
}
