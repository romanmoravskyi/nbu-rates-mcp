/** Process entry: reads PORT, HOST and ALLOWED_HOSTS from the environment and starts listening. */
import { createApp, DEFAULT_ALLOWED_HOSTS, SERVER_NAME, VERSION } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const extraHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const app = createApp({ allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...extraHosts] });

app.listen(port, host, () => {
  const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  console.log(`${SERVER_NAME} v${VERSION} listening on http://${shown}:${port}/mcp`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  app.close(() => process.exit(0));
  app.closeAllConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
