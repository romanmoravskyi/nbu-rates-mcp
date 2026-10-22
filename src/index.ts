/**
 * Process entry. Default: HTTP server (PORT, NBU_MCP_HOST or HOST, ALLOWED_HOSTS from the environment).
 * With `--stdio` or MCP_TRANSPORT=stdio: MCP over stdin/stdout for clients that launch the process.
 */
import type { AddressInfo } from "node:net";
import { ConfigError, exposureWarning, mcpUrl, readListenConfig, urlHost } from "./env.js";
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
  const { port, host, extraAllowedHosts, warnings } = config;
  for (const warning of warnings) console.error(warning);

  const app = createApp({ allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts] });

  // Startup only: a failed listen (port in use, unknown host) exits with a readable message.
  const onListenError = (error: Error): void => {
    console.error(`Cannot listen on ${urlHost(host)}:${port}: ${error.message}`);
    process.exit(1);
  };
  app.once("error", onListenError);

  app.listen(port, host, () => {
    app.off("error", onListenError);
    const bound = app.address() as AddressInfo;
    console.log(`${SERVER_NAME} v${VERSION} listening on ${mcpUrl(host, bound.port)}`);
    const exposure = exposureWarning(bound.address);
    if (exposure) console.error(exposure);
  });

  const shutdown = gracefulShutdown(app);
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
