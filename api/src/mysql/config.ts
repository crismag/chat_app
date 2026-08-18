export type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function falsy(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no';
}

function resolveSsl(host: string, sslEnv: string | undefined): boolean {
  if (falsy(sslEnv)) return false;
  if (truthy(sslEnv)) return true;
  return host !== '127.0.0.1' && host !== 'localhost';
}

/**
 * Read MariaDB/MySQL settings from the environment. Missing host/user/database
 * means this store is not configured; the SQLite demo path remains the live
 * application store until a later phase switches durable records over.
 */
export function readMysqlConfig(env: NodeJS.ProcessEnv = process.env): MysqlConfig | null {
  const host = env.MYSQL_HOST?.trim();
  const user = env.MYSQL_USER?.trim();
  const database = env.MYSQL_DATABASE?.trim();
  if (!host || !user || !database) return null;

  const password = env.MYSQL_PASSWORD ?? '';
  if (!password && !truthy(env.MYSQL_ALLOW_EMPTY_PASSWORD)) {
    throw new Error('MYSQL_PASSWORD is required when MYSQL_HOST is set');
  }

  return {
    host,
    port: Number(env.MYSQL_PORT ?? 3306),
    user,
    password,
    database,
    ssl: resolveSsl(host, env.MYSQL_SSL),
  };
}
