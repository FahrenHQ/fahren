import {
  ResourceOptions,
  TenantsSecrets,
  TenantsSecretsManager,
} from "@fahren/core";
import RedisResource, { ClientConfig, RedisManagementBase } from "./base";
import { RedisClient as ExtendedRedisClient } from "../";

export interface Provision {
  acl?: {
    /**
     * An optional flag to enable potentially unsafe or
     * destructive commands, such as FLUSHALL, FLUSHDB, CONFIG, SAVE, MONITOR.
     * Use with caution as enabling this may allow commands that
     * could alter or delete critical data.
     *
     * @default false
     */
    enableDangerousCommands?: boolean;

    /**
     * Function that generates a password for the tenant's ACL.
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
     * If not provided, Fahren will automatically generate a secure random password.
     *
     * @returns A string containing the password or a Promise that resolves to the password
     */
    generatePassword?: (tenantId: string) => string | Promise<string>;
  };
}

export interface AclIsolationOptions
  extends Omit<ResourceOptions, "deprovision"> {
  provision?: Provision;
}

export class RedisAclManagement extends RedisManagementBase {
  private enableDangerousCommands: boolean;
  private tenantsSecretsManager: TenantsSecretsManager<ClientConfig>;
  private options?: AclIsolationOptions;
  protected config?: ClientConfig;

  constructor({
    clientConfig,
    options,
    secrets,
    id,
  }: {
    clientConfig?: ClientConfig;
    options?: AclIsolationOptions;
    secrets: TenantsSecrets;
    id?: string;
  }) {
    super({ clientConfig, id });
    this.config = clientConfig;

    this.options = options;
    this.tenantsSecretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );

    if (options?.provision?.acl?.enableDangerousCommands) {
      this.enableDangerousCommands = true;
    } else {
      this.enableDangerousCommands = false;
    }
  }

  /**
   * Creates a new tenant in the Redis ACL system with the specified `tenantId`.
   *
   * If `enableDangerousCommands` is set to `true`, the tenant will have unrestricted
   * access to all commands. Otherwise, access to dangerous commands such as `FLUSHALL`,
   * `FLUSHDB`, `CONFIG`, `SAVE`, and `MONITOR` will be blocked, and the tenant's access
   * will be restricted to its own keyspace.
   *
   * Running this function twice for the same `tenantId` will not throw an error,
   * but it will overwrite the previous setup for that tenant.
   *
   * @param tenantId - The unique identifier for the tenant.
   * @returns A promise that resolves when the tenant is successfully created.
   */
  async createTenant(tenantId: string) {
    const generatedTenantPassword = this.options?.provision?.acl
      ?.generatePassword
      ? await this.options?.provision?.acl?.generatePassword(tenantId)
      : await this.tenantsSecretsManager.generatePassword();
    const password =
      (generatedTenantPassword && `>${generatedTenantPassword}`) || "nopass";
    const keyspacePrefix = this.buildKeyspacePrefix(tenantId);

    if (this.enableDangerousCommands) {
      await this.adminRedis.call(
        "ACL",
        "SETUSER",
        tenantId,
        "on",
        password || "nopass",
        `~${keyspacePrefix}*`,
        "+@all"
      );
    } else {
      await this.adminRedis.call(
        "ACL",
        "SETUSER",
        tenantId,
        "on",
        password || "nopass",
        // Restrict access to tenant's keyspace
        `~${keyspacePrefix}*`,
        "+@all",
        // Block dangerous commands
        "-@dangerous"
      );
    }

    await this.tenantsSecretsManager.store(tenantId, {
      ...this.config,
      username: tenantId,
      password: generatedTenantPassword,
      keyPrefix: keyspacePrefix,
    });
  }

  async deleteTenant(tenantId: string) {
    await super.deleteTenant(tenantId);
    await this.adminRedis.call("ACL", "DELUSER", tenantId);
    await this.tenantsSecretsManager.remove(tenantId);
  }
}

export class RedisAclTenants extends RedisResource {
  private secretsManager: TenantsSecretsManager<ClientConfig>;
  constructor({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    super({
      id,
    });
    this.secretsManager = new TenantsSecretsManager(
      secrets,
      this.getPattern(),
      id
    );
  }

  async getClientFor(tenantId: string) {
    const tenantConfig = await this.secretsManager.get(tenantId);

    if (!tenantConfig.keyPrefix) {
      throw new Error("Tenant key prefix is not set");
    }

    return new ExtendedRedisClient({
      ...tenantConfig,
      keyPrefix: tenantConfig.keyPrefix,
    });
  }
}
