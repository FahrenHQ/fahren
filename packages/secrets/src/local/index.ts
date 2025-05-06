import * as fs from "fs";
import * as path from "path";
import { SecretsProvider } from "@fahren/core";

export default class LocalSecretsProvider implements SecretsProvider {
  private secretsFilePath = ".fahren/secrets.json";

  constructor({ secretsFilePath }: { secretsFilePath?: string } = {}) {
    if (secretsFilePath) {
      this.secretsFilePath = secretsFilePath;
    }
    this.ensureSecretsFileExists();
  }

  private ensureSecretsFileExists(): void {
    const dirPath = path.dirname(this.secretsFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    if (!fs.existsSync(this.secretsFilePath)) {
      fs.writeFileSync(this.secretsFilePath, JSON.stringify({}, null, 2));
    }
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }

  private parseValue(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async getSecret(path: string): Promise<string> {
    const secrets = this.readSecretsFile();
    const value = secrets[path];
    if (!value) {
      throw new Error(`Secret not found for path: ${path}`);
    }
    return this.stringifyValue(value);
  }

  async deleteSecret(path: string): Promise<void> {
    const secrets = this.readSecretsFile();
    if (secrets[path]) {
      delete secrets[path];
      this.writeSecretsFile(secrets);
    } else {
      throw new Error(`Secret not found for path: ${path}`);
    }
  }

  async createSecret(path: string, value: unknown): Promise<void> {
    const secrets = this.readSecretsFile();
    if (secrets[path]) {
      throw new Error(`Secret already exists for path: ${path}`);
    }
    secrets[path] = this.parseValue(this.stringifyValue(value));
    this.writeSecretsFile(secrets);
  }

  async updateSecret(path: string, value: unknown): Promise<void> {
    const secrets = this.readSecretsFile();
    if (!secrets[path]) {
      throw new Error(`Secret not found for path: ${path}`);
    }
    secrets[path] = this.parseValue(this.stringifyValue(value));
    this.writeSecretsFile(secrets);
  }

  private readSecretsFile(): Record<string, unknown> {
    this.ensureSecretsFileExists();
    const content = fs.readFileSync(this.secretsFilePath, "utf-8");
    return JSON.parse(content);
  }

  private writeSecretsFile(secrets: Record<string, unknown>): void {
    this.ensureSecretsFileExists();
    fs.writeFileSync(this.secretsFilePath, JSON.stringify(secrets, null, 2));
  }
}
