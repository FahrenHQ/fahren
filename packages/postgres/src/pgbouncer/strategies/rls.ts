import { Pool, QueryConfig } from "pg";
import { PgBouncerPoolConfig } from "..";
import {
  PostgresRlsManagement,
  PostgresRlsManagementOptions,
  PostgresRlsTenants,
} from "../../strategies/rls";
import {
  DEFAULT_SETTINGS_TENANT_FIELD,
  DEFAULT_ROLE,
} from "../../strategies/base";

export type PgBouncerRlsManagementOptions = PostgresRlsManagementOptions;

export interface Table {
  name: string;
  schema?: string;
  index?: boolean;
  tenantIdColumn?: string;
}

export class PgBouncerRlsManagement extends PostgresRlsManagement {
  protected poolConfig: PgBouncerPoolConfig;

  constructor({
    pgBouncerPoolConfig,
    id,
    options,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    id?: string;
    options?: PgBouncerRlsManagementOptions;
  }) {
    super({ poolConfig: pgBouncerPoolConfig, id, options });
    this.poolConfig = pgBouncerPoolConfig;
  }

  async setup(tables?: Array<Table>): Promise<void> {
    await super.setup(tables);

    console.warn(
      "Tenant role with login access created, but PgBouncer was not updated. " +
        "You must manually update PgBouncer to grant access to Postgres."
    );
  }

  async createTenant(tenantId: string): Promise<boolean> {
    const tenantCreated = await super.createTenant(tenantId);

    if (tenantCreated) {
      console.warn(
        "Tenant schema and role with login access created, but PgBouncer was not updated. " +
          "You must manually update PgBouncer to grant access to Postgres."
      );
    }

    return tenantCreated;
  }
}

export class PgBouncerRlsTenants extends PostgresRlsTenants {
  protected poolMode?: "session_mode" | "transaction_mode";

  constructor({
    id,
    poolConfig,
  }: {
    id?: string;
    poolConfig: PgBouncerPoolConfig;
  }) {
    super({ id, poolConfig });
    this.pool = new Pool(poolConfig);
    this.poolMode = poolConfig.poolMode;
  }

  async getClientFor(id: string) {
    const client = await this.pool.connect();

    if (this.poolMode === "session_mode") {
      await client.query(`
        SELECT set_config('${DEFAULT_SETTINGS_TENANT_FIELD}', '${id}', false);
        SELECT set_config('role', '${DEFAULT_ROLE}', false);
      `);
    } else if (this.poolMode === "transaction_mode") {
      try {
        await client.query(`
          BEGIN;
          SELECT set_config('${DEFAULT_SETTINGS_TENANT_FIELD}', '${id}', true);
          SELECT set_config('role', '${DEFAULT_ROLE}', true);
        `);
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          console.error("Error during rollback:", rollbackErr);
        } finally {
          client.release();
        }
        throw err;
      }
    } else {
      throw new Error("Invalid mode");
    }

    return client;
  }

  async queryAs(
    tenantId: string,
    queryTextOrConfig: string | QueryConfig<unknown[]>,
    values?: unknown[] | undefined
  ) {
    const client = await this.getClientFor(tenantId);

    try {
      if (this.poolMode === "transaction_mode") {
        try {
          const res = await client.query(queryTextOrConfig, values);
          await client.query("COMMIT;");
          return res;
        } catch (err) {
          try {
            await client.query("ROLLBACK;");
          } catch (rollbackErr) {
            console.error("Error during rollback:", rollbackErr);
          }
          throw err;
        }
      } else {
        return await client.query(queryTextOrConfig, values);
      }
    } finally {
      await client.release();
    }
  }
}
