import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/server.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  sourcemap: true,
});
