# Fahren

Fahren is a toolkit for implementing multi-tenant strategies at both the application and infrastructure level.

## Using Fahren

Fahren exposes two intuitive APIs that help you separate tenant management from tenant usage:

```typescript
import Postgres from "@fahren/postgres";

// Choose isolation strategy
const postgres = new Postgres().withDatabaseIsolation();

// Management API for provisioning
const management = postgres.forManagement();
await management.createTenant("tenant123");

// Tenant-aware API
const tenants = postgres.forTenants();
const result = await tenants.queryAs("tenant123", "SELECT * FROM orders");
```

This separation creates a clear boundary between provisioning (e.g. databases, roles, Redis namespaces, etc.) and tenant-aware operations, so each part of your app/service does exactly what it needs to, and nothing more.

### Highlights

- **Management**  
  Automates tenant logical resources with:
  - `management.createTenant(tenantId)` to provision all necessary logical resources
  - `management.deleteTenant(tenantId)` to clean up completely when needed.
- **Tenants**  
  Wraps infrastructure clients like Postgres or Redis with built-in tenant logic, so you don’t need to reinvent the wheel.

### Built-in Security Practices

Fahren takes a **gradual approach to security**. Light isolation strategies require minimal setup. Stronger isolation (like database-per-tenant) integrates with secret managers like AWS Secrets Manager or Vault to store tenants sensitive information. The library makes these requirements explicit, **guiding you to the right level of security for your use case.**

## Installation

```bash
# Install specific resource packages as needed
npm install @fahren/postgres @fahren/redis

# Using yarn
yarn add @fahren/postgres @fahren/redis

# Using pnpm
pnpm add @fahren/postgres @fahren/redis
```

## Resources

In Fahren, **resources** are infrastructure components that support at least one multi-tenant strategy, such as Postgres or Redis. Resources require at least one isolation strategy to determine how tenants remain **secure** and **isolated**.

### Supported Databases

- **[Postgres](https://github.com/joacoc/fahren/tree/main/packages/postgres)** - Row-Level Security (RLS), schema, and database-based isolation
- **[Redis](https://github.com/joacoc/fahren/tree/main/packages/redis)** - Prefix and ACL-based isolation with secrets management

## Usage Examples

### Postgres with Row-Level Security (RLS)

```typescript
import Postgres from "@fahren/postgres";

const postgres = new Postgres().withRlsIsolation();
const connectionOptions = {
  connectionString: "postgres://user:password@host:5432/db",
};

const management = postgresResource.forManagement(connectionOptions, {
  autoSetup: true, // Automatically sets up RLS policies when first tenant is created
});
await management.createTenant("acme-inc");

const tenants = postgres.forTenants(connectionOptions);
const result = await tenants.queryAs(
  "acme-inc",
  "SELECT SUM(cost) FROM orders;"
);
```

### Redis with ACL

For tight isolation levels that require tenant-specific credentials, Fahren integrates with secrets providers to store and retrieve sensitive fields.

```typescript
import Redis from "@fahren/redis";
import { AwsSecretsManager } from "@fahren/secrets";

const redisManagement = new Redis()
  .withAclIsolation()
  .forManagement({ secrets });
await redis.createTenant("tenant123");

const redisTenants = new Redis().withAclIsolation().forTenants({ secrets });
const tenantRedisClient = redisTenants.getClientFor("tenant123");
await tenantRedisClient.set("key", "value");
```

## Examples

For complete multi-tenant application examples, visit the [examples folder](https://github.com/joacoc/fahren/tree/main/examples).

## API Reference

For detailed API documentation of each resource, refer to the specific package documentation:

- [@fahren/postgres](https://github.com/joacoc/fahren/tree/main/packages/postgres)
- [@fahren/redis](https://github.com/joacoc/fahren/tree/main/packages/redis)
