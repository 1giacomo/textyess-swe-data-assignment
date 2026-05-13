import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/shopify";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  min: 2,
  max: 10,
});

export async function ping(): Promise<void> {
  await pool.query("SELECT 1");
}
