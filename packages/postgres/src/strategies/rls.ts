import { Pool, PoolClient, PoolConfig } from "pg";
import {
  DEFAULT_ROLE,
  DEFAULT_SETTINGS_TENANT_FIELD,
  DEFAULT_TENANT_ID_COLUMN,
  PostgresResource,
  PostgresTenantsBase,
} from "./base";
import { ResourceOptions } from "@fahren/core";

/**
 * Configuration options for Row-Level Security (RLS) tenant isolation.
 *
 * These options allow you to customize the behavior of RLS policies, including
 * the tables to apply RLS to, the tenant role, and the tenant field used in
 * PostgreSQL settings.
 */
export interface PostgresRlsManagementOptions
  extends Omit<ResourceOptions, "deprovision"> {
  provision?: {
    /**
     * Automatically creates RLS policies and a role when the first tenant is created.
     * This only needs to be run once per resource.
     *
     * Table detection for applying RLS policies
     * is based on the presence of a column named `DEFAULT_TENANT_ID_COLUMN`,
     * or the value specified in `rls.tenantColumn`, and whether the table has RLS enabled.
     *
     * @default false
     */
    autoSetup?: boolean;

    /**
     * Prevents table owners from bypassing row security.
     *
     * @default true
     */
    forceRlsOnTableOwner?: boolean;

    role?: {
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
      generatePassword?: () => string | Promise<string>;
    };
  };

  /**
   * Enables automatic detection of tenant-y tables.
   * Has no effect if `tables` is explicitly provided.
   *
   * Detection is based on the presence of a column named `DEFAULT_TENANT_ID_COLUMN`,
   * or the value specified in `rls.tenantColumn`, and whether the table has RLS enabled.
   *
   * @default true
   */
  autoDetectTables?: boolean;

  /**
   * An optional array of `Table` objects representing the tables
   * to which RLS policies are applied and tenant data is stored.
   * Each table can specify its name, schema, index, and tenant ID column.
   *
   * If provided, the class will use the specified tables for RLS setup
   * and when deleting a tenant using `deleteTenant`.
   * If not provided, the class will attempt to auto-detect tables.
   *
   * @default []
   */
  tables?: Array<Table>;

  /**
   * RLS-specific configuration options.
   */
  rls?: {
    /**
     * Name of the tenant column used for RLS filtering.
     *
     * @default DEFAULT_TENANT_ID_COLUMN
     */
    tenantColumn?: string;
  };
}

export interface Table {
  name: string;
  schema?: string;
  tenantIdColumn?: string;
}

/**
 * A PostgreSQL client that implements Row-Level Security (RLS) for tenant isolation.
 * This class provides methods to configure RLS policies, manage roles, and enforce tenant-based access control
 * in a PostgreSQL database. It uses the `pg` library for database interactions.
 *
 * ### Usage:
 * 1. Instantiate the class with a `PoolConfig` and optional RLS isolation options.
 * 2. Use the `setup` method to configure RLS for specified tables if you haven't.
 * 3. Use `queryAs` to query safely as a tenant.
 * 4. Use `getAs` to get a temporal client configured for a specific tenant.

 *
 * ```typescript
 * const poolConfig: PoolConfig = { connectionString: "postgres://..." };
 * const rlsSource = new PostgresWithRlsIsolation(poolConfig);
 *
 * await rlsSource.setup({
 *   tables: [{ name: "users", schema: "public" }],
 *   role: "tenant_role",
 *   defaultSettingsTenantField: "app.current_tenant",
 * });
 * const tenantClient = await rlsSource.getClientFor("tenant_123");
 * ```
 *
 * @remarks
 * This class assumes that the database schema and tables are already setup.
 *
 * @extends PostgresSource
 */
export class PostgresRlsManagement extends PostgresResource {
  protected options: Required<Omit<PostgresRlsManagementOptions, "tables">> & {
    tables?: Array<Table>;
  };
  protected poolConfig: PoolConfig;
  protected pool: Pool;

  constructor({
    poolConfig,
    options,
    id,
  }: {
    poolConfig: PoolConfig;
    options?: PostgresRlsManagementOptions;
    id?: string;
  }) {
    super({ id });
    this.options = {
      tables: options?.tables,
      rls: {
        tenantColumn: options?.rls?.tenantColumn || DEFAULT_TENANT_ID_COLUMN,
      },
      autoDetectTables:
        typeof options?.autoDetectTables === "boolean"
          ? options.autoDetectTables
          : true,
      provision: {
        autoSetup:
          typeof options?.provision?.autoSetup === "boolean"
            ? options.provision.autoSetup
            : false,
        role: {},
        forceRlsOnTableOwner:
          typeof options?.provision?.forceRlsOnTableOwner === "boolean"
            ? options.provision.forceRlsOnTableOwner
            : true,
      },
    };
    this.poolConfig = poolConfig;
    this.pool = new Pool(this.poolConfig);
  }

  /**
   * Grants the specified role permissions to access and modify a table, its schema,
   * and any associated sequences in a PostgreSQL database.
   *
   * This method performs the following actions:
   * 1. Grants SELECT, INSERT, UPDATE, and DELETE permissions on the specified table to the role.
   * 2. Grants USAGE permission on the schema containing the table to the role.
   * 3. Identifies sequences associated with the table (e.g., for auto-increment columns)
   *    and grants USAGE, SELECT, and UPDATE permissions on those sequences to the role.
   *
   * @param client - The PostgreSQL client used to execute queries.
   * @param tableName - The table name for which permissions are being granted.
   * @param schema - The schema to use.
   *
   * @throws Will throw an error if any of the queries fail.
   */
  private async grantOverRole(
    client: PoolClient,
    tableName: string,
    schema: string
  ) {
    // Send together to speed up.
    // The grant over the schema is necessary when the schema is different than the connected one.
    await client.query(
      ` GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.${tableName} TO ${DEFAULT_ROLE};
        GRANT USAGE ON SCHEMA ${schema} TO ${DEFAULT_ROLE};`
    );

    const { rows: tableSequencesRows } = await this.getTableSequences(
      client,
      tableName,
      schema
    );

    // Grant permissions on sequences associated with the table.
    // This enables the role to perform insert operations without errors.
    if (tableSequencesRows.length > 0) {
      for (const row of tableSequencesRows) {
        const sequenceName = row.sequence_name;
        await client.query(
          `GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${sequenceName} TO ${DEFAULT_ROLE};`
        );
      }
    }
  }

  /**
   * Retrieves the sequences associated with a table's columns in a PostgreSQL database.
   * This is commonly used to identify sequences for columns defined with `SERIAL` or `BIGSERIAL` types.
   *
   * @param client - The database client transaction used to execute queries.
   * @param tableName - The name of the target table.
   * @param schema - The table's schema.
   * @returns A promise that resolves to the query result containing the sequence names for the table's columns.
   *
   * The query checks for columns with a `nextval` default value, which indicates the presence of a sequence,
   * and ensures the sequence is not null.
   */
  private async getTableSequences(
    client: PoolClient,
    tableName: string,
    schema: string
  ) {
    return await client.query(`
    SELECT pg_get_serial_sequence('${schema}.${tableName}', column_name) AS sequence_name
          FROM information_schema.columns
          WHERE table_schema = '${schema}'
          AND table_name = '${tableName}'
          AND column_default LIKE 'nextval%'
          AND pg_get_serial_sequence('${schema}.${tableName}', column_name) IS NOT NULL;
    `);
  }

  /**
   * Enables Row-Level Security (RLS) for a specified table in the database.
   *
   * @param client - The database client used to execute the query.
   * @param table - The table object containing the name and optional schema of the table.
   * @param currentSchema - The current schema to use if the table's schema is not specified.
   * @returns A promise that resolves when the RLS is successfully enabled.
   *
   * @throws Will throw an error if the query to enable RLS fails.
   */
  private async enableRlsOverTable(
    client: PoolClient,
    tableName: string,
    schema: string
  ) {
    if (this.options.provision.forceRlsOnTableOwner) {
      await client.query(
        `
          ALTER TABLE ${schema}.${tableName} ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ${schema}.${tableName} FORCE ROW LEVEL SECURITY;
        `
      );
    } else {
      await client.query(
        `ALTER TABLE ${schema}.${tableName} ENABLE ROW LEVEL SECURITY;`
      );
    }
  }

  private async isPolicyCreated(
    client: PoolClient,
    tableName: string,
    schema: string,
    policyName: string
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT * FROM pg_policies WHERE schemaname = '${schema}' AND tablename = '${tableName}' AND policyname = '${policyName}';`
    );

    return rowCount && rowCount > 0 ? true : false;
  }

  /**
   * Creates row-level security policies for a given table to enforce tenant isolation.
   *
   * This method creates two policies:
   * 1. A `USING` policy to ensure that rows are only accessible if the tenant ID column
   *    matches the current tenant setting.
   * 2. A `FOR INSERT WITH CHECK` policy to ensure that rows can only be inserted if the
   *    tenant ID column matches the current tenant setting.
   *
   * @param client - The database client used to execute the SQL queries.
   * @param table - The table for which the policies will be created. This includes
   *                information about the table name, schema, and tenant ID column.
   * @param schema - The schema to use.
   *
   * @throws Will throw an error if the SQL queries fail to execute.
   */
  private async createPoliciesOverTable(
    client: PoolClient,
    table: Table,
    schema: string
  ) {
    const tenantIdColumn =
      table.tenantIdColumn || this.options.rls.tenantColumn;

    const usingPolicyName = "tenant_isolation";
    if (
      await this.isPolicyCreated(client, table.name, schema, usingPolicyName)
    ) {
      throw new Error(
        `A row-level security (RLS) policy named "${usingPolicyName}" already exists on ${schema}.${table.name}. Multiple policies on the same table can lead to unpredictable behavior and unintended access control issues. To resolve this, modify the existing policy or ensure that group-specific policies do not overlap with the default isolation settings.`
      );
    } else {
      await client.query(`
        CREATE POLICY ${usingPolicyName} ON ${schema}.${table.name}
        USING (${tenantIdColumn}::TEXT = current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}'))
      `);
    }

    const insertPolicyName = "tenant_insert";
    if (
      await this.isPolicyCreated(client, table.name, schema, insertPolicyName)
    ) {
      throw new Error(
        `A row-level security (RLS) policy named "${insertPolicyName}" already exists on ${schema}.${table.name}. Multiple policies on the same table can lead to unpredictable behavior and unintended access control issues. To resolve this, modify the existing policy or ensure that group-specific policies do not overlap with the default isolation settings.`
      );
    } else {
      await client.query(`
        CREATE POLICY ${insertPolicyName} ON ${schema}.${table.name}
        FOR INSERT WITH CHECK (${tenantIdColumn}::TEXT = current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}'))
      `);
    }
  }

  /**
   * Checks if a specific role exists in the PostgreSQL database.
   *
   * @param client - The PostgreSQL client used to execute the query.
   * @returns A promise that resolves to `true` if the role exists, otherwise `false`.
   *
   * @remarks
   * This function queries the `pg_catalog.pg_roles` system catalog to determine
   * if a role with the name specified in `this.options.role` exists. It uses
   * a simple `SELECT` statement to check for the presence of the role.
   *
   * @throws Will throw an error if the query execution fails.
   */
  private async isRoleCreated(client: PoolClient) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${DEFAULT_ROLE}';`
    );

    return rowCount === 1;
  }

  /**
   * Creates a new PostgreSQL role with the specified name and the NOLOGIN attribute.
   *
   * @param client - The PostgreSQL client used to execute the query.
   * @returns A promise that resolves with the result of the query execution.
   *
   * @remarks
   * The role name is retrieved from the `options.role` property.
   * Ensure that the `options.role` value is properly sanitized to prevent SQL injection.
   */
  private async createRole(client: PoolClient) {
    const response = await client.query(
      `CREATE ROLE ${DEFAULT_ROLE} WITH NOLOGIN;`
    );

    return response;
  }

  /**
   * Retrieves a clean PostgreSQL client from the connection pool.
   *
   * This method resets all session-level settings to ensure a clean state
   * for the client before using it for database operations.
   *
   * @returns A promise that resolves to a PostgreSQL client.
   *
   * @throws Will throw an error if the client cannot be obtained or if the reset fails.
   */
  private async getCleanClient() {
    const client = await this.pool.connect();
    try {
      await client.query("RESET ALL");
      return client;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  /**
   * Sets up the necessary database configurations for Row-Level Security (RLS).
   *
   * This method performs the following steps:
   * 1. Resets all session-level settings to ensure a clean client state.
   * 2. Retrieves the current schema of the database.
   * 3. Begins a transaction to apply RLS configurations.
   * 4. Checks if the required role exists, creating it if necessary.
   * 5. Iterates over the specified tables to:
   *    - Grant the role necessary permissions.
   *    - Enable RLS on the table.
   *    - Create RLS policies for the table.
   * 6. Commits the transaction after all configurations are applied.
   *
   * @throws {Error} If the role already exists and the error is not suppressed.
   */
  async setup(tables?: Array<Table>) {
    const tableList = tables || this.options.tables;
    if (!tableList || tableList.length === 0) {
      console.warn(
        "No tables specified for Row-Level Security (RLS) setup. No RLS policies will be applied. No role will be created."
      );
      return;
    }

    const client = await this.getCleanClient();
    try {
      const { rows } = await client.query("SELECT current_schema();");
      const [{ current_schema: currentSchema }] = rows;

      await client.query("BEGIN");

      if (!(await this.isRoleCreated(client))) {
        await this.createRole(client);
      } else {
        console.warn("Role already exists");
        // throw new Error(`Role '${this.options.role}' already exists.`);
      }

      for (const table of tableList) {
        const schema = table.schema || currentSchema;
        await this.grantOverRole(client, table.name, schema);
        await this.enableRlsOverTable(client, table.name, schema);
        await this.createPoliciesOverTable(client, table, schema);
      }

      await client.query("COMMIT;");
    } catch (err) {
      await client.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      await client.release();
    }
  }

  /**
   * Retrieves a list of tables that contain a `tenant_id` column and do not have RLS enabled.
   *
   * @param client - The PostgreSQL client used to execute the query.
   * @returns A promise that resolves to an array of tables with their schema and RLS status.
   *
   * @remarks
   * This method queries the `information_schema.columns` to find tables with a
   * `tenant_id` column and checks if RLS is enabled for those tables.
   */
  private async getMultitenantTablesWithoutRls(client: PoolClient) {
    const { rows } = await client.query(`
      SELECT
        c.table_schema,
        c.table_name,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class cl
                JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
                WHERE n.nspname = c.table_schema
                  AND cl.relname = c.table_name
                  AND cl.relrowsecurity = true
            ) THEN True
            ELSE False
        END AS has_rls_enabled
    FROM information_schema.columns c
    WHERE c.column_name = '${this.options.rls.tenantColumn}'
    ORDER BY c.table_schema, c.table_name;
  `);

    const tables = rows
      .map((row) => ({
        name: row.table_name as string,
        schema: row.table_schema as string,
        hasRlsEnabled: row.has_rls_enabled as boolean,
      }))
      .filter((row) => !row.hasRlsEnabled);

    return tables;
  }

  /**
   * This method configures RLS on all tables that contain a `tenant_id` column and do not have RLS enabled.
   * If the `autoDiscovery` option is disabled, this method does nothing.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createTenant(_tenantId: string) {
    if (this.options.provision.autoSetup) {
      const client = await this.getCleanClient();

      try {
        const multitenantTablesWithoutRls =
          await this.getMultitenantTablesWithoutRls(client);
        if (multitenantTablesWithoutRls.length > 0) {
          // If tables are specified for the resource, filter them
          // to only include those that match the specified tables
          // and do not have RLS enabled.
          if (this.options.tables) {
            const filteredTables = multitenantTablesWithoutRls.filter((table) =>
              this.options.tables?.some(
                (t) => t.name === table.name && t.schema === table.schema
              )
            );
            if (filteredTables.length > 0) {
              console.log("Setting up RLS for tables:", filteredTables);
              await this.setup(filteredTables);
              return true;
            }
          } else if (this.options.autoDetectTables) {
            // If no tables are specified, set up RLS for all tables
            // that do not have RLS enabled.
            console.log(
              "Setting up RLS for tables:",
              "[",
              multitenantTablesWithoutRls
                .map((x) => `${x.schema}.${x.name}`)
                .join(", "),
              "]"
            );
            await this.setup(multitenantTablesWithoutRls);
            return true;
          }
        }
      } finally {
        // Condition to avoid setup again
        this.options.provision.autoSetup = false;
        await client.release();
      }
    }
    return false;
  }

  async deleteTenant(id: string, tables?: Array<Table>) {
    const tableList = tables || this.options.tables;
    if (!tableList || tableList.length === 0) {
      console.warn("No tables specified. No data will be removed.");
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      /**
       * Delete as a tenant, using a local config just for the transaction.
       */
      await client.query(`
        SELECT set_config('${DEFAULT_SETTINGS_TENANT_FIELD}', '${id}', true);
        SELECT set_config('role', '${DEFAULT_ROLE}', true);
      `);

      for (const table of tableList) {
        const query = `DELETE FROM ${table.schema ? `${table.schema}.` : ""}${
          table.name
        } WHERE "${
          table.tenantIdColumn || this.options.rls.tenantColumn
        }" = '${id}'`;
        await client.query(query);
      }
      await client.query("COMMIT;");
    } catch (err) {
      try {
        await client.query("ROLLBACK;");
      } catch (rollbackErr) {
        console.error("Error during rollback:", rollbackErr);
      }
      throw err;
    } finally {
      await client.release();
    }
  }

  async end() {
    await this.pool.end();
  }
}

export class PostgresRlsTenants extends PostgresTenantsBase {
  protected pool: Pool;
  protected poolConfig: PoolConfig;

  constructor({ id, poolConfig }: { poolConfig: PoolConfig; id?: string }) {
    super({ id });

    this.pool = new Pool(poolConfig);
    this.poolConfig = poolConfig;
  }

  async end() {
    await this.pool.end();
  }

  async getClientFor(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query(
        ` SELECT set_config('${DEFAULT_SETTINGS_TENANT_FIELD}', '${id}', false);
          SELECT set_config('role', '${DEFAULT_ROLE}', false);`
      );

      return client;
    } catch (err) {
      client.release();
      throw err;
    }
  }
}
