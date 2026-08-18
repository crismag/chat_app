import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_CENTRAL_TABLES, FORBIDDEN_USAGE_COLUMNS } from './privacy.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('MySQL schema privacy boundary', () => {
  it('does not create central tables for AI conversation content', () => {
    const sql = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
      .join('\n')
      .toLowerCase();

    for (const table of FORBIDDEN_CENTRAL_TABLES) {
      expect(sql, `must not create ${table}`).not.toMatch(
        new RegExp(`create\\s+table\\s+${table}\\b`),
      );
    }

    expect(sql).toContain('create table users');
    expect(sql).toContain('create table reflections');
    expect(sql).toContain('create table ai_usage_events');
    expect(sql).not.toMatch(/prompt\s+(text|varchar|json)/i);
    expect(sql).not.toMatch(/conversation_transcript/);
  });

  it('keeps usage telemetry free of conversation column names', () => {
    const sql = readFileSync(join(migrationsDir, '001_foundation.sql'), 'utf8');
    const usageBlock = sql.slice(
      sql.indexOf('CREATE TABLE ai_usage_events'),
      sql.indexOf('CREATE TABLE ai_usage_daily'),
    );
    for (const column of FORBIDDEN_USAGE_COLUMNS) {
      expect(usageBlock.toLowerCase()).not.toContain(` ${column} `);
    }
  });
});
