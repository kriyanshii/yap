/// <reference types="vitest/config" />
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  // eval/ and train/ use node:test via `npm run test:eval` / `npm run test:data`.
  test: { exclude: [...configDefaults.exclude, "eval/**", "train/**"] },
});
