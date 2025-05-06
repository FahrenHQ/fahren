# Example Chat Application

This is an example chat application demonstrating the use of the `fahren` framework. The application is containerized using Docker and can be easily set up with `docker-compose`.

## Prerequisites

- [Docker](https://www.docker.com/) installed
- [Docker Compose](https://docs.docker.com/compose/) installed

## Setup Instructions

1. Clone the repository:

   ```bash
   git clone https://github.com/joacoc/fahren/fahren.git
   cd fahren/examples/nextjs_chat
   pnpm install
   ```

2. Start the application using `docker-compose`:

   ```bash
   docker-compose up
   ```

3. Access the application:
   - Open your browser and navigate to `http://localhost:3000` (or the port specified in the `docker-compose.yml` file).

## Stopping the Application

To stop the application, run:

```bash
docker-compose down
```

## Customization

You can modify the `docker-compose.yml` file to adjust the configuration, such as ports or environment variables.

## Troubleshooting

- Ensure Docker and Docker Compose are installed and running.
- Check the logs for errors:
  ```bash
  docker-compose logs
  ```
