import { PGlite, types } from "@electric-sql/pglite";
import { Database, type Executor } from "../src/db/database.js";

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

const executorFor = (target: Queryable): Executor => ({
  query: async (sql, params) => {
    const r = await target.query(sql, params);
    return { rows: r.rows as Record<string, unknown>[], rowCount: (r.affectedRows ?? 0) || r.rows.length };
  },
  exec: async (script) => {
    await target.exec(script);
  },
});

const TABLES = [
  "circles", "members", "invites", "purchases", "audit_log",
  "zec_funding_requests", "zec_circle_addresses", "zec_deposits", "zec_payments", "wallet_seed", "zec_swaps", "log_channels",
];

/**
 * Real Postgres running inside the test process (PGlite), so tests exercise the same SQL, constraints
 * and locking as production, with no server to start. Parsers match the production driver's.
 */
export class PgliteDatabase extends Database {
  private constructor(private readonly lite: PGlite) {
    super();
  }

  static async create(): Promise<PgliteDatabase> {
    const lite = new PGlite({
      parsers: {
        [types.INT8]: (v: string) => Number(v),
        [types.NUMERIC]: (v: string) => Number(v),
        [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
      },
    });
    const db = new PgliteDatabase(lite);
    await db.migrate();
    return db;
  }

  protected root(): Executor {
    return executorFor(this.lite as unknown as Queryable);
  }

  protected withTransaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    return this.lite.transaction((tx) => fn(executorFor(tx as unknown as Queryable)));
  }

  /** Empties every table so each test starts clean. */
  async reset(): Promise<void> {
    await this.lite.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  }

  async close(): Promise<void> {
    await this.lite.close();
  }
}

let shared: Promise<PgliteDatabase> | null = null;

/** One database per test file (module state is isolated per file), reset before each use. */
export async function freshDatabase(): Promise<PgliteDatabase> {
  shared ??= PgliteDatabase.create();
  const db = await shared;
  await db.reset();
  return db;
}
