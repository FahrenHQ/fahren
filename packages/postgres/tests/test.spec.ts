import {
  GenericContainer,
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
  StartedTestContainer,
} from "testcontainers";
import { Client, Pool, PoolConfig } from "pg";
import {
  PostgresRlsManagement,
  PostgresRlsTenants,
} from "../src/strategies/rls";
import {
  PostgresDatabaseManagement,
  PostgresDatabaseTenants,
} from "../src/strategies/database";
import {
  PostgresSchemaManagement,
  PostgresSchemaTenants,
} from "../src/strategies/schema";
import { AwsSecretsManager } from "@fahren/secrets";
import Postgres from "../src";
import {
  DEFAULT_SETTINGS_TENANT_FIELD,
  DEFAULT_TENANT_SCHEMA_PREFIX,
} from "../src/strategies/base";

describe("Postgres RLS multi-tenant strategy", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let container: StartedPostgreSqlContainer;
  let poolConfig: PoolConfig;
  let postgresResource: PostgresRlsManagement;
  let postgresTenants: PostgresRlsTenants;
  const resourceId: string = crypto.randomUUID();

  beforeAll(async () => {
    container = await new PostgreSqlContainer().withExposedPorts().start();

    const port = container.getPort();
    const host = container.getHost();
    const username = container.getUsername();
    const password = container.getPassword();
    const database = container.getDatabase();

    poolConfig = {
      host,
      port,
      user: username,
      password,
      database,
    };

    const poolClient = new Pool(poolConfig);
    await poolClient.query(
      "CREATE TABLE rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await poolClient.query(
      "CREATE TABLE rls_isolation_table_autoDiscovery_needed (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await poolClient.query("CREATE SCHEMA alternative_schema;");
    await poolClient.query(
      "CREATE TABLE alternative_schema.alternative_rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await poolClient.end();
    postgresResource = new Postgres().withRlsIsolation().forManagement({
      poolConfig,
      options: {
        provision: {
          autoSetup: true,
        },
      },
      id: resourceId,
    });
    postgresTenants = new Postgres()
      .withRlsIsolation()
      .forTenants({ id: resourceId, poolConfig });
  });

  afterAll(async () => {
    await postgresTenants.end();
    await postgresResource.end();
    await container.stop();
  });

  it("should detect a incorrect tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await expect(
      postgresTenants.queryAs(
        tenantId,
        `SELECT current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}');`
      )
    ).rejects.toThrow(`role "tenant_role" does not exist`);
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    const res = await postgresTenants.queryAs(
      tenantId,
      `SELECT current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}');`
    );
    expect(res.rows[0].current_setting).toBe(tenantId);
  });

  it("should insert a tenant data with RLS enabled", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    await postgresTenants.withClientFor(tenantId, async (client) => {
      await client.query(
        "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
        [tenantId, "test_name"]
      );

      const res = await client.query(
        "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
        [tenantId]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].name).toBe("test_name");
    });

    await postgresTenants.queryAs(
      tenantId,
      "INSERT INTO rls_isolation_table_autoDiscovery_needed (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId, "test_name"]
    );
    const res = await postgresTenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table_autoDiscovery_needed"
    );
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].name).toBe("test_name");
  });

  it("should avoid deleting tenant data with RLS enabled", async () => {
    const tenantIdToDeleteDataFrom = crypto.randomUUID();
    await postgresResource.createTenant(tenantIdToDeleteDataFrom);
    await postgresTenants.queryAs(
      tenantIdToDeleteDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToDeleteDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    const { rowCount } = await postgresTenants.queryAs(
      tenantId,
      "DELETE FROM rls_isolation_table"
    );

    expect(rowCount).toBe(0);
  });

  it("should avoid updating tenant data with RLS enabled", async () => {
    const tenantIdToUpdateDataFrom = crypto.randomUUID();
    await postgresResource.createTenant(tenantIdToUpdateDataFrom);
    await postgresTenants.queryAs(
      tenantIdToUpdateDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToUpdateDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    const { rowCount } = await postgresTenants.queryAs(
      tenantId,
      "UPDATE rls_isolation_table SET name = $1 WHERE tenant_id = $2",
      ["updated_name", tenantIdToUpdateDataFrom]
    );

    expect(rowCount).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId1 = crypto.randomUUID();
    const tenantId2 = crypto.randomUUID();

    await postgresResource.createTenant(tenantId1);
    await postgresResource.createTenant(tenantId2);

    await postgresTenants.queryAs(
      tenantId2,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId2, "name2"]
    );

    // const clients = await Promise.all([
    //   await postgresResource.get(tenantId1),
    //   await postgresResource.get(tenantId1),
    //   await postgresResource.get(tenantId1),
    // ]);

    await postgresTenants.queryAs(
      tenantId1,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId1, "name1"]
    );

    const promises = await Promise.all([
      postgresTenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      postgresTenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      postgresTenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should detect an invalid insert for a tenant with RLS", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    await expect(
      postgresTenants.queryAs(
        tenantId,
        "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
        ["invalid_tenant", "test_name"]
      )
    ).rejects.toThrow(
      `new row violates row-level security policy for table "rls_isolation_table"`
    );
  });

  it("should handle different schemas for tables with RLS", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    await postgresTenants.queryAs(
      tenantId,
      "INSERT INTO alternative_schema.alternative_rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    await expect(
      postgresTenants.queryAs(
        tenantId,
        "INSERT INTO alternative_schema.alternative_rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
        ["invalid_tenant", "test_name"]
      )
    ).rejects.toThrow(
      `new row violates row-level security policy for table "alternative_rls_isolation_table"`
    );
  });

  it("should handle creating and deleting a tenant", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    await postgresTenants.withClientFor(tenantId, async (client) => {
      await client.query(
        "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
        [tenantId, "test_name"]
      );

      const res = await client.query(
        "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
        [tenantId]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].name).toBe("test_name");
    });

    await postgresResource.deleteTenant(tenantId, [
      { name: "rls_isolation_table" },
    ]);
    await postgresResource.createTenant(tenantId);
    const { rowCount } = await postgresTenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(rowCount).toBe(0);
  });
});

describe("Postgres Database multi-tenant strategy", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let container: StartedPostgreSqlContainer;
  let poolConfig: PoolConfig;
  let postgresResource: PostgresDatabaseManagement;
  let postgresTenants: PostgresDatabaseTenants;
  let secretsProvider: AwsSecretsManager;
  let secretsManagerContainer: StartedTestContainer;
  let secretsManagerEndpoint: string;
  const resourceId: string = crypto.randomUUID();

  beforeAll(async () => {
    // Start a local AWS Secrets Manager container
    secretsManagerContainer = await new GenericContainer(
      "localstack/localstack"
    )
      .withExposedPorts(4566)
      .withEnv("SERVICES", "secretsmanager")
      .start();

    secretsManagerEndpoint = `http://${secretsManagerContainer.getHost()}:${secretsManagerContainer.getMappedPort(
      4566
    )}`;
    secretsProvider = new AwsSecretsManager({
      endpoint: secretsManagerEndpoint,
      region: "us-east-1",
    });

    container = await new PostgreSqlContainer().withExposedPorts().start();

    const port = container.getPort();
    const host = container.getHost();
    const username = container.getUsername();
    const password = container.getPassword();
    const database = container.getDatabase();

    poolConfig = {
      host,
      port,
      user: username,
      password,
      database,
    };

    const client = new Client(poolConfig);
    await client.connect();
    await client.query("CREATE DATABASE tenant_template;");
    await client.end();

    const newDbClient = new Client({
      ...poolConfig,
      database: "tenant_template",
    });
    await newDbClient.connect();
    await newDbClient.query(
      "CREATE TABLE db_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await newDbClient.end();

    postgresResource = new Postgres().withDatabaseIsolation().forManagement({
      poolConfig,
      options: {
        provision: {
          database: {
            prefix: "tenant_",
            template: "tenant_template",
          },
        },
        deprovision: {
          database: {
            useForceOnDelete: true,
          },
        },
      },
      secrets: {
        provider: secretsProvider,
      },
      id: resourceId,
    });
    postgresTenants = new Postgres()
      .withDatabaseIsolation()
      .forTenants({ secrets: { provider: secretsProvider }, id: resourceId });
  });

  afterAll(async () => {
    await postgresTenants.end();
    await postgresResource.end();
    await container.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    const res = await postgresTenants.queryAs(
      tenantId,
      `SELECT current_database();`
    );
    expect(res.rows[0].current_database).toBe("tenant_" + tenantId);
  });

  it("should insert a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    await postgresTenants.withClientFor(tenantId, async (client) => {
      await client.query(
        "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2)",
        [tenantId, "test_name"]
      );

      const res = await client.query(
        "SELECT * FROM db_isolation_table WHERE tenant_id = $1",
        [tenantId]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].name).toBe("test_name");
    });

    const secondTenantId = crypto.randomUUID();
    await postgresResource.createTenant(secondTenantId);
    const { rows } = await postgresTenants.queryAs(
      secondTenantId,
      "SELECT * FROM db_isolation_table"
    );
    expect(rows.length).toBe(0);
  });

  it("should be able to create a table correctly", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);

    await postgresTenants.withClientFor(tenantId, async (client) => {
      await client.query(
        "CREATE TABLE db_isolation_custom_table (tenant_id TEXT, name TEXT)"
      );
      await client.query(
        "INSERT INTO db_isolation_custom_table (tenant_id, name) VALUES ($1, $2)",
        [tenantId, "test_name"]
      );

      const res = await client.query(
        "SELECT * FROM db_isolation_custom_table WHERE tenant_id = $1",
        [tenantId]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].name).toBe("test_name");
    });
  });

  it("should create and delete a tenant correctly", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    const res = await postgresTenants.queryAs(
      tenantId,
      `SELECT current_database();`
    );
    expect(res.rows[0].current_database).toBe("tenant_" + tenantId);

    await postgresResource.deleteTenant(tenantId);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId1 = crypto.randomUUID();

    await postgresResource.createTenant(tenantId1);

    await postgresTenants.queryAs(
      tenantId1,
      "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId1, "name1"]
    );

    const promises = await Promise.all([
      postgresTenants.queryAs(tenantId1, "SELECT * FROM db_isolation_table"),
      postgresTenants.queryAs(tenantId1, "SELECT * FROM db_isolation_table"),
      postgresTenants.queryAs(tenantId1, "SELECT * FROM db_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });
});

describe("Postgres Schema multi-tenant strategy", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let container: StartedPostgreSqlContainer;
  let poolConfig: PoolConfig;
  let postgresResource: PostgresSchemaManagement;
  let postgresTenants: PostgresSchemaTenants;
  let secretsProvider: AwsSecretsManager;
  let secretsManagerContainer: StartedTestContainer;
  let secretsManagerEndpoint: string;
  const resourceId: string = crypto.randomUUID();

  beforeAll(async () => {
    // Start a local AWS Secrets Manager container
    secretsManagerContainer = await new GenericContainer(
      "localstack/localstack"
    )
      .withExposedPorts(4566)
      .withEnv("SERVICES", "secretsmanager")
      .start();

    secretsManagerEndpoint = `http://${secretsManagerContainer.getHost()}:${secretsManagerContainer.getMappedPort(
      4566
    )}`;
    secretsProvider = new AwsSecretsManager({
      endpoint: secretsManagerEndpoint,
      region: "us-east-1",
    });

    container = await new PostgreSqlContainer().withExposedPorts().start();

    const port = container.getPort();
    const host = container.getHost();
    const username = container.getUsername();
    const password = container.getPassword();
    const database = container.getDatabase();

    poolConfig = {
      host,
      port,
      user: username,
      password,
      database,
    };

    const postgres = new Postgres().withSchemaIsolation();
    postgresResource = postgres.forManagement({
      poolConfig,
      options: {
        provision: {
          role: {},
        },
      },
      secrets: {
        provider: secretsProvider,
      },
      id: resourceId,
    });
    postgresTenants = postgres.forTenants({
      secrets: {
        provider: secretsProvider,
      },
      id: resourceId,
    });
  });

  afterAll(async () => {
    await postgresResource.end();
    await container.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    await postgresTenants.withClientFor(tenantId, async (client) => {
      const { rows } = await client.query(`SHOW search_path;`);
      expect(rows[0].search_path).toBe("tenant_" + tenantId);
    });
  });

  it("should insert a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    await postgresTenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await postgresTenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await postgresTenants.queryAs(
      tenantId,
      "SELECT * FROM schema_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    const secondTenantId = crypto.randomUUID();
    await postgresResource.createTenant(secondTenantId);
    await postgresTenants.queryAs(
      secondTenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    const { rows } = await postgresTenants.queryAs(
      secondTenantId,
      "SELECT * FROM schema_isolation_table"
    );
    expect(rows.length).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    await postgresTenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );

    await postgresTenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId, "name1"]
    );

    const promises = await Promise.all([
      postgresTenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      postgresTenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      postgresTenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should create and delete a tenant correctly", async () => {
    const tenantId = crypto.randomUUID();
    await postgresResource.createTenant(tenantId);
    const res = await postgresTenants.queryAs(
      tenantId,
      `SELECT current_schema();`
    );
    expect(res.rows[0].current_schema).toBe("tenant_" + tenantId);
    await postgresResource.deleteTenant(tenantId);

    await postgresResource.createTenant("temporal");
    const { rows } = await postgresTenants.queryAs(
      "temporal",
      `SELECT nspname FROM pg_catalog.pg_namespace;`
    );
    const schema = rows.find((x) => x.nspname === tenantId);
    expect(schema).toBeUndefined();
  });

  it("should detect a wrong schema access", async () => {
    const tenantId = "victim_id";
    await postgresResource.createTenant(tenantId);
    const res = await postgresTenants.queryAs(
      tenantId,
      `SELECT current_schema();`
    );
    expect(res.rows[0].current_schema).toBe("tenant_" + tenantId);
    await postgresTenants.queryAs(
      tenantId,
      "CREATE TABLE sensitive_data (secret TEXT);"
    );
    await postgresTenants.queryAs(
      tenantId,
      "INSERT INTO sensitive_data VALUES ('sensitive information');"
    );

    const crossSchemaQuery = `SELECT * FROM ${DEFAULT_TENANT_SCHEMA_PREFIX}${tenantId}.sensitive_data;`;
    const attackerTenantId = crypto.randomUUID();
    await postgresResource.createTenant(attackerTenantId);
    await expect(
      postgresTenants.queryAs(attackerTenantId, crossSchemaQuery)
    ).rejects.toThrow(
      `permission denied for schema ${DEFAULT_TENANT_SCHEMA_PREFIX}${tenantId}`
    );
  });
});
