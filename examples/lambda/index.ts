import Redis from "@fahren/redis";
import Postgres from "@fahren/postgres";
import { AwsSecretsManager } from "@fahren/secrets";
import { TenantsSecrets } from "@fahren/core";
import dotenv from "dotenv";

dotenv.config();

const secrets: TenantsSecrets = {
  provider: new AwsSecretsManager({ endpoint: `http://localhost:4566` }),
};

const postgresManagement = new Postgres()
  .withDatabaseIsolation()
  .forManagement({
    poolConfig: {
      connectionString: process.env.POSTGRES_URL,
    },
    secrets,
    options: {
      provision: {
        database: {
          template: process.env.POSTGRES_TEMPLATE_DB,
        },
      },
    },
  });

const redisManagement = new Redis()
  .withPrefixIsolation()
  .forManagement({ options: { autosetup: true } });
const redisTenants = new Redis().withPrefixIsolation().forTenants();

/**
 * AWS Lambda function for tenant onboarding.
 *
 * This function handles the creation of isolated resources for a tenant,
 * including PostgreSQL and Redis instances. It uses database isolation
 * and ACL isolation mechanisms to ensure tenant-specific data separation.
 *
 * The function expects a tenant identifier to be provided in the HTTP
 * request headers under the key "x-tenant-id". If the header is missing,
 * it returns a 400 Bad Request response. If an error occurs during the
 * tenant creation process, it returns a 500 Internal Server Error response.
 *
 * Dependencies:
 * - @fahren/postgres: For PostgreSQL database isolation.
 * - @fahren/redis: For Redis ACL isolation.
 * - @fahren/secrets: For managing tenant-specific secrets.
 *
 * @param {Object} event - The AWS Lambda event object.
 * @param {Object} event.headers - The HTTP request headers.
 * @param {string} event.headers["x-tenant-id"] - The tenant identifier.
 * @returns {Promise<Object>} The HTTP response object.
 * @throws {Error} If tenant creation fails.
 */
export const handler = async (event: { headers: Record<string, string> }) => {
  const tenantId = event.headers["x-tenant-id"];
  if (!tenantId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing tenant header" }),
    };
  }

  try {
    // Creates tenant-specific resources
    // This will create a new PostgreSQL database, role, password and store in the secrets manager
    await postgresManagement.createTenant(tenantId);

    // This will create a new Redis ACL user without login access but restricted usage over Redis.
    // This operation happens only once. If the ACL user already exists, this operation does nothing.
    await redisManagement.setup();
    const redisClient = await redisTenants.getClientFor(tenantId);

    // Will store on the keyspace: `tenant:<tenantId>:config:...`
    await redisClient.set("config:initialized", "true");
    await redisClient.set("config:createdAt", new Date().toISOString());
    await redisClient.set("config:plan", "starter");

    await redisClient.quit();
    await postgresManagement.end();

    console.log("Succesffully completed onboarding.");
    return {
      statusCode: 200,
    };
  } catch (err) {
    console.error("Error processing request: ", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
      }),
    };
  }
};
