import { SecretsProvider } from "@fahren/core";

export default class StaticProvider implements SecretsProvider {
  resolver: (params: { path: string }) => Promise<string> | string;

  constructor(
    resolver: (params: { path: string }) => Promise<string> | string
  ) {
    this.resolver = resolver;
  }

  async getSecret(path: string): Promise<string> {
    return await this.resolver({ path });
  }

  deleteSecret(): Promise<void> {
    return Promise.resolve();
  }

  createSecret(): Promise<void> {
    return Promise.resolve();
  }

  updateSecret(): Promise<void> {
    return Promise.resolve();
  }
}
