import {
  DockerComposeEnvironment,
  GenericContainer,
  StartedDockerComposeEnvironment,
  StartedTestContainer,
} from "testcontainers";
import { Client, PoolConfig } from "pg";
import * as fs from "fs";
import { Vault, Static as StaticProvider } from "@fahren/secrets";
import PgBouncer from "../src/pgbouncer";
import {
  PgBouncerRlsManagement as RlsManagement,
  PgBouncerRlsTenants as RlsTenants,
} from "../src/pgbouncer/strategies/rls";
import {
  PgBouncerSchemaManagement as SchemaManagement,
  PgBouncerSchemaTenants as SchemaTenants,
} from "../src/pgbouncer/strategies/schema";
import {
  PgBouncerDatabaseManagement as DatabaseManagement,
  PgBouncerDatabaseTenants as DatabaseTenants,
} from "../src/pgbouncer/strategies/database";
import { DEFAULT_SETTINGS_TENANT_FIELD } from "../src/strategies/base";

export function generateDockerComposeFile(
  testName: string,
  poolMode: "transaction" | "session"
) {
  const composeTemplate = fs.readFileSync(
    "packages/postgres/src/pgbouncer/docker-compose-template.yml",
    "utf8"
  );
  const uniqueName = `${testName}_${poolMode}_${crypto
    .randomUUID()
    .replace(/-/g, "")}`;
  const updatedCompose = composeTemplate
    .replace(/\$1/g, uniqueName)
    .replace(/\$1/g, uniqueName)
    .replace(/\$2/g, poolMode);

  const composePath = `packages/postgres/pgbouncer/temp/docker-compose-${uniqueName}.yml`;

  if (!fs.existsSync("packages/postgres/pgbouncer/temp")) {
    fs.mkdirSync("packages/postgres/pgbouncer/temp", { recursive: true });
  }

  fs.writeFileSync(composePath, updatedCompose);
  return { name: uniqueName, path: composePath };
}

describe("Postgres RLS multi-tenant strategy with PGBouncer using pool_mode=transaction", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let pgbouncerPoolConfig: PoolConfig;
  let management: RlsManagement;
  let tenants: RlsTenants;
  let dockerComposePath: string;
  const resourceId: string = crypto.randomUUID();

  beforeAll(async () => {
    const { path, name } = generateDockerComposeFile("rls", "transaction");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    dockerComposePath = path;
    environment = await new DockerComposeEnvironment(".", dockerComposePath)
      .withEnv("PGBOUNCER_POOL_MODE", "transaction")
      .up();

    const clientConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    const dbClient = new Client(clientConfig);
    await dbClient.connect();
    await dbClient.query(
      "CREATE TABLE rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.query("CREATE SCHEMA alternative_schema;");
    await dbClient.query(
      "CREATE TABLE alternative_schema.alternative_rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.end();

    pgbouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      user: "testuser",
      password: "testpassword",
      database: "testdb",
    };

    management = new PgBouncer().withRlsIsolation().forManagement({
      pgBouncerPoolConfig: {
        ...pgbouncerPoolConfig,
        poolMode: "transaction_mode",
      },
      options: {
        provision: {
          role: {
            generatePassword: () => "tenant_role_password",
          },
        },
        tables: [
          { name: "rls_isolation_table" },
          {
            name: "alternative_rls_isolation_table",
            schema: "alternative_schema",
          },
        ],
      },
      id: resourceId,
    });

    await management.setup();
    tenants = new PgBouncer().withRlsIsolation().forTenants({
      id: resourceId,
      pgBouncerPoolConfig: {
        ...pgbouncerPoolConfig,
        poolMode: "transaction_mode",
      },
    });
  });

  afterAll(async () => {
    fs.rmSync(dockerComposePath);
    await management.end();
    await tenants.end();
    await environment.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    const res = await tenants.queryAs(
      tenantId,
      `SELECT current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}');`
    );
    expect(res.rows[0].current_setting).toBe(tenantId);
  });

  it("should insert a tenant data with RLS enabled", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );
  });

  it("should avoid deleting tenant data with RLS enabled", async () => {
    const tenantIdToDeleteDataFrom = crypto.randomUUID();
    await management.createTenant(tenantIdToDeleteDataFrom);
    await tenants.queryAs(
      tenantIdToDeleteDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToDeleteDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    const { rowCount } = await tenants.queryAs(
      tenantId,
      "DELETE FROM rls_isolation_table"
    );

    expect(rowCount).toBe(0);
  });

  it("should avoid updating tenant data with RLS enabled", async () => {
    const tenantIdToUpdateDataFrom = crypto.randomUUID();
    await management.createTenant(tenantIdToUpdateDataFrom);
    await tenants.queryAs(
      tenantIdToUpdateDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToUpdateDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    const { rowCount } = await tenants.queryAs(
      tenantId,
      "UPDATE rls_isolation_table SET name = $1 WHERE tenant_id = $2",
      ["updated_name", tenantIdToUpdateDataFrom]
    );

    expect(rowCount).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId1 = crypto.randomUUID();
    const tenantId2 = crypto.randomUUID();

    await management.createTenant(tenantId1);
    await management.createTenant(tenantId2);

    await tenants.queryAs(
      tenantId2,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId2, "name2"]
    );

    await tenants.queryAs(
      tenantId1,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId1, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should detect an invalid insert for a tenant with RLS", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    await expect(
      tenants.queryAs(
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
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO alternative_schema.alternative_rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    await expect(
      tenants.queryAs(
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
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    await management.deleteTenant(tenantId);
    await management.createTenant(tenantId);
    const { rowCount } = await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(rowCount).toBe(0);
  });
});

describe("Postgres RLS multi-tenant strategy with PGBouncer using pool_mode=session", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let pgbouncerPoolConfig: PoolConfig;
  let management: RlsManagement;
  let tenants: RlsTenants;
  let dockerComposePath: string;
  const resourceId: string = crypto.randomUUID();

  beforeAll(async () => {
    const { path, name } = generateDockerComposeFile("rls", "session");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    dockerComposePath = path;

    environment = await new DockerComposeEnvironment(".", dockerComposePath)
      .withEnv("PGBOUNCER_POOL_MODE", "session")
      .up();

    const clientConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    const dbClient = new Client(clientConfig);
    await dbClient.connect();
    await dbClient.query(
      "CREATE TABLE rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.query("CREATE SCHEMA alternative_schema;");
    await dbClient.query(
      "CREATE TABLE alternative_schema.alternative_rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.end();

    pgbouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      user: "testuser",
      password: "testpassword",
      database: "testdb",
    };

    management = new PgBouncer().withRlsIsolation().forManagement({
      id: resourceId,
      pgBouncerPoolConfig: { ...pgbouncerPoolConfig, poolMode: "session_mode" },
      options: {
        provision: {
          autoSetup: true,
          role: {
            generatePassword: () => "tenant_role_password",
          },
        },
        tables: [
          { name: "rls_isolation_table" },
          {
            name: "alternative_rls_isolation_table",
            schema: "alternative_schema",
          },
        ],
      },
    });
    tenants = new PgBouncer().withRlsIsolation().forTenants({
      id: resourceId,
      pgBouncerPoolConfig: {
        ...pgbouncerPoolConfig,
        poolMode: "session_mode",
      },
    });

    await management.setup();
  });

  afterAll(async () => {
    fs.rmSync(dockerComposePath);
    await management.end();
    await environment.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    const res = await tenants.queryAs(
      tenantId,
      `SELECT current_setting('${DEFAULT_SETTINGS_TENANT_FIELD}');`
    );
    expect(res.rows[0].current_setting).toBe(tenantId);
  });

  it("should insert a tenant data with RLS enabled", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );
  });

  it("should avoid deleting tenant data with RLS enabled", async () => {
    const tenantIdToDeleteDataFrom = crypto.randomUUID();
    await management.createTenant(tenantIdToDeleteDataFrom);
    await tenants.queryAs(
      tenantIdToDeleteDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToDeleteDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    const { rowCount } = await tenants.queryAs(
      tenantId,
      "DELETE FROM rls_isolation_table"
    );

    expect(rowCount).toBe(0);
  });

  it("should avoid updating tenant data with RLS enabled", async () => {
    const tenantIdToUpdateDataFrom = crypto.randomUUID();
    await management.createTenant(tenantIdToUpdateDataFrom);
    await tenants.queryAs(
      tenantIdToUpdateDataFrom,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantIdToUpdateDataFrom, "test_name"]
    );

    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    const { rowCount } = await tenants.queryAs(
      tenantId,
      "UPDATE rls_isolation_table SET name = $1 WHERE tenant_id = $2",
      ["updated_name", tenantIdToUpdateDataFrom]
    );

    expect(rowCount).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId1 = crypto.randomUUID();
    const tenantId2 = crypto.randomUUID();

    await management.createTenant(tenantId1);
    await management.createTenant(tenantId2);

    await tenants.queryAs(
      tenantId2,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId2, "name2"]
    );

    await tenants.queryAs(
      tenantId1,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId1, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
      tenants.queryAs(tenantId1, "SELECT * FROM rls_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should detect an invalid insert for a tenant with RLS", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);

    await expect(
      tenants.queryAs(
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
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO alternative_schema.alternative_rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    await expect(
      tenants.queryAs(
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
    await management.createTenant(tenantId);

    await tenants.queryAs(
      tenantId,
      "INSERT INTO rls_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    await management.deleteTenant(tenantId);
    await management.createTenant(tenantId);
    const { rowCount } = await tenants.queryAs(
      tenantId,
      "SELECT * FROM rls_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(rowCount).toBe(0);
  });
});

describe("Postgres Database multi-tenant strategy with PGBouncer using pool_mode=session", () => {
  jest.setTimeout(300000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let management: DatabaseManagement;
  let tenants: DatabaseTenants;
  let dockerComposePath: string;
  let secretsProvider: Vault;
  let vaultContainer: StartedTestContainer;
  let vaultEndpoint: string;

  beforeAll(async () => {
    // Start a local Vault container
    vaultContainer = await new GenericContainer("hashicorp/vault:latest")
      .withExposedPorts(8200)
      .withEnv("VAULT_DEV_ROOT_TOKEN_ID", "test-token")
      .withEnv("VAULT_DEV_LISTEN_ADDRESS", "0.0.0.0:8200")
      .start();

    vaultEndpoint = `http://${vaultContainer.getHost()}:${vaultContainer.getMappedPort(
      8200
    )}`;
    secretsProvider = new Vault({
      endpoint: vaultEndpoint,
      token: "test-token",
    });

    const { path, name } = generateDockerComposeFile("database", "session");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    dockerComposePath = path;

    environment = await new DockerComposeEnvironment(
      ".",
      dockerComposePath
    ).up();

    const pgBouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    management = new PgBouncer().withDatabaseIsolation().forManagement({
      pgBouncerPoolConfig: { ...pgBouncerPoolConfig, poolMode: "session_mode" },
      secrets: {
        provider: secretsProvider,
      },
      options: {
        provision: {
          role: {
            generatePassword: (tenantId: string) =>
              `secret_password_${tenantId}`,
          },
        },
        deprovision: {
          database: {
            useForceOnDelete: true,
          },
        },
      },
    });
    tenants = new PgBouncer().withDatabaseIsolation().forTenants({
      secrets: {
        provider: secretsProvider,
      },
    });

    /**
     * Configure tenants
     */
    await management.createTenant("prod");
    await management.createTenant("dev");
  });

  afterAll(async () => {
    await management.end();
    await environment.stop();
    await vaultContainer.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = "prod";
    const res = await tenants.queryAs(
      tenantId,
      `SELECT current_database(), current_user;`
    );
    expect(res.rows[0].current_database).toBe("tenant_" + tenantId);
    expect(res.rows[0].current_user).toBe("tenant_" + tenantId);
  });

  it("should create a table and insert a tenant data correctly", async () => {
    const tenantId = "prod";
    await tenants.queryAs(
      tenantId,
      `CREATE TABLE db_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);`
    );
    await tenants.queryAs(
      tenantId,
      "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM db_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    const secondTenantId = "dev";
    await tenants.queryAs(
      secondTenantId,
      `CREATE TABLE db_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);`
    );
    const { rows } = await tenants.queryAs(
      secondTenantId,
      "SELECT * FROM db_isolation_table"
    );
    expect(rows.length).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId = "prod";

    await tenants.queryAs(
      tenantId,
      "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(tenantId, "SELECT * FROM db_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM db_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM db_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should delete a tenant correctly", async () => {
    const tenantId = "dev";
    await management.deleteTenant(tenantId);
  });
});

describe("Postgres Database multi-tenant strategy with PGBouncer using pool_mode=transaction", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let management: DatabaseManagement;
  let tenants: DatabaseTenants;
  let dockerComposePath: string;
  const tenantId = "prod";
  const alternativeTenantId = "dev";

  let secretsProvider: Vault;
  let vaultContainer: StartedTestContainer;
  let vaultEndpoint: string;

  beforeAll(async () => {
    // Start a local Vault container
    vaultContainer = await new GenericContainer("hashicorp/vault:latest")
      .withExposedPorts(8200)
      .withEnv("VAULT_DEV_ROOT_TOKEN_ID", "test-token")
      .withEnv("VAULT_DEV_LISTEN_ADDRESS", "0.0.0.0:8200")
      .start();

    vaultEndpoint = `http://${vaultContainer.getHost()}:${vaultContainer.getMappedPort(
      8200
    )}`;
    secretsProvider = new Vault({
      endpoint: vaultEndpoint,
      token: "test-token",
    });

    const { path, name } = generateDockerComposeFile("database", "transaction");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    const postgresContainerName = "fahren_" + name + "_postgres";
    dockerComposePath = path;

    environment = await new DockerComposeEnvironment(
      ".",
      dockerComposePath
    ).up();

    const clientConfig = {
      host: environment.getContainer(postgresContainerName).getHost(),
      port: environment.getContainer(postgresContainerName).getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    const client = new Client(clientConfig);
    await client.connect();
    await client.query("CREATE DATABASE template_db;");
    await client.end();

    const clientTemplate = new Client({
      ...clientConfig,
      database: "template_db",
    });
    await clientTemplate.connect();
    await clientTemplate.query(
      `CREATE TABLE db_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);`
    );
    await clientTemplate.end();

    const pgBouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    management = new PgBouncer().withDatabaseIsolation().forManagement({
      pgBouncerPoolConfig: {
        ...pgBouncerPoolConfig,
        poolMode: "transaction_mode",
      },
      secrets: {
        provider: secretsProvider,
      },
      options: {
        provision: {
          database: {
            prefix: "tenant_",
          },
          role: {
            prefix: "",
            generatePassword: (tenantId: string) =>
              `secret_password_${tenantId}`,
          },
        },
        deprovision: {
          database: {
            useForceOnDelete: true,
          },
        },
      },
    });
    tenants = new PgBouncer()
      .withDatabaseIsolation()
      .forTenants({ secrets: { provider: secretsProvider } });

    const managementSessionMode = new PgBouncer()
      .withDatabaseIsolation()
      .forManagement({
        pgBouncerPoolConfig: {
          ...pgBouncerPoolConfig,
          poolMode: "session_mode",
        },
        secrets: {
          provider: secretsProvider,
        },
        options: {
          provision: {
            database: {
              prefix: "tenant_",
              template: "template_db",
            },
            role: {
              prefix: "",
              generatePassword: (tenantId: string) =>
                `secret_password_${tenantId}`,
            },
          },
          deprovision: {
            database: {
              useForceOnDelete: true,
            },
          },
        },
      });
    /**
     * Configure tenants
     */
    await managementSessionMode.createTenant(tenantId);
    await managementSessionMode.createTenant(alternativeTenantId);
    await managementSessionMode.end();
  });

  afterAll(async () => {
    await management.end();
    await environment.stop();
    await vaultContainer.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const res = await tenants.queryAs(tenantId, `SELECT current_database();`);
    expect(res.rows[0].current_database).toBe("tenant_" + tenantId);
  });

  it("should insert a tenant data correctly", async () => {
    await tenants.queryAs(
      tenantId,
      "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM db_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");
  });

  it("should detect that it is not possible to create or delete a tenant", async () => {
    const tenantId = crypto.randomUUID();

    await expect(management.createTenant(tenantId)).rejects.toThrow(
      `Tenant creation is not supported when pgBouncer is configured in transaction mode. Database creations are not possible inside transaction. Please use a different configuration and/or multi-tenant strategy.`
    );
    await expect(management.deleteTenant(tenantId)).rejects.toThrow(
      `Tenant deletion is not supported when pgBouncer is configured in transaction mode. Database deletions are not possible inside transaction. Please use a different configuration and/or multi-tenant strategy.`
    );
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    await tenants.queryAs(
      alternativeTenantId,
      "INSERT INTO db_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [alternativeTenantId, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(alternativeTenantId, "SELECT * FROM db_isolation_table"),
      tenants.queryAs(alternativeTenantId, "SELECT * FROM db_isolation_table"),
      tenants.queryAs(alternativeTenantId, "SELECT * FROM db_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });
});

describe("Postgres Schema multi-tenant strategy with PGBouncer using pool_mode=session", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let pgbouncerPoolConfig: PoolConfig;
  let management: SchemaManagement;
  let tenants: SchemaTenants;
  let dockerComposePath: string;
  const secretsProvider = new StaticProvider(({ path }: { path: string }) =>
    JSON.stringify({
      ...pgbouncerPoolConfig,
      poolMode: "transaction_mode",
      schema: `tenant_${path.substring(9, 45)}`,
    })
  );

  beforeAll(async () => {
    const { path, name } = generateDockerComposeFile("schema", "session");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    dockerComposePath = path;

    environment = await new DockerComposeEnvironment(".", dockerComposePath)
      .withEnv("PGBOUNCER_POOL_MODE", "session")
      .up();

    const clientConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    const dbClient = new Client(clientConfig);
    await dbClient.connect();
    await dbClient.query(
      "CREATE TABLE rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.query("CREATE SCHEMA alternative_schema;");
    await dbClient.query(
      "CREATE TABLE alternative_schema.alternative_rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.end();

    pgbouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      user: "testuser",
      password: "testpassword",
      database: "testdb",
    };

    management = new PgBouncer().withSchemaIsolation().forManagement({
      pgBouncerPoolConfig: {
        ...pgbouncerPoolConfig,
        poolMode: "session_mode",
      },
      secrets: {
        provider: secretsProvider,
      },
    });
    tenants = new PgBouncer().withSchemaIsolation().forTenants({
      secrets: {
        provider: secretsProvider,
      },
    });
  });

  afterAll(async () => {
    fs.rmSync(dockerComposePath);
    await management.end();
    await environment.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    const { rows } = await tenants.queryAs(tenantId, `SHOW search_path;`);
    expect(rows[0].search_path).toBe("tenant_" + tenantId);
  });

  it("should insert a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    await tenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await tenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM schema_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    const secondTenantId = crypto.randomUUID();
    await management.createTenant(secondTenantId);
    await tenants.queryAs(
      secondTenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    const { rows } = await tenants.queryAs(
      secondTenantId,
      "SELECT * FROM schema_isolation_table"
    );
    expect(rows.length).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    await tenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await tenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should create and delete a tenant correctly", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    const res = await tenants.queryAs(tenantId, `SELECT current_schema();`);
    expect(res.rows[0].current_schema).toBe("tenant_" + tenantId);
    await management.deleteTenant(tenantId);

    await management.createTenant("temporal");
    const { rows } = await tenants.queryAs(
      "temporal",
      `SELECT nspname FROM pg_catalog.pg_namespace;`
    );
    const deletedSchema = rows.find((x) => x.nspname === tenantId);
    expect(deletedSchema).toBeUndefined();
  });
});

describe("Postgres Schema multi-tenant strategy with PGBouncer using pool_mode=transaction", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds

  let environment: StartedDockerComposeEnvironment;
  let pgbouncerPoolConfig: PoolConfig;
  let management: SchemaManagement;
  let tenants: SchemaTenants;
  let dockerComposePath: string;
  const staticProvider = new StaticProvider(({ path }: { path: string }) =>
    JSON.stringify({
      ...pgbouncerPoolConfig,
      poolMode: "transaction_mode",
      schema: `tenant_${path.substring(9, 45)}`,
    })
  );

  beforeAll(async () => {
    const { path, name } = generateDockerComposeFile("schema", "transaction");
    const pgBouncerContainerName = "fahren_" + name + "_pgbouncer";
    dockerComposePath = path;

    environment = await new DockerComposeEnvironment(".", dockerComposePath)
      .withEnv("PGBOUNCER_POOL_MODE", "transaction")
      .up();

    const clientConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      database: "testdb",
      user: "testuser",
      password: "testpassword",
    };

    const dbClient = new Client(clientConfig);
    await dbClient.connect();
    await dbClient.query(
      "CREATE TABLE rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.query("CREATE SCHEMA alternative_schema;");
    await dbClient.query(
      "CREATE TABLE alternative_schema.alternative_rls_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT)"
    );
    await dbClient.end();

    pgbouncerPoolConfig = {
      host: environment.getContainer(pgBouncerContainerName).getHost(),
      port: environment
        .getContainer(pgBouncerContainerName)
        .getMappedPort(5432),
      user: "testuser",
      password: "testpassword",
      database: "testdb",
    };

    management = new PgBouncer().withSchemaIsolation().forManagement({
      pgBouncerPoolConfig: {
        ...pgbouncerPoolConfig,
        poolMode: "transaction_mode",
      },
      secrets: {
        provider: staticProvider,
      },
    });

    tenants = new PgBouncer().withSchemaIsolation().forTenants({
      secrets: {
        provider: staticProvider,
      },
    });
  });

  afterAll(async () => {
    fs.rmSync(dockerComposePath);
    await management.end();
    await environment.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    const { rows } = await tenants.queryAs(tenantId, `SHOW search_path;`);
    expect(rows[0].search_path).toBe("tenant_" + tenantId);
  });

  it("should insert a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    await tenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await tenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2)",
      [tenantId, "test_name"]
    );

    const res = await tenants.queryAs(
      tenantId,
      "SELECT * FROM schema_isolation_table WHERE tenant_id = $1",
      [tenantId]
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].name).toBe("test_name");

    const secondTenantId = crypto.randomUUID();
    await management.createTenant(secondTenantId);
    await tenants.queryAs(
      secondTenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    const { rows } = await tenants.queryAs(
      secondTenantId,
      "SELECT * FROM schema_isolation_table"
    );
    expect(rows.length).toBe(0);
  });

  it("should handle multiple queries with the same tenant_id concurrently", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    await tenants.queryAs(
      tenantId,
      "CREATE TABLE schema_isolation_table (id SERIAL PRIMARY KEY, tenant_id TEXT, name TEXT);"
    );
    await tenants.queryAs(
      tenantId,
      "INSERT INTO schema_isolation_table (tenant_id, name) VALUES ($1, $2), ($1, $2)",
      [tenantId, "name1"]
    );

    const promises = await Promise.all([
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
      tenants.queryAs(tenantId, "SELECT * FROM schema_isolation_table"),
    ]);

    for (const promise of promises) {
      const res = await promise;
      expect(res.rows.length).toBe(2);
    }
  });

  it("should create and delete a tenant correctly", async () => {
    const tenantId = crypto.randomUUID();
    await management.createTenant(tenantId);
    const res = await tenants.queryAs(tenantId, `SELECT current_schema();`);
    expect(res.rows[0].current_schema).toBe("tenant_" + tenantId);
    await management.deleteTenant(tenantId);

    await management.createTenant("temporal");
    const { rows } = await tenants.queryAs(
      "temporal",
      `SELECT nspname FROM pg_catalog.pg_namespace;`
    );
    const deletedSchema = rows.find((x) => x.nspname === tenantId);
    expect(deletedSchema).toBeUndefined();
  });
});
