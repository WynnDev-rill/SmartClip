import { defineConfig } from "vitest/config";
import { sharedResolve } from "./config/shared";

export default defineConfig({
  resolve: sharedResolve,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
