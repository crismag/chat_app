import type { DatabaseSync } from 'node:sqlite';

export interface StudioExportMetadata {
  exportedAt: string;
  format: 'image/png';
  width: number;
  height: number;
}

export interface StoredStudioCreation {
  conversationId: string;
  document: unknown;
  templateId: string;
  templateVersion: number;
  assetReferences: string[];
  exportMetadata: StudioExportMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioCreationStore {
  get(conversationId: string): StoredStudioCreation | null;
  set(creation: StoredStudioCreation): void;
}

class MemoryStudioCreationStore implements StudioCreationStore {
  private readonly rows = new Map<string, StoredStudioCreation>();

  get(conversationId: string): StoredStudioCreation | null {
    const row = this.rows.get(conversationId);
    return row ? structuredClone(row) : null;
  }

  set(creation: StoredStudioCreation): void {
    this.rows.set(creation.conversationId, structuredClone(creation));
  }
}

class SqliteStudioCreationStore implements StudioCreationStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_creations (
        conversationId TEXT PRIMARY KEY
          REFERENCES conversations(id) ON DELETE CASCADE,
        documentJson TEXT NOT NULL,
        templateId TEXT NOT NULL,
        templateVersion INTEGER NOT NULL,
        assetReferencesJson TEXT NOT NULL,
        exportMetadataJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  get(conversationId: string): StoredStudioCreation | null {
    const row = this.db
      .prepare('SELECT * FROM studio_creations WHERE conversationId = ?')
      .get(conversationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      conversationId: String(row['conversationId']),
      document: JSON.parse(String(row['documentJson'])) as unknown,
      templateId: String(row['templateId']),
      templateVersion: Number(row['templateVersion']),
      assetReferences: JSON.parse(String(row['assetReferencesJson'])) as string[],
      exportMetadata: row['exportMetadataJson']
        ? (JSON.parse(String(row['exportMetadataJson'])) as StudioExportMetadata)
        : null,
      createdAt: String(row['createdAt']),
      updatedAt: String(row['updatedAt']),
    };
  }

  set(creation: StoredStudioCreation): void {
    this.db
      .prepare(
        `INSERT INTO studio_creations
           (conversationId, documentJson, templateId, templateVersion,
            assetReferencesJson, exportMetadataJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET
           documentJson = excluded.documentJson,
           templateId = excluded.templateId,
           templateVersion = excluded.templateVersion,
           assetReferencesJson = excluded.assetReferencesJson,
           exportMetadataJson = excluded.exportMetadataJson,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        creation.conversationId,
        JSON.stringify(creation.document),
        creation.templateId,
        creation.templateVersion,
        JSON.stringify(creation.assetReferences),
        creation.exportMetadata ? JSON.stringify(creation.exportMetadata) : null,
        creation.createdAt,
        creation.updatedAt,
      );
  }
}

/** Create host-owned Studio persistence using the application's active backing. */
export function createStudioCreationStore(store: unknown): StudioCreationStore {
  const db = (store as { db?: DatabaseSync }).db;
  return db ? new SqliteStudioCreationStore(db) : new MemoryStudioCreationStore();
}
