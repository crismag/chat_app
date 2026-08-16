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
  userId: string;
  /** Which content format's rules this reflection is validated against. */
  format: 'full' | 'condensed';
  title: string;
  scriptureReference: string | null;
  publicationState: 'private' | 'published';
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
};

/**
 * A stored field of the artifact.
 *
 * The four C.H.A.T. sections and the two Condensed fields share this table as
 * separate rows — never the same row reused — so changing format can preserve
 * both drafts, which the format rules require in both directions.
 */
export type StoredSection = {
  type: 'context' | 'heart' | 'application' | 'testimony' | 'verse' | 'reflection';
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

export class MemoryStore {
  users = new Map<string, StoredUser>();
  usersByEmail = new Map<string, string>();
  sessions = new Map<string, StoredSession>();
  conversations = new Map<string, StoredConversation>();
  messages = new MemoryMessageTable();
  sections = new MemorySectionTable();
}
