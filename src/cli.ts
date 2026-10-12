#!/usr/bin/env node
/**
 * docforge-layout serve [--port 8002] [--host 127.0.0.1] [--max-body-bytes 2000000]
 *
 * Runs the layout HTTP API (see src/server.ts). PORT, HOST and MAX_BODY_BYTES
 * environment variables are used when the flags are absent.
 */

import { createLayoutServer } from "./server";

const USAGE = "usage: docforge-layout serve [--port 8002] [--host 127.0.0.1] [--max-body-bytes 2000000]";

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command !== "serve") {
    console.error(USAGE);
    process.exit(command === "--help" || command === "-h" ? 0 : 1);
  }
  const port = Number(flag(args, "port") ?? process.env.PORT ?? 8002);
  const host = flag(args, "host") ?? process.env.HOST ?? "127.0.0.1";
  const maxBodyBytes = Number(flag(args, "max-body-bytes") ?? process.env.MAX_BODY_BYTES ?? 2_000_000);
  if (!Number.isInteger(port) || port < 0 || !Number.isFinite(maxBodyBytes)) {
    console.error(USAGE);
    process.exit(1);
  }
  const server = createLayoutServer({ maxBodyBytes });
  server.listen(port, host, () => console.log(`docforge-layout listening on http://${host}:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main(process.argv.slice(2));
