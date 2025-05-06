# Multi-tenant Redis Example

This repository demonstrates how to implement a Node.js Express application using a multi-tenant Redis with ACL support. The implementation isolates data between tenants, ensuring that each tenant's data is secured and separated.

## Features

- Tenant isolation using Redis ACLs
- Express middleware for tenant clients
- Sample counter API to demonstrate per-tenant data
- Admin endpoints for tenant management

## Prerequisites

- Node.js (v14 or higher)
- Redis (v6 or higher with ACL support)
- TypeScript

## Installation

1. Clone the repository

```bash
   git clone https://github.com/fahrenhq/fahren/fahren.git
   cd fahren/examples/express
```

2. Install dependencies

```bash
pnpm install
```

3. Make sure Redis is running with ACL support

```bash
# You can run Redis in Docker with:
docker run -d -p 6379:6379 --name redis-server redis:latest

# Run AWS Secrets Manager locally using LocalStack (for testing purposes)
docker run -d -p 4566:4566 --name localstack localstack/localstack:latest
```

## Running the Example

1. Start the server

```bash
npm run start
```

2. The server will start on port 3000 by default: `http://localhost:3000`

3. Setup a token

```bash
export TOKEN=$(echo '{"tenant_id": "tenant1"}' | base64)
```

## API Usage

### Managing Tenants

#### Create a new tenant

```bash
curl -X POST http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN"
```

#### Delete a tenant

```bash
curl -X DELETE http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN"
```

### Using Tenant-Specific Data

To access tenant-specific data, you need to include a valid JWT with a `tenant_id` field in the Authorization header.

#### Creating a test JWT

For testing purposes, you can create a simple base64-encoded JWT:

```bash
export TOKEN=$(echo '{"tenant_id": "acme_inc"}' | base64)
```

#### Create tenant

```bash
curl -X POST http://localhost:3000/admin/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN"
```

#### Increment the counter for a tenant

```bash
curl -X POST http://localhost:3000/counter \
  -H "Authorization: Bearer $TOKEN"
```

#### Get the counter value for a tenant

```bash
curl -X GET http://localhost:3000/counter \
  -H "Authorization: Bearer $TOKEN"
```

## Testing Multiple Tenants

You can verify tenant isolation by creating multiple tenants and verifying that their data is separate:

```bash
# Create tokens for both tenants
export TOKEN1=$(echo '{"tenant_id": "bytes_inc"}' | base64)
export TOKEN2=$(echo '{"tenant_id": "cloud_corp"}' | base64)

# Create two tenants
curl -X POST http://localhost:3000/admin/tenants -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN1"
curl -X POST http://localhost:3000/admin/tenants -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN2"

# Increment counter for tenant1
curl -X POST http://localhost:3000/counter -H "Authorization: Bearer $TOKEN1"
curl -X POST http://localhost:3000/counter -H "Authorization: Bearer $TOKEN1"

# Check counter for tenant1
curl -X GET http://localhost:3000/counter -H "Authorization: Bearer $TOKEN1"
# Should return {"data":"2"}

# Check counter for tenant2
curl -X GET http://localhost:3000/counter -H "Authorization: Bearer $TOKEN2"
# Should return {"data":null} since tenant2's counter hasn't been incremented
```

## Implementation Details

### Redis Client with ACL

The example uses a Redis client with ACL support through `new Redis().withAclIsolation().forManagement()` and `new Redis().withAclIsolation().forTenants()`. These classes creates Redis clients that can manage tenant-specific connections with proper isolation.

### Middleware

The application uses two middleware functions:

1. `fakeTokenMiddleware`: Simulates a fake token parsing for demonstration purposes
2. `tenantMiddleware`: Establishes the Redis client for the specific tenant based on the JWT payload

### Tenant Isolation

The tenant isolation is achieved through Redis ACLs. For each tenant, a separate user is created in Redis with access only to keys with a specific prefix. This ensures that tenants cannot access each other's data.

## Contributing

Feel free to submit issues or pull requests to improve this example.
