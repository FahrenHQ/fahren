import { Pool, PoolClient, QueryConfig } from "pg";
import { PgBouncerPoolConfig } from "..";
import { TenantsSecrets, TenantsSecretsManager } from "@fahren/core";
import {
  PostgresSchemaManagement,
  PostgresSchemaManagementOptions,
  PostgresSchemaTenants,
} from "../../strategies/schema";

export type PgBouncerSchemaManagementOptions = PostgresSchemaManagementOptions;

export class PgBouncerSchemaManagement extends PostgresSchemaManagement {
  protected poolConfig: PgBouncerPoolConfig;

  constructor({
    options,
    pgBouncerPoolConfig,
    secrets,
    id,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    options?: PgBouncerSchemaManagementOptions;
    secrets: TenantsSecrets;
    id?: string;
  }) {
    super({ poolConfig: pgBouncerPoolConfig, options, secrets, id });
    this.poolConfig = pgBouncerPoolConfig;
  }

  async createTenant(tenantId: string): Promise<void> {
    await super.createTenant(tenantId);

    console.warn(
      "Tenant schema and role with login access created, but PgBouncer was not updated. " +
        "You must manually update PgBouncer to grant access to Postgres."
    );
  }
}

export class PgBouncerSchemaTenants extends PostgresSchemaTenants {
  protected tenantsSecretsManager: TenantsSecretsManager<
    PgBouncerPoolConfig & { schema: string }
  >;
  protected poolsMode: Map<string, string>;
  protected tenantsSchemas: Map<string, string>;

  constructor({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    super({ secrets, id });
    this.tenantsSecretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
    this.poolsMode = new Map();
    this.tenantsSchemas = new Map();
  }

  protected async getClientConfigFor(
    tenantId: string
  ): Promise<PgBouncerPoolConfig & { schema: string }> {
    return await this.tenantsSecretsManager.get(tenantId);
  }

  protected async initTenantPool(tenantId: string) {
    const poolConfig = await this.getClientConfigFor(tenantId);
    this.poolsMode.set(tenantId, poolConfig.poolMode);
    this.tenantsSchemas.set(tenantId, poolConfig.schema);
    const pool = new Pool(poolConfig);
    pool.on("error", (err) => {
      console.error(
        `Internal error in one of the clients of pool tenant ${tenantId}:`,
        err
      );
    });
    return pool;
  }

  /**
   * Get a client for a tenant.
   *
   * In `session_mode`, the client will be set up with the tenant's schema.
   *
   * In `transaction_mode`, the client will be in a transaction and will need to be committed or rolled back.
   *
   * **IMPORTANT**: In `transaction_mode`, it is discouraged to use `getClientFor` as the client will already be in a transaction and you'll need to manually commit and release it.
   *
   * @param tenantId - The ID of the tenant to get a client for
   * @returns A client for the tenant
   */
  async getClientFor(tenantId: string): Promise<PoolClient> {
    const pool =
      this.pools.get(tenantId) || (await this.initTenantPool(tenantId));
    const poolMode = this.poolsMode.get(tenantId);
    const schema = this.tenantsSchemas.get(tenantId);

    if (!poolMode) {
      throw new Error(
        "PG Bouncer mode is not present in the client configuration. This could be due to a corrupt configuration in the secrets provider."
      );
    } else if (poolMode !== "session_mode" && poolMode !== "transaction_mode") {
      throw new Error(
        "PG Bouncer mode has an incorrect value in the client configuration. This could be due to a corrupt configuration in the secrets provider."
      );
    }

    if (!schema) {
      throw new Error(
        "Schema is not present in the client configuration. This could be due to a corrupt configuration in the secrets provider."
      );
    }

    const client = await pool.connect();
    if (poolMode === "session_mode") {
      await client.query(`
          SELECT set_config('search_path', '${schema}', false);
        `);
    } else if (poolMode === "transaction_mode") {
      try {
        await client.query(`
            BEGIN;
            SELECT set_config('search_path', '${schema}', true);
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
      if (this.poolsMode.get(tenantId) === "transaction_mode") {
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
