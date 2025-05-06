import { PoolClient, QueryConfig } from "pg";
import { Resource } from "@fahren/core";
import { Local } from "@fahren/secrets";

export const DEFAULT_SETTINGS_TENANT_FIELD = "app.current_tenant";
export const DEFAULT_ROLE = "tenant_role";
export const DEFAULT_TENANT_ID_COLUMN = "tenant_id";
export const DEFAULT_TENANT_DB_PREFIX = "tenant_";
export const DEFAULT_TENANT_SCHEMA_PREFIX = "tenant_";
export const DEFAULT_TENANT_ROLE_PREFIX = "tenant_";
export const DEFAULT_SECRETS_PATTERN = `/tenants/{tenantId}/postgres/connection`;
export const DEFAULT_SECRETS_WITH_RESOURCE_ID_PATTERN = `/tenants/{tenantId}/postgres/{resourceId}/connection`;

export class PostgresResource extends Resource {
  protected generateDefaultTenantRoleName(
    tenantId: string,
    prefix?: string
  ): string {
    if (prefix) {
      return `${prefix}${tenantId}`;
    }

    return `${DEFAULT_TENANT_ROLE_PREFIX}${tenantId}`;
  }

  protected getLocalSecretsProvider() {
    return { provider: new Local() };
  }

  getPattern(): string {
    if (this.id) {
      return DEFAULT_SECRETS_WITH_RESOURCE_ID_PATTERN;
    } else {
      return DEFAULT_SECRETS_PATTERN;
    }
  }
}

export abstract class PostgresTenantsBase extends PostgresResource {
  abstract getClientFor(tenantId: string): Promise<PoolClient>;

  /**
   * Runs a query as a specific tenant and returns the result.
   *
   * @param tenantId - Represents the tenant ID.
   * @param queryTextOrConfig - The SQL query to execute. It can either be:
   *   - A string containing the SQL query text.
   *   - A `QueryConfig` object containing the query text and optional parameters.
   * @param values - (Optional) An array of values to be used as parameters in the query.
   * @returns A promise that resolves with the query result.
   * @throws Will throw an error if the query execution fails.
   *
   * @remarks
   * This function retrieves a database client for the specified tenant, executes the query,
   * and ensures the client is properly released back to the pool after the query runs.
   */
  async queryAs(
    tenantId: string,
    queryTextOrConfig: string | QueryConfig<unknown[]>,
    values?: unknown[] | undefined
  ) {
    const client = await this.getClientFor(tenantId);
    try {
      return await client.query(queryTextOrConfig, values);
    } finally {
      await client.release();
    }
  }

  /**
   * A safer way to use a database client inside a callback. After finishing the callback the
   * the client gets release back to the pool. This method ensures that the database client is
   * properly released back to the pool after the callback function is executed,
   * preventing potential resource leaks.
   *
   * @param tenantId - The tenant id.
   * @param releaseCb - A callback function that receives the database client. This function should return a Promise.
   * @returns A Promise that resolves once the callback function has completed and the
   * client has been released.
   *
   */
  async withClientFor(
    tenantId: string,
    safeCb: (client: PoolClient) => Promise<void>
  ): Promise<void> {
    const client: PoolClient = await this.getClientFor(tenantId);
    try {
      await safeCb(client);
    } finally {
      await client.release();
    }
  }

  /**
   * Gracefully shuts down the PostgreSQL resource by ending all active connections
   * and releasing any resources held by the isolation strategy.
   *
   * @returns A promise that resolves when the shutdown process is complete.
   *
   * @remarks
   * This method should be called when the application is shutting down or when
   * the PostgreSQL resource is no longer needed. It ensures that all resources
   * are properly cleaned up to prevent memory leaks or connection issues.
   *
   * @throws Will throw an error if the shutdown process encounters any issues.
   */
  abstract end(): Promise<void>;
}
