import { Pool, QueryConfig } from "pg";
import { PgBouncerPoolConfig } from "..";
import { TenantsSecrets, TenantsSecretsManager } from "@fahren/core";
import {
  PostgresDatabaseManagementOptions,
  PostgresDatabaseManagement,
  PostgresDatabaseTenants,
} from "../../strategies/database";

export type PgBouncerDatabaseManagementOptions =
  PostgresDatabaseManagementOptions;

export class PgBouncerDatabaseManagement extends PostgresDatabaseManagement {
  protected poolConfig: PgBouncerPoolConfig;

  constructor({
    pgBouncerPoolConfig,
    options,
    secrets,
    id,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    options?: PgBouncerDatabaseManagementOptions;
    secrets: TenantsSecrets;
    id?: string;
  }) {
    super({ poolConfig: pgBouncerPoolConfig, options, secrets, id });
    this.poolConfig = pgBouncerPoolConfig;
  }

  async createTenant(tenantId: string) {
    if (this.poolConfig.poolMode === "transaction_mode") {
      throw new Error(
        "Tenant creation is not supported when pgBouncer is configured in transaction mode. Database creations are not possible inside transaction. Please use a different configuration and/or multi-tenant strategy."
      );
    }

    await super.createTenant(tenantId);

    console.warn(
      "Tenant database and role created, but PgBouncer was not updated. " +
        "You must manually update PgBouncer to grant access to the new database."
    );
  }

  async deleteTenant(tenantId: string): Promise<void> {
    if (this.poolConfig.poolMode === "transaction_mode") {
      throw new Error(
        "Tenant deletion is not supported when pgBouncer is configured in transaction mode. Database deletions are not possible inside transaction. Please use a different configuration and/or multi-tenant strategy."
      );
    }
    await super.deleteTenant(tenantId);
  }
}

export class PgBouncerDatabaseTenants extends PostgresDatabaseTenants {
  protected tenantsSecretsManager: TenantsSecretsManager<PgBouncerPoolConfig>;
  protected poolsMode: Map<string, string>;

  constructor({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    super({ secrets, id });
    this.tenantsSecretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
    this.poolsMode = new Map();
  }

  protected async getClientConfigFor(
    tenantId: string
  ): Promise<PgBouncerPoolConfig> {
    return await this.tenantsSecretsManager.get(tenantId);
  }

  async initTenantPool(tenantId: string) {
    const poolConfig = await this.getClientConfigFor(tenantId);
    this.poolsMode.set(tenantId, poolConfig.poolMode);
    const pool = new Pool(poolConfig);
    pool.on("error", (err) => {
      console.error(
        `Internal error in one of the clients of pool tenant ${tenantId}:`,
        err
      );
    });
    return pool;
  }

  async getClientFor(tenantId: string) {
    const pool =
      this.pools.get(tenantId) || (await this.initTenantPool(tenantId));
    const poolMode = this.poolsMode.get(tenantId);
    const client = await pool.connect();

    if (poolMode === "session_mode") {
      return client;
    } else if (poolMode === "transaction_mode") {
      try {
        await client.query(`BEGIN;`);
        return client;
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
  }

  async queryAs(
    tenantId: string,
    queryTextOrConfig: string | QueryConfig<unknown[]>,
    values?: unknown[] | undefined
  ) {
    const client = await this.getClientFor(tenantId);
    const poolMode = this.poolsMode.get(tenantId);

    try {
      if (poolMode === "transaction_mode") {
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
