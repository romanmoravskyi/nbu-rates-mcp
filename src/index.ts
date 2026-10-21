/**
 * Process entry. Default: HTTP server (PORT, HOST, ALLOWED_HOSTS from the environment).
 * With `--stdio` or MCP_TRANSPORT=stdio: MCP over stdin/stdout for clients that launch the process.
 */
import type { AddressInfo } from "node:net";
import { ConfigError, readListenConfig } from "./env.js";
import { createApp, DEFAULT_ALLOWED_HOSTS, SERVER_NAME, VERSION } from "./server.js";
import { gracefulShutdown } from "./shutdown.js";
import { runStdio } from "./stdio.js";

if (process.argv.includes("--stdio") || process.env.MCP_TRANSPORT === "stdio") {
  await runStdio();
} else {
  let config: ReturnType<typeof readListenConfig>;
  try {
    config = readListenConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  const { port, host, extraAllowedHosts } = config;

  const app = createApp({ allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts] });

  // Startup only: a failed listen (port in use, unknown host) exits with a readable message.
  const onListenError = (error: Error): void => {
    console.error(`Cannot listen on ${host}:${port}: ${error.message}`);
    process.exit(1);
  };
  app.once("error", onListenError);

  app.listen(port, host, () => {
    app.off("error", onListenError);
    const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
    const actualPort = (app.address() as AddressInfo).port;
    console.log(`${SERVER_NAME} v${VERSION} listening on http://${shown}:${actualPort}/mcp`);
  });

  const shutdown = gracefulShutdown(app);
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
