import { PoolConfig } from "pg";
import PgBouncer from "./pgbouncer";
import { TenantsSecrets } from "@fahren/core";
import {
  PostgresDatabaseManagement,
  PostgresDatabaseManagementOptions,
  PostgresDatabaseTenants,
} from "./strategies/database";
import {
  PostgresRlsManagement,
  PostgresRlsManagementOptions,
  PostgresRlsTenants,
} from "./strategies/rls";
import {
  PostgresSchemaManagement,
  PostgresSchemaManagementOptions,
  PostgresSchemaTenants,
} from "./strategies/schema";

export default class Postgres {
  id: string | undefined;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  withSchemaIsolation(): PostgresWithSchemaIsolation {
    return new PostgresWithSchemaIsolation({ id: this.id });
  }

  withDatabaseIsolation(): PostgresWithDatabaseIsolation {
    return new PostgresWithDatabaseIsolation({ id: this.id });
  }

  withRlsIsolation(): PostgresWithRlsIsolation {
    return new PostgresWithRlsIsolation({ id: this.id });
  }

  withPgBouncer(): PgBouncer {
    return new PgBouncer({ id: this.id });
  }
}

export class PostgresWithDatabaseIsolation {
  id: string | undefined;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    poolConfig,
    secrets,
    options,
    id,
  }: {
    poolConfig: PoolConfig;
    secrets: TenantsSecrets;
    options?: PostgresDatabaseManagementOptions;
    id?: string;
  }) {
    return new PostgresDatabaseManagement({
      poolConfig,
      options,
      secrets,
      id: id || this.id,
    });
  }

  forTenants({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    return new PostgresDatabaseTenants({
      secrets,
      id: id || this.id,
    });
  }
}

export class PostgresWithRlsIsolation {
  id: string | undefined;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    poolConfig,
    options,
    id,
  }: {
    poolConfig: PoolConfig;
    options?: PostgresRlsManagementOptions;
    id?: string;
  }) {
    return new PostgresRlsManagement({
      poolConfig,
      options,
      id: id || this.id,
    });
  }

  forTenants({ id, poolConfig }: { id?: string; poolConfig: PoolConfig }) {
    return new PostgresRlsTenants({
      id: id || this.id,
      poolConfig,
    });
  }
}

export class PostgresWithSchemaIsolation {
  id: string | undefined;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    poolConfig,
    secrets,
    options,
    id,
  }: {
    poolConfig: PoolConfig;
    secrets: TenantsSecrets;
    options: PostgresSchemaManagementOptions;
    id?: string;
  }) {
    return new PostgresSchemaManagement({
      poolConfig,
      options,
      secrets,
      id: id || this.id,
    });
  }

  forTenants({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    return new PostgresSchemaTenants({
      secrets,
      id: id || this.id,
    });
  }
}
