import { Client, Pool, PoolClient, PoolConfig } from "pg";
import {
  DEFAULT_TENANT_SCHEMA_PREFIX,
  PostgresResource,
  PostgresTenantsBase,
} from "./base";
import {
  ResourceOptionsWithSecrets,
  TenantsSecrets,
  TenantsSecretsManager,
} from "@fahren/core";

interface Provision {
  role?: {
    /**
     * The role prefix to use for role names.
     * @default DEFAULT_TENANT_ROLE_PREFIX
     */
    prefix?: string;

    /**
     * Function that generates a password for the tenant's database role.
     *
     * IMPORTANT: Each tenant should have a unique password for security isolation.
     * Reusing passwords across tenants creates a serious security vulnerability
     * where a compromise of one tenant could lead to unauthorized access to other tenants.
     *
     * Best practices:
     * - Generate strong, random passwords (at least 16 characters)
     * - Never reuse passwords across tenants
     * - Don't hardcode or store passwords in your application code
     *
     * If not provided, Fahren will automatically generate a secure random password.
     *
     * @returns A string containing the password or a Promise that resolves to the password
     */
    generatePassword?: (tenantId: string) => string | Promise<string>;
  };

  /**
   * Properties for new schemas.
   */
  schema?: {
    /**
     * The schema prefix to use for schema names.
     * @default DEFAULT_TENANT_SCHEMA_PREFIX
     */
    prefix?: string;
  };
}

export interface PostgresSchemaManagementOptions
  extends Omit<
    ResourceOptionsWithSecrets,
    "deprovision" | "identityAccessControl" | "secrets"
  > {
  provision?: Provision;
}

export class PostgresSchemaManagement extends PostgresResource {
  protected poolConfig: PoolConfig;
  protected pool: Pool;
  protected options: Required<PostgresSchemaManagementOptions>;
  protected secretsManager: TenantsSecretsManager<
    PoolConfig & { schema: string }
  >;

  constructor({
    poolConfig,
    options,
    secrets,
    id,
  }: {
    poolConfig: PoolConfig;
    options?: PostgresSchemaManagementOptions;
    secrets: TenantsSecrets;
    id?: string;
  }) {
    super({ id });
    this.options = {
      provision: {
        schema: {
          prefix:
            options?.provision?.schema?.prefix || DEFAULT_TENANT_SCHEMA_PREFIX,
        },
      },
    };
    this.poolConfig = poolConfig;
    this.pool = new Pool(this.poolConfig);
    this.secretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
  }

  protected getSchemaNameForTenant(tenantId: string) {
    return this.options.provision.schema?.prefix + tenantId;
  }

  async createTenant(tenantId: string) {
    // Fresh new client
    const client = new Client(this.poolConfig);
    await client.connect();

    try {
      const schemaName = this.getSchemaNameForTenant(tenantId);
      await client.query(`BEGIN;`);
      await client.query(`CREATE SCHEMA "${schemaName}";`);

      const { rows } = await client.query(`SELECT current_database();`);
      const [{ current_database: currentDatabase }] = rows;

      const roleName = this.generateDefaultTenantRoleName(
        tenantId,
        this.options.provision.role?.prefix
      );
      const password = await this.secretsManager.generatePassword();
      await client.query(
        `CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${password}';

            -- PUBLIC = ALL ROLES
            REVOKE CREATE ON SCHEMA "${schemaName}" FROM PUBLIC;
            REVOKE ALL PRIVILEGES ON SCHEMA "${schemaName}" FROM PUBLIC;

            GRANT CONNECT ON DATABASE "${currentDatabase}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON SCHEMA "${schemaName}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "${schemaName}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL PROCEDURES IN SCHEMA "${schemaName}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA "${schemaName}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schemaName}" TO "${roleName}";

            -- For future objects
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT ALL ON TABLES TO "${roleName}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT ALL ON SEQUENCES TO "${roleName}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT ALL ON FUNCTIONS TO "${roleName}";
          `
      );
      await client.query(`COMMIT;`);
      await this.secretsManager.store(tenantId, {
        ...this.poolConfig,
        user: roleName,
        password,
        database: currentDatabase,
        schema: schemaName,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Error during rollback:", rollbackErr);
      }
      throw err;
    } finally {
      await client.end();
    }
  }

  async deleteTenant(tenantId: string) {
    const config = await this.secretsManager.get(tenantId);
    // Fresh new client
    const client = new Client(this.poolConfig);
    await client.connect();
    try {
      await client.query(`DROP SCHEMA "${config.schema}" CASCADE;`);
    } finally {
      await client.end();
    }
  }

  async end() {
    await this.pool.end();
  }
}

export class PostgresSchemaTenants extends PostgresTenantsBase {
  protected pools: Map<string, Pool>;
  protected tenantsSecretsManager: TenantsSecretsManager<
    PoolConfig & { schema: string }
  >;

  constructor({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    super({ id });
    this.pools = new Map();
    this.tenantsSecretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
  }

  protected async getClientConfigFor(
    tenantId: string
  ): Promise<PoolConfig & { schema: string }> {
    return await this.tenantsSecretsManager.get(tenantId);
  }

  protected async initTenantPool(tenantId: string) {
    const poolConfig = await this.getClientConfigFor(tenantId);
    const pool = new Pool(poolConfig);
    pool.on("error", (err) => {
      console.error(
        `Internal error in one of the clients of pool tenant ${tenantId}:`,
        err
      );
    });
    return pool;
  }

  async getClientFor(tenantId: string): Promise<PoolClient> {
    const poolConfig = await this.getClientConfigFor(tenantId);
    const { schema } = poolConfig;
    const pool =
      this.pools.get(tenantId) || (await this.initTenantPool(tenantId));
    this.pools.set(tenantId, pool);

    const client = await pool.connect();
    try {
      await client.query(`
        SELECT set_config('role', '${this.generateDefaultTenantRoleName(
          tenantId
        )}', false);
        SELECT set_config('search_path', '${schema}', false);
      `);
      return client;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  /**
   * Ends the connection pools. If a single `tenantId` is provided, it will only end that tenant's pool.
   * @param tenantId
   */
  async end(tenantId?: string) {
    if (tenantId) {
      const pool = this.pools.get(tenantId);
      if (pool) {
        await pool.end();
        this.pools.delete(tenantId);
      }
    } else {
      for (const pool of Array.from(this.pools.values())) {
        if (!pool.ended) {
          await pool.end();
        }
      }
    }
  }
}
