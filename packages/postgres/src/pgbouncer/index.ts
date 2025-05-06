import { PoolConfig } from "pg";
import {
  PgBouncerRlsManagement,
  PgBouncerRlsManagementOptions,
  PgBouncerRlsTenants,
} from "./strategies/rls";
import {
  PgBouncerDatabaseManagement,
  PgBouncerDatabaseManagementOptions,
  PgBouncerDatabaseTenants,
} from "./strategies/database";
import {
  PgBouncerSchemaManagement,
  PgBouncerSchemaManagementOptions,
  PgBouncerSchemaTenants,
} from "./strategies/schema";
import { TenantsSecrets } from "@fahren/core";

export type PgBouncerPoolConfig = PoolConfig & {
  poolMode: "transaction_mode" | "session_mode";
};

export default class PgBouncer {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  withSchemaIsolation(): PgBouncerWithSchemaIsolation {
    return new PgBouncerWithSchemaIsolation({ id: this.id });
  }

  withDatabaseIsolation(): PgBouncerWithDatabaseIsolation {
    return new PgBouncerWithDatabaseIsolation({ id: this.id });
  }

  withRlsIsolation(): PgBouncerWithRlsIsolation {
    return new PgBouncerWithRlsIsolation({ id: this.id });
  }
}

export class PgBouncerWithRlsIsolation {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    pgBouncerPoolConfig,
    id,
    options,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    options?: PgBouncerRlsManagementOptions;
    id?: string;
    secrets?: TenantsSecrets;
  }) {
    return new PgBouncerRlsManagement({
      pgBouncerPoolConfig,
      id: id || this.id,
      options,
    });
  }

  forTenants({
    id,
    pgBouncerPoolConfig,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    id?: string;
  }) {
    return new PgBouncerRlsTenants({
      id: id || this.id,
      poolConfig: pgBouncerPoolConfig,
    });
  }
}

export class PgBouncerWithSchemaIsolation {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    pgBouncerPoolConfig,
    secrets,
    options,
    id,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    secrets: TenantsSecrets;
    options?: PgBouncerSchemaManagementOptions;
    id?: string;
  }) {
    return new PgBouncerSchemaManagement({
      pgBouncerPoolConfig,
      options,
      secrets,
      id: id || this.id,
    });
  }

  forTenants({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    return new PgBouncerSchemaTenants({
      secrets,
      id: id || this.id,
    });
  }
}

export class PgBouncerWithDatabaseIsolation {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    pgBouncerPoolConfig,
    secrets,
    options,
    id,
  }: {
    pgBouncerPoolConfig: PgBouncerPoolConfig;
    secrets: TenantsSecrets;
    options?: PgBouncerDatabaseManagementOptions;
    id?: string;
  }) {
    return new PgBouncerDatabaseManagement({
      pgBouncerPoolConfig,
      options,
      secrets,
      id: id || this.id,
    });
  }

  forTenants({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    return new PgBouncerDatabaseTenants({
      secrets,
      id: id || this.id,
    });
  }
}
