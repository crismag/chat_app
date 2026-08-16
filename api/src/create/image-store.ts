import type { DatabaseSync } from 'node:sqlite'

export interface StoredStudioImageAsset {
  id: string
  userId: string
  conversationId: string
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  width: number
  height: number
  provenance: Record<string, string | number | boolean | null>
  createdAt: string
}

export interface StudioImageAssetStore {
  get(id: string): StoredStudioImageAsset | null
  set(asset: StoredStudioImageAsset): void
}

class MemoryStudioImageAssetStore implements StudioImageAssetStore {
  private readonly rows = new Map<string, StoredStudioImageAsset>()

  get(id: string): StoredStudioImageAsset | null {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }

  set(asset: StoredStudioImageAsset): void {
    this.rows.set(asset.id, structuredClone(asset))
  }
}

class SqliteStudioImageAssetStore implements StudioImageAssetStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_image_assets (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        bytes BLOB NOT NULL,
        contentType TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        provenanceJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `)
  }

  get(id: string): StoredStudioImageAsset | null {
    const row = this.db.prepare('SELECT * FROM studio_image_assets WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row['id']),
      userId: String(row['userId']),
      conversationId: String(row['conversationId']),
      bytes: new Uint8Array(row['bytes'] as Uint8Array),
      contentType: String(row['contentType']) as StoredStudioImageAsset['contentType'],
      width: Number(row['width']),
      height: Number(row['height']),
      provenance: JSON.parse(String(row['provenanceJson'])) as StoredStudioImageAsset['provenance'],
      createdAt: String(row['createdAt']),
    }
  }

  set(asset: StoredStudioImageAsset): void {
    this.db.prepare(
      `INSERT INTO studio_image_assets
         (id, userId, conversationId, bytes, contentType, width, height, provenanceJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      asset.id,
      asset.userId,
      asset.conversationId,
      Buffer.from(asset.bytes),
      asset.contentType,
      asset.width,
      asset.height,
      JSON.stringify(asset.provenance),
      asset.createdAt,
    )
  }
}

/** Select host-owned durable storage without exposing it to Create Studio. */
export function createStudioImageAssetStore(store: unknown): StudioImageAssetStore {
  const db = (store as { db?: DatabaseSync }).db
  return db ? new SqliteStudioImageAssetStore(db) : new MemoryStudioImageAssetStore()
}
