import { SecretsProvider } from "@fahren/core";
import { client as VaultClient, VaultOptions } from "node-vault";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import NodeVault = require("node-vault");

/**
 * Vault secret provider uses kv v2 engine
 * @see https://developer.hashicorp.com/vault/docs/secrets/kv#kv-version-2
 */
export default class Vault implements SecretsProvider {
  private vaultClient: VaultClient;

  constructor(configuration?: VaultOptions) {
    if (configuration?.pathPrefix) {
      throw new Error(
        "Vault client does not support `pathPrefix` because the path prefix `/secret/data/` uses the v2 KV engine."
      );
    }
    this.vaultClient = NodeVault(configuration || {});
  }

  normalizePath(path: string): string {
    if (path.startsWith("secret/data/")) {
      return path;
    } else {
      return path.startsWith("/")
        ? `secret/data${path}`
        : `secret/data/${path}`;
    }
  }

  async getSecret(path: string): Promise<string> {
    const secretPath = this.normalizePath(path);
    try {
      const response = await this.vaultClient.read(secretPath);
      if (!response.data) {
        throw new Error(
          `Failed to retrieve secret for path: ${secretPath}. Data is undefined.`
        );
      }
      return JSON.stringify(response.data.data);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to retrieve secret from Vault: ${error.message}`
        );
      } else {
        throw new Error(
          "Failed to retrieve secret from Vault: An unknown error occurred."
        );
      }
    }
  }

  async createSecret(path: string, value: string): Promise<void> {
    const secretPath = this.normalizePath(path);
    try {
      const data = JSON.parse(value);
      await this.vaultClient.write(secretPath, { data });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to create secret in Vault: ${error.message}`);
      } else {
        throw new Error(
          "Failed to create secret in Vault: An unknown error occurred."
        );
      }
    }
  }

  async updateSecret(path: string, value: string): Promise<void> {
    const secretPath = this.normalizePath(path);

    // In Vault, updating a secret is the same as creating it
    await this.createSecret(secretPath, value);
  }

  async deleteSecret(path: string): Promise<void> {
    const secretPath = this.normalizePath(path);

    try {
      await this.vaultClient.delete(secretPath);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to delete secret from Vault: ${error.message}`);
      } else {
        throw new Error(
          "Failed to delete secret from Vault: An unknown error occurred."
        );
      }
    }
  }
}
