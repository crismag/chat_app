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

export type StoredSection = {
  type: 'context' | 'heart' | 'application' | 'testimony';
  content: string;
  authorOrigin: 'user' | 'ai_assisted' | 'ai_generated';
};

export class MemoryStore {
  users = new Map<string, StoredUser>();
  usersByEmail = new Map<string, string>();
  sessions = new Map<string, StoredSession>();
  conversations = new Map<string, StoredConversation>();
  messages = new Map<string, StoredMessage[]>();
  sections = new Map<string, Record<string, StoredSection>>();
}
