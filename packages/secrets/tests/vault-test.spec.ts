import { GenericContainer, StartedTestContainer } from "testcontainers";
import Vault from "../src/hashicorp/vault/index";

describe("Vault Secrets Provider", () => {
  jest.setTimeout(30000); // Increase timeout to 30 seconds
  let secretsProvider: Vault;
  let vaultContainer: StartedTestContainer;
  let vaultEndpoint: string;

  beforeAll(async () => {
    // Start a local Vault container
    vaultContainer = await new GenericContainer("hashicorp/vault:latest")
      .withExposedPorts(8200)
      .withEnv("VAULT_DEV_ROOT_TOKEN_ID", "test-token")
      .withEnv("VAULT_DEV_LISTEN_ADDRESS", "0.0.0.0:8200")
      .start();

    vaultEndpoint = `http://${vaultContainer.getHost()}:${vaultContainer.getMappedPort(
      8200
    )}`;
    secretsProvider = new Vault({
      endpoint: vaultEndpoint,
      token: "test-token",
    });
  });

  afterAll(async () => {
    await vaultContainer.stop();
  });

  it("should create, retrieve, and delete a secret", async () => {
    const tenantId = crypto.randomUUID();
    const secretPath = `tenants/${tenantId}/test/json`;
    const secretValue = JSON.stringify({ key: "value", number: 42 });

    await secretsProvider.createSecret(secretPath, secretValue);

    const retrievedSecret = await secretsProvider.getSecret(secretPath);
    expect(retrievedSecret).toBe(secretValue);

    await secretsProvider.deleteSecret(secretPath);
    await expect(secretsProvider.getSecret(secretPath)).rejects.toThrow();
  });
});
