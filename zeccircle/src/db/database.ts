import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { migrations } from "./migrations.js";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  /** Rows changed by INSERT/UPDATE/DELETE, or rows returned by SELECT. */
  rowCount: number;
}

/** Something that can run SQL: a pool, a single connection inside a transaction, or a test database. */
export interface Executor {
  query(sql: string, params: unknown[]): Promise<QueryResult>;
  /** Runs a script of several statements (migrations). No parameters. */
  exec(script: string): Promise<void>;
}

/** Namespace for advisory locks so they never collide with other users of the same database. */
const LOCK_NAMESPACE_MIGRATIONS = 7301;
const LOCK_NAMESPACE_CIRCLE = 7302;
const LOCK_NAMESPACE_GLOBAL = 7303;
const LOCK_LIVE_SPEND = 1;

/** Converts "?" placeholders to Postgres "$1, $2, ...". The app's SQL never contains a literal "?". */
export const toPositional = (sql: string): string => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

/**
 * Async SQL access with transactions that follow the call chain.
 *
 * Inside `transaction(fn)`, every `query()` made anywhere in `fn` (including repositories and
 * services it calls) runs on the same connection, so callers never pass a transaction around.
 * Nested `transaction()` calls join the outer one.
 */
export abstract class Database {
  private readonly scope = new AsyncLocalStorage<Executor>();

  protected abstract root(): Executor;
  protected abstract withTransaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T>;
  abstract close(): Promise<void>;

  private current(): Executor {
    return this.scope.getStore() ?? this.root();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return (await this.current().query(toPositional(sql), params)) as QueryResult<T>;
  }

  exec(script: string): Promise<void> {
    return this.current().exec(script);
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) return fn();
    return this.withTransaction((executor) => this.scope.run(executor, fn));
  }

  /**
   * Holds an exclusive lock for one circle until the surrounding transaction ends. Every step that
   * moves or reserves money takes it first, so "check the balance, then spend it" cannot interleave
   * with another request for the same circle, even across several app instances.
   */
  async lockCircle(circleId: number): Promise<void> {
    if (!this.scope.getStore()) throw new Error("lockCircle must be called inside a transaction");
    await this.query("SELECT pg_advisory_xact_lock(?::int, ?::int)", [LOCK_NAMESPACE_CIRCLE, circleId]);
  }

  /**
   * Holds the deployment-wide lock on real (live) spending until the transaction ends, so the hard
   * spending ceiling is checked and reserved atomically across all circles and instances.
   */
  async lockLiveSpend(): Promise<void> {
    if (!this.scope.getStore()) throw new Error("lockLiveSpend must be called inside a transaction");
    await this.query("SELECT pg_advisory_xact_lock(?::int, ?::int)", [LOCK_NAMESPACE_GLOBAL, LOCK_LIVE_SPEND]);
  }

  /** Applies any migrations that have not run yet. Safe to call from several instances at once. */
  async migrate(): Promise<void> {
    await this.transaction(async () => {
      await this.query("SELECT pg_advisory_xact_lock(?::int, 0)", [LOCK_NAMESPACE_MIGRATIONS]);
      await this.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const { rows } = await this.query<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations");
      for (let version = rows[0]?.v ?? 0; version < migrations.length; version++) {
        await this.exec(migrations[version]!);
        await this.query("INSERT INTO schema_migrations (version) VALUES (?)", [version + 1]);
      }
    });
  }
}

/** Reads bigint/numeric as JS numbers (all our values stay far below 2^53) and timestamps as ISO strings. */
function configurePgTypes(): void {
  pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
  pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v: string) => new Date(v).toISOString());
}

/**
 * pg currently treats sslmode=require/prefer/verify-ca as verify-full and prints a warning about it.
 * Spell out verify-full (today's behaviour: encrypted and certificate-checked) so the warning goes away.
 */
function withExplicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/, "$1verify-full");
}

/** Production database: Postgres (e.g. Neon) over a small connection pool. */
export class PgDatabase extends Database {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, onPoolError: (error: Error) => void = () => undefined) {
    super();
    configurePgTypes();
    this.pool = new pg.Pool({
      connectionString: withExplicitSslMode(connectionString),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 20_000, // a suspended Neon database can take a few seconds to wake
    });
    // Idle connections get dropped by the server now and then; that must not crash the process.
    this.pool.on("error", onPoolError);
  }

  protected root(): Executor {
    return this.executorFor(this.pool);
  }

  protected async withTransaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(this.executorFor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private executorFor(target: pg.Pool | pg.PoolClient): Executor {
    return {
      query: async (sql, params) => {
        const result = await target.query(sql, params as unknown[]);
        return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
      },
      exec: async (script) => {
        await target.query(script);
      },
    };
  }
}
