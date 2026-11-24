import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./test/wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            STOREFRONT_ORIGINS: "https://shop.test, https://www.shop.test",
            ENVIRONMENT: "production",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"], exclude: [...configDefaults.exclude, "scripts/**"] },
  };
});
