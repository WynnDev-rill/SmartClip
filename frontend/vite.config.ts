import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sharedResolve } from "./config/shared";

export default defineConfig({
  plugins: [react()],
  resolve: sharedResolve,
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } } },
});
