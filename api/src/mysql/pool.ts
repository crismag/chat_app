import mysql from 'mysql2/promise';
import type { MysqlConfig } from './config.ts';

export function createMysqlPool(config: MysqlConfig): mysql.Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 8,
    namedPlaceholders: false,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    ssl: config.ssl ? {} : undefined,
  });
}

export type MysqlPool = mysql.Pool;
export type MysqlConnection = mysql.PoolConnection;
