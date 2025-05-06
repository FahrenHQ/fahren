# Lambda Tenant Onboarding Example

This example demonstrates how to use Fahren's multi-tenant capabilities in an AWS Lambda function for tenant onboarding. The function creates isolated resources for new tenants, including PostgreSQL databases and Redis instances.

## Prerequisites

- Node.js 18 or higher
- Docker (for local Redis and PostgreSQL)
- AWS CLI configured with appropriate credentials
- AWS Secrets Manager access

## Environment Setup

1. Create a `.env` file in the `examples/lambda` directory with the following variables:

```bash
# PostgreSQL Configuration
POSTGRES_TEMPLATE_DB=template1
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432
```

## Local Development

### 1. Start Local Services

```bash
# Start PostgreSQL
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# Start Redis
docker run -d -p 6379:6379 --name redis-server redis:latest

# Start AWS Secrets Manager locally using LocalStack
docker run -d -p 4566:4566 --name localstack localstack/localstack:latest
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Test the Lambda Function

Run the test:

```bash
npm start
```

## Function Details

The Lambda function performs the following operations:

1. Validates the presence of a tenant ID in the request headers
2. Creates a new PostgreSQL database and role for the tenant
3. Sets up Redis ACL isolation for the tenant
4. Initializes tenant-specific configuration in Redis
5. Cleans up connections

## Error Handling

The function includes error handling for:

- Missing tenant ID (400 Bad Request)
- Resource creation failures (500 Internal Server Error)

## Dependencies

- @fahren/postgres: For PostgreSQL database isolation
- @fahren/redis: For Redis ACL isolation
- @fahren/secrets: For managing tenant-specific secrets

## Security Considerations

- The function uses AWS Secrets Manager to store tenant credentials
- Redis ACL isolation provides command-level restrictions
- PostgreSQL database isolation ensures data separation between tenants

## Related Resources

- [Fahren Documentation](https://github.com/fahrenhq/fahren)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Redis ACL Documentation](https://redis.io/docs/manual/security/acl/)
