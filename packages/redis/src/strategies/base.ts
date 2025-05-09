import RedisClient, { RedisOptions } from "ioredis";
import { Resource } from "@fahren/core";

export type ClientConfig = Exclude<RedisOptions, "keyPrefix">;
export const DEFAULT_SECRETS_PATTERN = `/tenants/{tenantId}/redis/connection`;
export const DEFAULT_SECRETS_WITH_RESOURCE_ID_PATTERN = `/tenants/{tenantId}/redis/{resourceId}/connection`;
export const DEFAULT_SHARED_SECRETS_PATTERN = `/shared/redis/connection`;
export const DEFAULT_SHARED_SECRETS_WTIH_RESOURCE_ID_PATTERN = `/shared/redis/{resourceId}/connection`;

/**
 * A custom Redis client that extends the functionality of the `ioredis` Client.
 * This client adds support for a configurable key prefix and provides a method
 * to retrieve keys without the prefix.
 *
 * Ref: https://github.com/redis/ioredis/issues/239#issuecomment-178683
 */
export class ExtendedRedisClient extends RedisClient {
  /**
   * The prefix to be applied to all keys used by this client.
   */
  keyPrefix: string;

  constructor(config: ClientConfig & { keyPrefix: string }) {
    super(config);
    this.keyPrefix = config.keyPrefix;
  }

  async keys(pattern: string): Promise<string[]> {
    const regExp = new RegExp(`^(${this.keyPrefix})`);
    const keysWithPrefix = await super.keys(`${this.keyPrefix}${pattern}`);

    return keysWithPrefix.map((key) => {
      return key.replace(regExp, "");
    });
  }
}

export default abstract class RedisResource extends Resource {
  protected config?: RedisOptions;
  // protected adminRedis: RedisClient;

  constructor({
    clientConfig,
    id,
  }: {
    clientConfig?: ClientConfig;
    id?: string;
  }) {
    super({ id });
    this.config = clientConfig;
    if (this.config) {
      this.config.keyPrefix = undefined;
    }
  }

  protected getPattern() {
    if (this.id) {
      return DEFAULT_SECRETS_WITH_RESOURCE_ID_PATTERN.replace(
        "{resourceId}",
        this.id
      );
    } else {
      return DEFAULT_SECRETS_PATTERN;
    }
  }

  protected buildKeyspacePrefix(tenantId: string) {
    if (this.config?.keyPrefix) {
      return `tenant:${tenantId}:${this.config.keyPrefix}:`;
    } else {
      return `tenant:${tenantId}:`;
    }
  }
}

export class RedisManagementBase extends RedisResource {
  protected adminRedis: RedisClient;

  constructor({
    clientConfig,
    id,
  }: {
    clientConfig?: ClientConfig;
    id?: string;
  }) {
    super({ id, clientConfig });
    this.adminRedis = this.config
      ? new RedisClient(this.config)
      : new RedisClient();
  }

  async deleteTenant(tenantId: string) {
    const prefix = await this.buildKeyspacePrefix(tenantId);

    const keys = await this.adminRedis.keys(prefix + "*");
    if (keys.length > 0) {
      const pipeline = this.adminRedis.pipeline();
      keys.forEach((key) => pipeline.del(key));
      await pipeline.exec();
    }
  }

  async end() {
    await this.adminRedis.quit();
  }
}
