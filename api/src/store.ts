import { randomUUID } from 'node:crypto';
import { ACCOUNT_TYPES, type AccountType } from '@chat/shared';
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
    const row = this.rows.get(token);
    if (!row || row.revoked) return undefined;
    const { revoked: _revoked, ...rest } = row;
    return { ...rest };
  }

  set(token: string, session: StoredSession): this {
    this.rows.set(token, { ...session, revoked: false });
    return this;
  }

  revoke(token: string): void {
    const row = this.rows.get(token);
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
    return this.rows.delete(token);
  }
}

export class MemoryStore {
  sessions = new MemorySessionTable();
  conversations = new Map<string, StoredConversation>();
  messages = new MemoryMessageTable();
  sections = new MemorySectionTable();
  installations = new MemoryInstallationTable();
  accounts = new MemoryAccountTable(this.conversations, this.installations);
}
