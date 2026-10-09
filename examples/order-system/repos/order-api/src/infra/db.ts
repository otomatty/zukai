import { Pool, PoolClient } from 'pg';
import { repository, Repository } from './repository';

// 接続プール。1タスクあたりの上限は、Aurora の最大接続数をタスク数で割って決めている。
const pool = new Pool({
  host: process.env.DB_HOST,
  database: 'orders',
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

export async function withTransaction<T>(work: (tx: Repository) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(repository(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
