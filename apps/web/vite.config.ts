import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@rag-data-toolkit/core": resolve(__dirname, "../../packages/core/src/index.ts")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
