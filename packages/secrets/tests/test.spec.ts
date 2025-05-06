import { GenericContainer, StartedTestContainer } from "testcontainers";
import AwsSecretsManager from "../src/aws/secrets-manager";

describe("AwsSecretsManager", () => {
  let secretsProvider: AwsSecretsManager;
  let secretsManagerContainer: StartedTestContainer;
  let secretsManagerEndpoint: string;

  beforeAll(async () => {
    // Start a local AWS Secrets Manager container
    secretsManagerContainer = await new GenericContainer(
      "localstack/localstack"
    )
      .withExposedPorts(4566)
      .withEnv("SERVICES", "secretsmanager")
      .start();

    secretsManagerEndpoint = `http://${secretsManagerContainer.getHost()}:${secretsManagerContainer.getMappedPort(
      4566
    )}`;
    secretsProvider = new AwsSecretsManager({
      endpoint: secretsManagerEndpoint,
      region: "us-east-1",
    });
  });

  afterAll(async () => {
    await secretsManagerContainer.stop();
  });

  it("should create, retrieve, and delete a secret", async () => {
    const secretName = "test-secret";
    const secretValue = "test-value";

    await secretsProvider.createSecret(secretName, secretValue);

    const retrievedSecret = await secretsProvider.getSecret(secretName);
    expect(retrievedSecret).toBe(secretValue);

    await secretsProvider.deleteSecret(secretName);
    await expect(secretsProvider.getSecret(secretName)).rejects.toThrow();
  });
});
