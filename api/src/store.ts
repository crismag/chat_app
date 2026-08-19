import { randomUUID } from 'node:crypto';
export type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
};

export type StoredSession = {
  token: string;
  userId: string;
};

export type StoredConversation = {
  id: string;
  /*
   * Who it belongs to. Present from the first write, with or without an
   * account behind it. There is deliberately no `userId` here: an owner may
   * have an account attached, and a reflection does not care whether it does.
   */
  ownerId: string;
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

/** An owner: a person's work, with or without an account behind it. */
export type StoredOwner = {
  id: string;
  kind: 'anonymous' | 'user';
  userId: string | null;
  createdAt: string;
  claimedAt: string | null;
  expiresAt: string | null;
};

/**
 * The same owner surface as the SQLite table, in memory.
 *
 * `merge` moves reflections between owners, so it is given the conversations
 * it has to rewrite. Keeping the two implementations behaviourally identical
 * matters more here than usual: the tests run against this one and the product
 * runs against the other, and a merge that behaved differently would be a bug
 * nothing could catch.
 */
export class MemoryOwnerTable {
  private readonly rows = new Map<string, StoredOwner>();
  private readonly conversations: Map<string, StoredConversation>;

  constructor(conversations: Map<string, StoredConversation>) {
    this.conversations = conversations;
  }

  get(id: string): StoredOwner | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  forUser(userId: string): StoredOwner | undefined {
    for (const row of this.rows.values()) if (row.userId === userId) return { ...row };
    return undefined;
  }

  createAnonymous(expiresAt: string | null = null): StoredOwner {
    const owner: StoredOwner = {
      id: randomUUID(),
      kind: 'anonymous',
      userId: null,
      createdAt: new Date().toISOString(),
      claimedAt: null,
      expiresAt,
    };
    this.rows.set(owner.id, owner);
    return { ...owner };
  }

  createForUser(userId: string): StoredOwner {
    const now = new Date().toISOString();
    const owner: StoredOwner = {
      id: randomUUID(),
      kind: 'user',
      userId,
      createdAt: now,
      claimedAt: now,
      expiresAt: null,
    };
    this.rows.set(owner.id, owner);
    return { ...owner };
  }

  claim(ownerId: string, userId: string): StoredOwner | undefined {
    const row = this.rows.get(ownerId);
    if (!row || row.userId) return this.get(ownerId);
    row.kind = 'user';
    row.userId = userId;
    row.claimedAt = new Date().toISOString();
    row.expiresAt = null;
    return { ...row };
  }

  merge(fromOwnerId: string, intoOwnerId: string): void {
    if (fromOwnerId === intoOwnerId) return;
    for (const conversation of this.conversations.values()) {
      if (conversation.ownerId === fromOwnerId) conversation.ownerId = intoOwnerId;
    }
    const row = this.rows.get(fromOwnerId);
    if (row) {
      row.claimedAt = new Date().toISOString();
      row.expiresAt = null;
    }
  }
}

export class MemoryStore {
  users = new Map<string, StoredUser>();
  usersByEmail = new Map<string, string>();
  sessions = new Map<string, StoredSession>();
  conversations = new Map<string, StoredConversation>();
  messages = new MemoryMessageTable();
  sections = new MemorySectionTable();
  owners = new MemoryOwnerTable(this.conversations);
}
