import { ClientConfig, RedisManagementBase } from "./base";
import { RedisClient as ExtendedRedisClient } from "../";
import RedisResource from "./base";

export const DEFAULT_ACL_USERNAME = "tenant_acl";

export class RedisPrefixManagement extends RedisManagementBase {
  options: { autosetup?: boolean };

  constructor({
    clientConfig,
    id,
    options,
  }: {
    options?: { autosetup?: boolean };
    clientConfig?: ClientConfig;
    id?: string;
  }) {
    super({ clientConfig, id });
    this.options = { autosetup: options?.autosetup || false };
  }

  async setup(): Promise<void> {
    await this.adminRedis.call(
      "ACL",
      "SETUSER",
      DEFAULT_ACL_USERNAME,
      "on",
      "nopass",
      // Restrict access to tenants keyspace
      `~tenant:*`,
      "+@all",
      // Block dangerous commands
      "-@dangerous"
    );
  }

  async createTenant(): Promise<void> {
    if (this.options.autosetup) {
      const existingUsers = await this.adminRedis.acl("LIST");
      const userExists = existingUsers.some((user: string) =>
        user.startsWith(`user ${DEFAULT_ACL_USERNAME}`)
      );

      if (!userExists) {
        await this.setup();
      }
    }
  }
}

export class RedisPrefixTenants extends RedisResource {
  private clientConfig?: ClientConfig;
  constructor({
    clientConfig,
    id,
  }: {
    clientConfig?: ClientConfig;
    id?: string;
  }) {
    super({ id });
    this.clientConfig = clientConfig;
  }

  protected buildKeyspacePrefix(tenantId: string) {
    if (this.clientConfig?.keyPrefix) {
      return `tenant:${tenantId}:${this.clientConfig.keyPrefix}:`;
    } else {
      return `tenant:${tenantId}:`;
    }
  }

  async getClientFor(tenantId: string) {
    return new ExtendedRedisClient({
      ...this.clientConfig,
      keyPrefix: this.buildKeyspacePrefix(tenantId),
      username: DEFAULT_ACL_USERNAME,
      // Default ACL has no permissions to run the 'info' command
      enableReadyCheck: false,
    });
  }
}
