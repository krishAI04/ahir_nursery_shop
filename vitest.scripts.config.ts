import { defineConfig } from "vitest/config";

// Laptop scripts run in plain Node (the Worker tests use vitest.config.ts).
export default defineConfig({
  test: { include: ["scripts/**/*.test.ts"], environment: "node" },
});
