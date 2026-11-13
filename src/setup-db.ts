import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPool } from "./postgres";

async function setup(): Promise<void> {
  const pool = openPool();
  try {
    for (const file of ["schema.sql", "seed.sql"]) {
      const sql = await readFile(resolve(__dirname, "../../sql", file), "utf8");
      await pool.query(sql);
    }
    console.log("PostgreSQL schema and demo users are ready");
  } finally {
    await pool.end();
  }
}

void setup().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
