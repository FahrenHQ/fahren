import { exit } from "process";
import { handler } from ".";

const testEvent = {
  headers: {
    "x-tenant-id": "test-tenant-123",
  },
};

handler(testEvent).then(() => exit(0));
