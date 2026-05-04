import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/drizzle-schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  // No db connection here — we use generate (offline) only. push/migrate happen
  // through src/db/open.ts at runtime so we control the file path per-environment.
});
