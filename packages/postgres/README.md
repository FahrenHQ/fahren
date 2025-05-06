# @fahren/postgres

Implement multi-tenant strategies over PostgreSQL.

## Installation

```bash
# Using npm
npm install @fahren/postgres

# Using yarn
yarn add @fahren/postgres

# Using pnpm
pnpm add @fahren/postgres
```

## Isolation Strategies

### Row-Level Security (RLS)

Uses PostgreSQL's Row-Level Security to separate tenant data within the same tables.

**Prerequisite**: Before using RLS, you must either:

- Run `setup()` to configure RLS policies for your tables, or
- Call `createTenant()` at least once with `autoSetup: true` in the options

```typescript
import Postgres from "@fahren/postgres";

const poolConfig = {
  connectionString: "postgres://user:password@host:port",
};
const management = new Postgres().withRlsIsolation().forManagement({
  poolConfig,
  options: {
    provision: {
      autoSetup: true,
    },
  },
  id: resourceId,
});
await management.createTenant("tenant123");

const postgresTenants = new Postgres()
  .withRlsIsolation()
  .forTenants({ poolConfig });

const tenantClient = await postgresTenants.queryAs(
  "tenant123",
  "SELECT * FROM users"
);
```

### Schema-Based Isolation

Creates separate schemas for each tenant within the same database.

```typescript
import Postgres from "@fahren/postgres";
import { AwsSecretsManager } from "@fahren/secrets";

const poolConfig = {
  connectionString: "postgres://user:password@host:port",
};
const postgres = new Postgres().withSchemaIsolation();
const management = postgres.forManagement({
  poolConfig,
  secrets: {
    provider: new AwsSecretsManager(),
  },
  id: resourceId,
});

const tenants = postgres.forTenants({
  secrets: {
    provider: new AwsSecretsManager(),
  },
  id: resourceId,
});

// Creates schema "tenant_acme_inc" and role
await management.createTenant("acme_inc");

// Automatically uses the correct schema
const tenantClient = await postgres.getClientFor("acme_inc");
await tenants.query("SELECT * FROM users");

// Removes the schema and role
await management.deleteTenant("acme_inc");
```

### Database-Based Isolation

Creates separate databases for each tenant, providing maximum isolation.

```typescript
import Postgres from "@fahren/postgres";
import { AwsSecretsManager } from "@fahren/secrets";

const poolConfig = {
  connectionString: "postgres://user:password@host:port",
};
const secretsProvider = new AwsSecretsManager();
const postgres = new Postgres().withDatabaseIsolation().forManagement({
  poolConfig,
  secrets: {
    provider: secretsProvider,
  },
});

// Creates database "tenant_acme_inc" and role
await postgres.createTenant("acme_inc");

// Automatically connects to the right database using secrets
const tenantClient = await postgres.getClientFor("acme_inc");
await tenantClient.query("SELECT * FROM analytics");

// Removes the database and role
await postgres.deleteTenant("acme_inc");
```

## PgBouncer

If you're using PgBouncer as a connection pooler, you should use the PgBouncer-specific client:

```typescript
import Postgres from "@fahren/postgres";

const postgres = new Postgres()
  .withPgBouncer()
  .withRlsIsolation()
  .forTenants({
    poolConfig: {
      connectionString: "postgres://user:password@host:5432/db",
      poolMode: "session_mode", // or "transaction_mode"
    },
  });
```

### PgBouncer Limitations

- **Transaction Mode**: When using `transaction_mode`:

  - Database-based isolation is not supported (cannot create/delete databases inside transactions)
  - Each query is automatically wrapped in a transaction
  - Connections are returned to the pool after each query

- **Session Mode**: When using `session_mode`:

  - All isolation strategies are supported
  - Connections maintain their session state
  - You must manually manage transactions

- **Role Management**: When creating tenants with login-enabled roles, you must manually update PgBouncer to grant access to PostgreSQL.

## Features

- **Multiple Isolation Strategies**: Choose between RLS, schema, or database-based isolation
- **Automatic Tenant Management**: Create and delete tenant resources with a single call
- **Secrets Integration**: Secure storage of tenant credentials using secrets providers
- **Connection Pooling**: Efficient connection management for each tenant
- **Role-Based Access Control**: Automatic role creation and permission management

## Security Considerations

### Row-Level Security (RLS)

- **Pros**:
  - Efficient resource utilization
  - Simplified schema management
  - Easy global queries across all tenants
- **Cons**:
  - Requires careful policy configuration
  - Added WHERE clause overhead on queries

### Schema-Based Isolation

- **Pros**:
  - Better isolation than RLS
  - Simplified backup and restore per tenant
  - Allows for tenant-specific schema modifications
- **Cons**:
  - More complex global queries
  - Higher number of database objects

### Database-Based Isolation

- **Pros**:
  - Maximum isolation level
  - Tenant-specific database configuration
- **Cons**:
  - Higher resource requirements
  - More complex backup strategies
  - More overhead for cross-tenant operations

## Related Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Fahren Documentation](https://github.com/joacoc/fahren)
