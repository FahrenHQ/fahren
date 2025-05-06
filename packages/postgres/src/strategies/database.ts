import { Client, Pool, PoolConfig } from "pg";
import { PostgresResource, PostgresTenantsBase } from "./base";
import {
  ResourceOptionsWithSecrets,
  TenantsSecrets,
  TenantsSecretsManager,
} from "@fahren/core";
import { DEFAULT_TENANT_DB_PREFIX, DEFAULT_TENANT_ROLE_PREFIX } from "./base";

interface Deprovision {
  database?: {
    /**
     * Whether to enable the `FORCE` option when deleting tenant databases.
     * If set to `true`, the database will be dropped with the `FORCE` option.
     *
     * @default false
     */
    useForceOnDelete?: boolean;
  };
}

interface Provision {
  database?: {
    /**
     * The prefix to use for database names.
     *
     * Note: If `additionalSecurity` is enabled, this prefix is used only at creation time.
     * After creation, the tenant's database name is retrieved from the secret manager.
     *
     * @default DEFAULT_TENANT_DB_PREFIX
     */
    prefix?: string;

    /**
     * The name of the template database to use when creating new tenant databases.
     * If specified, new databases will be created as a copy of this template.
     * If not specified, new databases will be created as empty databases.
     */
    template?: string;
  };

  role?: {
    /**
     * The prefix to use when generating names for tenant-specific roles.
     * If provided, this prefix will be prepended to the role names.
     *
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
     * @default If not provided, Fahren will automatically generate a secure random password.
     * @returns A string containing the password or a Promise that resolves to the password
     */
    generatePassword?: (tenantId: string) => string | Promise<string>;
  };

  schemas?: {
    /**
     * List of schema names to create and grant permissions for.
     * If not provided, only the 'public' schema will be used.
     *
     * Example: ['public', 'tenant_data', 'audit']
     *
     * @default ["public"]
     */
    names?: string[];

    /**
     * Whether to create the schemas if they don't exist.
     *
     * @default true
     */
    createIfNotExists?: boolean;
  };
}

export interface PostgresDatabaseManagementOptions
  extends Omit<
    ResourceOptionsWithSecrets,
    "secrets" | "identityAccessControl"
  > {
  /**
   * Options for provisioning databases and roles, used only during tenant creation.
   */
  provision?: Provision;

  /**
   * Options for deprovisioning, used only during tenant deletion.
   */
  deprovision?: Deprovision;
}

export class PostgresDatabaseManagement extends PostgresResource {
  protected poolConfig: PoolConfig;
  protected pool: Pool;
  protected options: Required<PostgresDatabaseManagementOptions>;
  protected secretsManager: TenantsSecretsManager<PoolConfig>;

  constructor({
    poolConfig,
    options,
    secrets,
    id,
  }: {
    poolConfig: PoolConfig;
    options?: PostgresDatabaseManagementOptions;
    secrets: TenantsSecrets;
    id?: string;
  }) {
    super({ id });
    this.options = {
      provision: {
        database: {
          template: options?.provision?.database?.template,
          prefix:
            options?.provision?.database?.prefix || DEFAULT_TENANT_DB_PREFIX,
        },
        role: {
          prefix:
            options?.provision?.role?.prefix || DEFAULT_TENANT_ROLE_PREFIX,
          generatePassword: options?.provision?.role?.generatePassword,
        },
        schemas: {
          names: options?.provision?.schemas?.names || ["public"],
          createIfNotExists:
            options?.provision?.schemas?.createIfNotExists ?? true,
        },
      },
      deprovision: {
        database: {
          useForceOnDelete: options?.deprovision?.database?.useForceOnDelete,
        },
      },
    };
    this.poolConfig = poolConfig;
    this.pool = new Pool(poolConfig);
    this.secretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
  }

  /**
   * Creates a new tenant database with the specified tenant ID.
   *
   * @param tenantId - The unique identifier for the tenant. This will be used
   *                   to generate the database name by appending it to the
   *                   configured prefix.
   *
   * @remarks
   * - If a template database is specified in the options (`this.options.templateDb`),
   *   the new database will be created using the template.
   * - If no template database is specified, a new empty database will be created.
   *
   * @throws Will throw an error if the database creation fails.
   */
  async createTenant(tenantId: string) {
    const client = await this.pool.connect();

    try {
      const databaseName = this.options.provision.database?.prefix + tenantId;
      if (this.options.provision.database?.template) {
        await client.query(
          `CREATE DATABASE "${databaseName}" WITH TEMPLATE "${this.options.provision.database.template}";`
        );
      } else {
        await client.query(`CREATE DATABASE "${databaseName}";`);
      }

      // Credentials workflow
      const roleName = this.generateDefaultTenantRoleName(
        tenantId,
        this.options.provision.role?.prefix
      );
      const password = this.options.provision.role?.generatePassword
        ? await this.options.provision.role?.generatePassword(tenantId)
        : await this.secretsManager.generatePassword();

      await client.query(
        `CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${password}';` +
          `GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO "${roleName}";`
      );

      const clientConfig: PoolConfig = {
        ...this.poolConfig,
        user: roleName,
        password,
        database: databaseName,
      };
      await this.secretsManager.store(tenantId, clientConfig);

      // Connect to the new database to grant schema-level and table-level privileges to the tenant role
      const adminClient = new Client({
        ...this.poolConfig,
        database: databaseName,
      });

      try {
        await adminClient.connect();

        // Get the list of schemas to handle
        const schemas = this.options.provision.schemas?.names || ["public"];
        const createIfNotExists =
          this.options.provision.schemas?.createIfNotExists ?? true;

        // Create schemas if they don't exist and createIfNotExists is true
        if (createIfNotExists) {
          for (const schema of schemas) {
            await adminClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
          }
        }

        // Grant permissions for each schema
        for (const schema of schemas) {
          await adminClient.query(`
            GRANT ALL ON SCHEMA "${schema}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "${schema}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL PROCEDURES IN SCHEMA "${schema}" TO "${roleName}";
            GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA "${schema}" TO "${roleName}";
            
            -- For future objects
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL PRIVILEGES ON TABLES TO "${roleName}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL PRIVILEGES ON SEQUENCES TO "${roleName}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL PRIVILEGES ON FUNCTIONS TO "${roleName}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL PRIVILEGES ON ROUTINES TO "${roleName}";
          `);
        }
      } finally {
        adminClient.end();
      }
    } finally {
      await client.release();
    }
  }

  protected async getClientConfigFor(tenantId: string): Promise<PoolConfig> {
    return await this.secretsManager.get(tenantId);
  }

  /**
   * Deletes a tenant's database by its tenant ID.
   *
   * This method connects to PostgreSQL, gracefully closes any existing
   * connection pools associated with the tenant, and then drops the tenant's database.
   * If the `deleteWithForce` option is enabled, the database is dropped with the `FORCE` option.
   *
   * @param tenantId - The unique identifier of the tenant whose database is to be deleted.
   *
   * @throws Will propagate any errors encountered during database connection, query execution,
   *         or pool termination.
   */
  async deleteTenant(tenantId: string) {
    const { user: role, database } = await this.getClientConfigFor(tenantId);
    if (this.options.deprovision.database?.useForceOnDelete) {
      await this.pool.query(`DROP DATABASE "${database}" WITH (FORCE);`);
    } else {
      await this.pool.query(`DROP DATABASE "${database}";`);
    }

    if (this.secretsManager) {
      await this.secretsManager.remove(tenantId);
      if (this.poolConfig.user !== role) {
        await this.pool.query(`DROP ROLE "${role}";`);
      }
    }
  }

  async end() {
    await this.pool.end();
  }
}

export class PostgresDatabaseTenants extends PostgresTenantsBase {
  protected pools: Map<string, Pool>;
  protected secretsManager: TenantsSecretsManager<PoolConfig>;

  constructor({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    super({ id });
    this.pools = new Map();
    this.secretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
  }

  protected async getClientConfigFor(tenantId: string): Promise<PoolConfig> {
    return await this.secretsManager.get(tenantId);
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

  /**
   * Retrieves a database connection for the specified tenant.
   * If a connection pool for the tenant does not already exist, it creates a new one
   * using the provided configuration and tenant-specific database name.
   *
   * @param tenantId - The unique identifier of the tenant.
   * @returns A promise that resolves to a connected client from the tenant's connection pool.
   */
  async getClientFor(tenantId: string) {
    const pool = this.pools.get(tenantId);

    if (pool) {
      return await pool.connect();
    } else {
      const pool =
        this.pools.get(tenantId) || (await this.initTenantPool(tenantId));

      this.pools.set(tenantId, pool);
      return await pool.connect();
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
