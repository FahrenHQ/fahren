import { SecretsProvider } from "@fahren/core";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClientConfig,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

export default class AwsSecretsManager implements SecretsProvider {
  secretsManager: SecretsManagerClient;

  constructor(configuration?: SecretsManagerClientConfig) {
    this.secretsManager = configuration
      ? new SecretsManagerClient(configuration)
      : new SecretsManagerClient();
  }

  async getSecret(secretArn: string): Promise<string> {
    const params = {
      SecretId: secretArn,
    };
    const cmd = new GetSecretValueCommand(params);
    const secret = await this.secretsManager.send(cmd);
    if (!secret.SecretString) {
      throw new Error(
        `Failed to retrieve secret for ARN: ${secretArn}. SecretString is undefined.`
      );
    }

    return secret.SecretString;
  }

  async createSecret(secretName: string, secretValue: string): Promise<void> {
    const params = {
      Name: secretName,
      SecretString: secretValue,
    };
    const cmd = new CreateSecretCommand(params);
    await this.secretsManager.send(cmd);
  }

  async updateSecret(secretName: string, secretValue: string): Promise<void> {
    const params = {
      SecretId: secretName,
      SecretString: secretValue,
    };
    const cmd = new UpdateSecretCommand(params);
    await this.secretsManager.send(cmd);
  }

  async deleteSecret(secretArn: string): Promise<void> {
    const params = {
      SecretId: secretArn,
    };
    const cmd = new DeleteSecretCommand(params);
    await this.secretsManager.send(cmd);
  }
}
