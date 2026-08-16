import type { StudioExportMetadata, StoredStudioCreation } from './store.ts';

const MAX_DOCUMENT_BYTES = 2_000_000;
const TEMPORARY_URL = /(?:x-amz-(?:credential|signature)|x-goog-signature|[?&](?:sig|signature|token)=)/i;
const EXECUTABLE_CONTENT = /(?:<script\b|javascript:|data:text\/html)/i;
const CREDENTIAL_KEY = /(?:password|secret|api[-_]?key|access[-_]?token|authorization)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inspect(value: unknown, key = ''): boolean {
  if (CREDENTIAL_KEY.test(key)) return false;
  if (typeof value === 'string') return !TEMPORARY_URL.test(value) && !EXECUTABLE_CONTENT.test(value);
  if (Array.isArray(value)) return value.every((item) => inspect(item));
  if (isRecord(value)) return Object.entries(value).every(([childKey, child]) => inspect(child, childKey));
  return true;
}

function readExportMetadata(value: unknown): StudioExportMetadata | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const { exportedAt, format, width, height } = value;
  if (
    typeof exportedAt !== 'string' ||
    Number.isNaN(Date.parse(exportedAt)) ||
    format !== 'image/png' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    Number(width) <= 0 ||
    Number(height) <= 0
  ) return undefined;
  return { exportedAt, format, width: Number(width), height: Number(height) };
}

function collectAssetReferences(document: Record<string, unknown>): string[] {
  const references = new Set<string>();
  const visit = (value: unknown, key = ''): void => {
    if (key === 'assetId' && typeof value === 'string') references.add(value);
    if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (isRecord(value)) Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(document);
  return [...references].sort();
}

/** Validate the untrusted persistence envelope before it reaches host storage. */
export function readStudioCreation(
  raw: unknown,
  conversationId: string,
  previous: StoredStudioCreation | null,
  now: string,
): StoredStudioCreation | null {
  if (!isRecord(raw) || !isRecord(raw['document']) || !isRecord(raw['template'])) return null;
  const document = raw['document'];
  const template = raw['template'];
  const encoded = JSON.stringify(document);
  if (
    new TextEncoder().encode(encoded).byteLength > MAX_DOCUMENT_BYTES ||
    document['schemaVersion'] !== 2 ||
    typeof document['id'] !== 'string' ||
    !Array.isArray(document['pages']) ||
    document['pages'].length === 0 ||
    !inspect(document)
  ) return null;
  if (
    typeof template['id'] !== 'string' ||
    template['id'].length === 0 ||
    template['id'].length > 120 ||
    !Number.isInteger(template['version']) ||
    Number(template['version']) < 1
  ) return null;
  const exportMetadata = Object.hasOwn(raw, 'exportMetadata')
    ? readExportMetadata(raw['exportMetadata'])
    : (previous?.exportMetadata ?? null);
  if (exportMetadata === undefined) return null;
  return {
    conversationId,
    document,
    templateId: template['id'],
    templateVersion: Number(template['version']),
    assetReferences: collectAssetReferences(document),
    exportMetadata,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}
