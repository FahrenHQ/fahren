# @fahren/redis

A streamlined solution for implementing multi-tenant Redis isolation in your applications. This package helps you manage tenant data separation while maintaining the simplicity and performance that Redis offers.

## Installation

```bash
# Using npm
npm install @fahren/redis

# Using yarn
yarn add @fahren/redis

# Using pnpm
pnpm add @fahren/redis
```

## Isolation Strategies

### Prefix-Based Isolation

Uses key prefixes to separate tenant data within the same Redis instance.

```typescript
import Redis from "@fahren/redis";

const redis = new Redis().withPrefixIsolation().forTenants();

// Get a tenant-specific client
const tenantClient = redis.getClientFor("tenant123");

// Keys will be automatically prefixed with "tenant123:"
await tenantClient.set("user:1:profile", JSON.stringify({ name: "John" }));
```

### ACL-Based Isolation

Leverages Redis Access Control Lists (ACLs) to enforce stronger isolation between tenants.

```typescript
import Redis from "@fahren/redis";
import { AwsSecretsManager } from "@fahren/secrets";

const options = { secrets: { provider: new AwsSecretsManager() } };
const redis = new Redis().withAclIsolation();
const redisManagement = redis.forManagement(options);
const redisTenants = redis.forTenants(options);

// Set up tenant (creates Redis ACL user)
await redisManagement.createTenant("tenant123");

// Get a client for the tenant
const tenantClient = redisTenants.getClientFor("tenant123");

// Use like a normal Redis client
await tenantClient.set("key", "value");
const result = await tenantClient.get("key");

// When a tenant is no longer needed
await redisManagement.deleteTenant("tenant123");
```

## Features

- **Automatic Key Prefixing**: Keys are automatically prefixed with tenant identifiers
- **ACL Management**: Automatic creation and deletion of Redis ACL users
- **Secrets Integration**: Secure storage of tenant credentials using secrets providers for ACL-based isolation
- **Command Restrictions**: Optional blocking of dangerous commands for ACL-based isolation

## Security Considerations

### Prefix-Based Isolation

- **Pros**:
  - Simple implementation
  - Efficient resource utilization
  - Works with any Redis deployment
- **Cons**:
  - No command-level restrictions
  - Relies on application-level security

### ACL-Based Isolation

- **Pros**:
  - Strong security isolation
  - Command-level restrictions
  - Better audit capabilities
- **Cons**:
  - Requires Redis 6.0 or higher
  - Slightly higher connection overhead
  - Requires Secrets Provider

## Related Resources

- [Redis ACL Documentation](https://redis.io/docs/manual/security/acl/)
- [Fahren Documentation](https://github.com/joacoc/fahren)
