import express from "express";
import Redis, { RedisClient } from "@fahren/redis";
import { AwsSecretsManager } from "@fahren/secrets";
import { TenantsSecrets } from "@fahren/core";

// Extend Express Request type to support our custom properties
declare module "express" {
  interface Request {
    app: express.Application & {
      locals: {
        jwt?: { payload: unknown };
        tenantRedisClient?: RedisClient;
        tenantId?: string;
      };
    };
  }
}

// Create Redis resource with ACL support
const secrets: TenantsSecrets = {
  provider: new AwsSecretsManager({ endpoint: `http://localhost:4566` }),
};

const redisManagement = new Redis()
  .withAclIsolation()
  .forManagement({ secrets });
const redisTenants = new Redis().withAclIsolation().forTenants({ secrets });

// Simulated token parsing middleware
const fakeTokenMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).send("Missing or invalid Authorization header");
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    req.app.locals.jwt = { payload };
    req.app.locals.tenantId = payload.tenant_id;
    next();
  } catch (e) {
    console.error("Error processing JWT: ", e);
    res.status(400).send("Invalid token format");
    return;
  }
};

// Middleware to set tenant context
const tenantMiddleware = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const tenantId = req.app.locals.tenantId;
  if (!tenantId || typeof tenantId !== "string") {
    res.status(400).send("Tenant ID is required");
    return;
  }

  try {
    const isAdminRoute = req.path.startsWith("/admin");
    if (!isAdminRoute) {
      console.log("Getting client for tenant ID: ", tenantId);
      const tenantRedisClient = await redisTenants.getClientFor(tenantId);

      req.app.locals.tenantRedisClient = tenantRedisClient;
      res.on("finish", () => {
        tenantRedisClient.disconnect();
        delete req.app.locals.tenantRedisClient;
      });
    }
    next();
  } catch (error) {
    console.error("Error getting tenant client:", error);
    res.status(500).send("Error establishing tenant connection");
    return;
  }
};

// Create Express app and apply middlewares
const app = express();
app.use(express.json());
app.use(fakeTokenMiddleware);
app.use(tenantMiddleware);

// Routes
app.post("/counter", async (req: express.Request, res) => {
  const redisClient = req.app.locals.tenantRedisClient;
  if (!redisClient) {
    res.status(500).send("Error posting data");
    return;
  }

  try {
    const data = await redisClient.incr("counter");
    res.json({ data });
  } catch (error) {
    console.error("Error posting data: ", error);
    res.status(500).send("Error posting data");
  }
});

app.get("/counter", async (req: express.Request, res) => {
  const redisClient = req.app.locals.tenantRedisClient;
  if (!redisClient) {
    res.status(500).send("Error fetching data");
    return;
  }

  try {
    const data = await redisClient.get("counter");
    res.json({ data });
  } catch (error) {
    console.error("Error fetching data: ", error);
    res.status(500).send("Error fetching data");
  } finally {
    redisClient.disconnect();
  }
});

// Administration endpoints for tenant management
app.post("/admin/tenants", async (req, res) => {
  try {
    const tenantId = req.app.locals.tenantId;
    await redisManagement.createTenant(tenantId);
    res
      .status(201)
      .json({ message: `Tenant ${tenantId} created successfully` });
  } catch (error) {
    console.error("Error creating tenant:", error);
    res.status(500).send("Error creating tenant");
  }
});

app.delete("/admin/tenants", async (req, res) => {
  try {
    const tenantId = req.app.locals.tenantId;
    await redisManagement.deleteTenant(tenantId);
    res.json({ message: `Tenant ${tenantId} deleted successfully` });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    res.status(500).send("Error deleting tenant");
  }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
