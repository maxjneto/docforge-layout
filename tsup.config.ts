import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/server.ts", "src/mcp.ts", "src/cli.ts", "src/client.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  sourcemap: true,
});
