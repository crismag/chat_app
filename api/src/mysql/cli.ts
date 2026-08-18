import { createMysqlPool } from './pool.ts';
import { readMysqlConfig } from './config.ts';
import { migrate } from './migrate.ts';

const config = readMysqlConfig();
if (!config) {
  console.error('MySQL is not configured. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE.');
  process.exit(1);
}

const pool = createMysqlPool(config);
try {
  const applied = await migrate(pool);
  console.log(
    applied.length === 0
      ? 'MySQL schema is already up to date.'
      : `Applied MySQL migrations: ${applied.join(', ')}`,
  );
} finally {
  await pool.end();
}
