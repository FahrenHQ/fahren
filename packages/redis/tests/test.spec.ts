import { GenericContainer, StartedTestContainer } from "testcontainers";
import RedisClient from "ioredis";
import Redis from "../src";
import { AwsSecretsManager } from "@fahren/secrets";
import {
  DEFAULT_ACL_USERNAME,
  RedisPrefixManagement,
  RedisPrefixTenants,
} from "../src/strategies/prefix";
import { RedisAclManagement, RedisAclTenants } from "../src/strategies/acl";

describe("Redis Prefix multi-tenant strategy", () => {
  let container: StartedTestContainer;
  let redisResource: RedisPrefixManagement;
  let redisTenants: RedisPrefixTenants;
  let adminClient: RedisClient;

  beforeAll(async () => {
    container = await new GenericContainer("redis")
      .withExposedPorts(6379)
      .start();
    redisResource = new Redis().withPrefixIsolation().forManagement({
      clientConfig: {
        port: container.getMappedPort(6379),
      },
      options: {
        autosetup: true,
      },
    });
    redisTenants = new Redis().withPrefixIsolation().forTenants({
      clientConfig: {
        port: container.getMappedPort(6379),
      },
    });
    adminClient = redisResource.getAdminClient();
    await redisResource.createTenant();
  });

  afterAll(async () => {
    await container.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";
    await tenantClient.set(key, "14");
    expect(await tenantClient.get(key)).toBe("14");

    expect(await adminClient.get(`tenant:${tenantId}:${key}`)).toBe("14");
  });

  it("should not be able to get the value from other tenant", async () => {
    const tenantId = crypto.randomUUID();
    const secondaryTenantId = crypto.randomUUID();
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";
    await tenantClient.set(key, "14");
    expect(await tenantClient.get(key)).toBe("14");

    expect(await adminClient.get(`tenant:${tenantId}:${key}`)).toBe("14");

    const secondaryTenantClient = await redisTenants.getClientFor(
      secondaryTenantId
    );
    expect(await secondaryTenantClient.get(key)).toBe(null);
  });

  it("shouldn't be able to return keys", async () => {
    const tenantId = crypto.randomUUID();
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key2 = "product_456";
    const key3 = "product_789";

    await tenantClient.set(key2, "value2");
    await tenantClient.set(key3, "value3");

    expect(tenantClient.keys("product*")).rejects.toThrow(
      `NOPERM User ${DEFAULT_ACL_USERNAME} has no permissions to run the 'keys' command`
    );
  });

  it("should delete a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";

    // Hashmaps
    const hashKey = "user_1";
    await tenantClient.hset(hashKey, "name", "John", "age", "30");
    expect(await tenantClient.hget(hashKey, "name")).toBe("John");
    expect(await tenantClient.hget(hashKey, "age")).toBe("30");
    await redisResource.deleteTenant(tenantId);
    expect(await tenantClient.hget(hashKey, "name")).toBe(null);

    // Lists
    const listKey = "tasks";
    await tenantClient.rpush(listKey, "task1", "task2", "task3");
    expect(await tenantClient.lrange(listKey, 0, -1)).toEqual([
      "task1",
      "task2",
      "task3",
    ]);
    await redisResource.deleteTenant(tenantId);
    expect(await tenantClient.lrange(listKey, 0, -1)).toEqual([]);

    // Sets
    const setKey = "tags";
    await tenantClient.sadd(setKey, "tag1", "tag2", "tag3");
    expect(await tenantClient.smembers(setKey)).toEqual(
      expect.arrayContaining(["tag1", "tag2", "tag3"])
    );
    await redisResource.deleteTenant(tenantId);
    expect(await tenantClient.smembers(setKey)).toEqual([]);

    // Sorted Sets
    const zsetKey = "scores";
    await tenantClient.zadd(zsetKey, 10, "player1", 20, "player2");
    expect(await tenantClient.zrange(zsetKey, 0, -1, "WITHSCORES")).toEqual([
      "player1",
      "10",
      "player2",
      "20",
    ]);
    await redisResource.deleteTenant(tenantId);
    expect(await tenantClient.zrange(zsetKey, 0, -1)).toEqual([]);
    await tenantClient.set(key, "14");
    expect(await tenantClient.get(key)).toBe("14");
    await redisResource.deleteTenant(tenantId);
    expect(await tenantClient.get(key)).toBe(null);
  });
});

describe("Redis ACL multi-tenant strategy", () => {
  let container: StartedTestContainer;
  let redisResource: RedisAclManagement;
  let redisTenants: RedisAclTenants;
  let adminClient: RedisClient;

  let secretsProvider: AwsSecretsManager;
  let secretsManagerContainer: StartedTestContainer;
  let secretsManagerEndpoint: string;

  beforeAll(async () => {
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

    container = await new GenericContainer("redis")
      .withExposedPorts(6379)
      .start();
    const secrets = { provider: secretsProvider };
    redisResource = new Redis().withAclIsolation().forManagement({
      clientConfig: { port: container.getMappedPort(6379) },
      secrets,
    });
    redisTenants = new Redis().withAclIsolation().forTenants({ secrets });
    adminClient = redisResource.getAdminClient();
  });

  afterAll(async () => {
    await container.stop();
    await secretsManagerContainer.stop();
  });

  it("should detect a correct tenant settings", async () => {
    const tenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";
    await tenantClient.set(key, "14");

    expect(await tenantClient.get(key)).toBe("14");
    expect(await adminClient.get(`tenant:${tenantId}:${key}`)).toBe("14");
  });

  it("should not be able to get the value from other tenant", async () => {
    const tenantId = crypto.randomUUID();
    const secondaryTenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    await redisResource.createTenant(secondaryTenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";
    await tenantClient.set(key, "14");

    expect(await tenantClient.get(key)).toBe("14");
    expect(await adminClient.get(`tenant:${tenantId}:${key}`)).toBe("14");

    const secondaryTenantClient = await redisTenants.getClientFor(
      secondaryTenantId
    );
    expect(await secondaryTenantClient.get(key)).toBe(null);
  });

  it("should throw error getting keys", async () => {
    const tenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key2 = "product_456";
    const key3 = "product_789";

    await tenantClient.set(key2, "value2");
    await tenantClient.set(key3, "value3");

    expect(tenantClient.keys("product*")).rejects.toThrow(
      `NOPERM User ${tenantId} has no permissions to run the 'keys' command`
    );
  });

  it("shound't be able to flush all keys", async () => {
    const tenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    await expect(tenantClient.flushall()).rejects.toThrow(
      `NOPERM User ${tenantId} has no permissions to run the 'flushall' command`
    );
  });

  it("shound't be able to flush the db", async () => {
    const tenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    await expect(tenantClient.flushdb()).rejects.toThrow(
      `NOPERM User ${tenantId} has no permissions to run the 'flushdb' command`
    );
  });

  it("should delete a tenant data correctly", async () => {
    const tenantId = crypto.randomUUID();
    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);
    const key = "order_123";

    // Hashmaps
    const hashKey = "user_1";
    await tenantClient.hset(hashKey, "name", "John", "age", "30");
    expect(await tenantClient.hget(hashKey, "name")).toBe("John");
    expect(await tenantClient.hget(hashKey, "age")).toBe("30");

    // Lists
    const listKey = "tasks";
    await tenantClient.rpush(listKey, "task1", "task2", "task3");
    expect(await tenantClient.lrange(listKey, 0, -1)).toEqual([
      "task1",
      "task2",
      "task3",
    ]);

    // Sets
    const setKey = "tags";
    await tenantClient.sadd(setKey, "tag1", "tag2", "tag3");
    expect(await tenantClient.smembers(setKey)).toEqual(
      expect.arrayContaining(["tag1", "tag2", "tag3"])
    );

    // Sorted Sets
    const zsetKey = "scores";
    await tenantClient.zadd(zsetKey, 10, "player1", 20, "player2");
    expect(await tenantClient.zrange(zsetKey, 0, -1, "WITHSCORES")).toEqual([
      "player1",
      "10",
      "player2",
      "20",
    ]);

    await tenantClient.set(key, "14");
    expect(await tenantClient.get(key)).toBe("14");

    await redisResource.deleteTenant(tenantId);

    // Check if all data is deleted impersonating the tenant user
    const prefixed = (key: string) => `tenant:${tenantId}:${key}`;
    expect(await adminClient.smembers(prefixed(setKey))).toEqual([]);
    expect(await adminClient.zrange(prefixed(zsetKey), 0, -1)).toEqual([]);
    expect(await adminClient.get(prefixed(key))).toBe(null);
    expect(await adminClient.lrange(prefixed(listKey), 0, -1)).toEqual([]);
    expect(await adminClient.hget(prefixed(hashKey), "name")).toBe(null);
  });

  it("should enable dangerous commands when provisioned", async () => {
    const tenantId = crypto.randomUUID();
    redisResource = new Redis().withAclIsolation().forManagement({
      clientConfig: {
        port: container.getMappedPort(6379),
      },
      secrets: {
        provider: secretsProvider,
      },
      options: {
        provision: { acl: { enableDangerousCommands: true } },
      },
    });

    await redisResource.createTenant(tenantId);
    const tenantClient = await redisTenants.getClientFor(tenantId);

    // Dangerous command: FLUSHALL
    await expect(tenantClient.flushall()).resolves.not.toThrow();
  });

  it("should throw an error for an invalid tenant config", async () => {
    const invalidTenantId = crypto.randomUUID();
    await expect(redisTenants.getClientFor(invalidTenantId)).rejects.toThrow(
      // `Tenant configuration for ${invalidTenantId} does not exist`
      "Secrets Manager can't find the specified secret"
    );
  });
});
