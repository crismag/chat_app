import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_CENTRAL_TABLES, FORBIDDEN_USAGE_COLUMNS } from './privacy.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('MySQL schema privacy boundary', () => {
  it('does not create a second, unreachable copy of what people wrote', () => {
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
    expect(sql).not.toMatch(/conversation_transcript/);
  });

  /*
   * The conversation IS stored now, and the Privacy Policy says so. What this
   * asserts is that it is stored in one place the author owns and can delete —
   * cascading from their reflection — rather than copied somewhere they cannot
   * reach.
   */
  it('keeps the conversation with the reflection it belongs to', () => {
    const sql = readFileSync(join(migrationsDir, '004_reflection_messages.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE reflection_messages/);
    expect(sql).toMatch(/REFERENCES reflections\(id\)\s*\n\s*ON DELETE CASCADE/);
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
