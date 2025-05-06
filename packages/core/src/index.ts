/**
 * A resource represents an infrastructure component, such as Postgres or Redis.
 *
 * Resources handle logical infrastructure elements internally (e.g., database roles
 * and tables in Postgres, or Access Control Lists in Redis). When creating or
 * deleting a tenant, the resource automatically manages all necessary logical
 * resources for proper tenant isolation.
 */
export abstract class Resource {
  protected id?: string;
  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }
}

export interface Management {
  /**
   * Creates all necessary logical resources for a tenant
   * @param id The tenant identifier
   */
  createTenant(id: string): Promise<void>;

  /**
   * Removes all logical resources associated with a tenant
   * @param id The tenant identifier
   */
  deleteTenant(id: string): Promise<void>;
}

/**
 * Extends `Resource` to provide tenant-specific client instances.
 *
 * ResourceWithClient provides "sugar-coated" client interfaces that abstract away
 * multi-tenant complexity. These client wrappers offer a cleaner, safer, and more
 * ergonomic API specifically designed for tenant-aware operations.
 *
 * @template T The type of client that will be returned for tenant operations
 */
export abstract class ResourceWithClient<T> extends Resource {
  constructor(id?: string) {
    super({ id });
  }

  /**
   * Returns a tenant-specific client instance
   * @param tenantId The tenant identifier
   * @returns A client instance configured for the specific tenant
   */
  abstract getClientFor(tenantId: string): Promise<T>;

  /**
   * Ends all connections to the resource
   * @returns A promise that resolves when all connections are closed
   * @throws Error if the resource cannot be closed
   */
  abstract end(): Promise<void>;
}

/**
 * Interface for secret providers
 */
export interface SecretsProvider {
  getSecret(path: string): Promise<string>;
  deleteSecret(path: string): Promise<void>;
  createSecret(path: string, value: string): Promise<void>;
  updateSecret(path: string, value: string): Promise<void>;
}

/**
 * Interface for secret providers
 */
export interface IdentityAccessProvider {
  deleteAccess(path: string): Promise<void>;
  createAccess(path: string, value: string): Promise<void>;
  updateAccess(path: string, value: string): Promise<void>;
  assumeAccess(roleName: string, duration?: number): Promise<unknown>;
}

export interface TenantIdentityAccessControl {
  provider: IdentityAccessProvider;
  pattern?: string;
}

export interface TenantsSecrets {
  /**
   * A secret manager for storing tenant-specific database credentials.
   * If provided, credentials for tenant databases will be generated, stored and retrieved
   * using this secret manager.
   */
  provider: SecretsProvider;

  /**
   * A pattern for the secret name used to store tenant-specific sensible details.
   * The pattern should include a placeholder for the tenant ID and the resource name, e.g. `/tenants/{tenantId}/[resource]/connection`.
   * The placeholder `{tenantId}` will be replaced with the actual tenant ID, and `[resource]` should match the specific Resource being used.
   *
   * @example '/tenants/{tenantId}/postgres/connection'
   */
  pattern?: string;
}

/**
 * Type guard to check if the provided options are a valid SecretsProvider
 */
export function isSecretsProvider(
  options: unknown
): options is SecretsProvider {
  return (
    typeof (options as SecretsProvider).getSecret === "function" &&
    typeof (options as SecretsProvider).deleteSecret === "function" &&
    typeof (options as SecretsProvider).createSecret === "function"
  );
}

export interface ResourceOptions {
  /**
   * Options for provisioning, used only during tenant creation (`createTenant`).
   */
  provision?: unknown;

  /**
   * Options for deprovisioning, used only during tenant deletion (`deleteTenant`).
   */
  deprovision?: unknown;
}

export interface ResourceOptionsWithSecrets extends ResourceOptions {
  /**
   * Stores tenant's sensitive information in a secret manager.
   */
  secrets: TenantsSecrets;

  /**
   * IAM control for tenant resources
   */
  identityAccessControl?: TenantIdentityAccessControl;
}

export class TenantsSecretsManager<T> {
  protected options: TenantsSecrets;
  protected pattern: string;
  protected resourceId?: string;

  constructor(
    options: TenantsSecrets,
    defaultPattern: string,
    resourceId: string | undefined
  ) {
    this.options = options;
    this.pattern = options.pattern || defaultPattern;
    this.resourceId = resourceId;
  }

  protected getPath(tenantId: string): string {
    if (this.resourceId) {
      return this.pattern
        .replace("{tenantId}", tenantId)
        .replace("{resourceId}", this.resourceId);
    } else {
      return this.pattern.replace("{tenantId}", tenantId);
    }
  }

  async store(tenantId: string, secret: T) {
    const path = this.getPath(tenantId);
    await this.options.provider.createSecret(path, JSON.stringify(secret));
  }

  async update(tenantId: string, secret: T) {
    const path = this.getPath(tenantId);
    await this.options.provider.updateSecret(path, JSON.stringify(secret));
  }

  async remove(tenantId: string) {
    const path = this.getPath(tenantId);
    await this.options.provider.deleteSecret(path);
  }

  async get(tenantId: string): Promise<T> {
    const path = this.getPath(tenantId);
    const clientConfig = await this.options.provider.getSecret(path);
    try {
      return JSON.parse(clientConfig);
    } catch (err) {
      console.error(
        "Error parsing secret. Make sure the secret is a valid JSON string."
      );
      throw err;
    }
  }

  async generatePassword(length = 24): Promise<string> {
    const validChars =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let generatedPassword = "";

    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);

    for (let i = 0; i < length; i++) {
      generatedPassword += validChars[randomValues[i] % validChars.length];
    }

    return generatedPassword;
  }
}
