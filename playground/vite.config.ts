import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { "@docforge-lib/layout": fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
  },
  server: { port: 5310, fs: { allow: [repo] } },
});
