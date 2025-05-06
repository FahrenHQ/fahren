import { RedisOptions } from "ioredis";
import { ClientConfig, ExtendedRedisClient } from "./strategies/base";
import { TenantsSecrets } from "@fahren/core";
import { AclIsolationOptions } from "./strategies/acl";
import { RedisAclManagement, RedisAclTenants } from "./strategies/acl";
import { RedisPrefixManagement, RedisPrefixTenants } from "./strategies/prefix";

export { RedisOptions, ExtendedRedisClient as RedisClient };

export default class Redis {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  withPrefixIsolation(): RedisWithPrefix {
    return new RedisWithPrefix({ id: this.id });
  }

  withAclIsolation(): RedisWithAcl {
    return new RedisWithAcl({ id: this.id });
  }
}

export class RedisWithPrefix {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
    clientConfig,
    id,
    options,
  }: {
    clientConfig?: Exclude<RedisOptions, "keyPrefix"> & {
      enableDangerousCommands?: boolean;
    };
    id?: string;
    options?: {
      autosetup?: boolean;
    };
  }) {
    return new RedisPrefixManagement({
      clientConfig,
      id: id || this.id,
      options,
    });
  }

  forTenants({
    clientConfig,
    id,
  }: {
    clientConfig?: Exclude<RedisOptions, "keyPrefix">;
    id?: string;
  } = {}) {
    return new RedisPrefixTenants({ clientConfig, id: id || this.id });
  }
}

export class RedisWithAcl {
  id?: string;

  constructor({ id }: { id?: string } = { id: undefined }) {
    this.id = id;
  }

  forManagement({
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
    return new RedisAclManagement({
      clientConfig,
      options,
      secrets,
      id: id || this.id,
    });
  }

  forTenants({ secrets, id }: { secrets: TenantsSecrets; id?: string }) {
    return new RedisAclTenants({ secrets, id: id || this.id });
  }
}
