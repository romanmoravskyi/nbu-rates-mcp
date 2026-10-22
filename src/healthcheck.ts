/**
 * Container health check: `node dist/healthcheck.js` exits 0 when GET /health answers 2xx, else 1.
 * It reads PORT and NBU_MCP_HOST/HOST with the server's own parser (src/env.ts), so blank values,
 * padding and IPv6 hosts resolve exactly as they do for the server (the image sets
 * NBU_MCP_HOST=0.0.0.0). It only proves the server answers on the address it is bound to: with
 * NBU_MCP_HOST=127.0.0.1 (or a blank one, which means that) it reports healthy even though nothing
 * outside the container can reach it. PORT=0 is not supported, since the port the server picked
 * cannot be known from outside the process.
 *
 * Importing this module has no side effects; the check runs only when it is the process entry.
 */
import { realpathSync } from "node:fs";
import { type ClientRequest, get, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { ConfigError, readListenConfig, urlHost } from "./env.js";

/** Below the Dockerfile's `--timeout=3s`, leaving room for Node to start (about 250 ms in the image). */
export const HEALTH_TIMEOUT_MS = 2000;

/**
 * The /health URL of a server configured by `env`. Throws ConfigError when it cannot be known.
 * `machine` is passed through to readListenConfig (this machine's hostname by default).
 */
export function healthUrl(env: NodeJS.ProcessEnv, machine?: string): string {
  const { port, host } = readListenConfig(env, machine);
  if (port === 0) {
    throw new ConfigError(
      "PORT=0 picks a random port, which the health check cannot know. Set a fixed PORT.",
    );
  }
  // A wildcard bind accepts loopback connections; other hosts are probed where the server listens.
  const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${urlHost(target)}:${port}/health`;
}

/**
 * GET `url`; resolves to undefined on a 2xx answer, else to a one-line reason. Uses node:http, not
 * fetch, because fetch refuses the Fetch spec's "bad ports" (e.g. 6000, 10080) the server may use.
 */
export function probe(url: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<string | undefined> {
  return new Promise((resolve) => {
    let req: ClientRequest;
    try {
      req = get(url, { agent: false }, onResponse);
    } catch (error) {
      // An unusable HOST (e.g. an IPv6 zone ID) makes `get` throw synchronously: report, don't crash.
      resolve(`${url} failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    function onResponse(res: IncomingMessage): void {
      clearTimeout(timer);
      res.resume();
      const status = res.statusCode ?? 0;
      resolve(status >= 200 && status < 300 ? undefined : `${url} answered HTTP ${status}`);
    }
    const timer = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    req.on("error", (error) => {
      clearTimeout(timer);
      resolve(`${url} failed: ${error.message}`);
    });
  });
}

/** Run the check against process.env and exit 0 (healthy) or 1 with a reason on stderr. */
async function main(): Promise<never> {
  let reason: string | undefined;
  try {
    reason = await probe(healthUrl(process.env));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    reason = error.message;
  }
  if (reason) console.error(`unhealthy: ${reason}`);
  process.exit(reason ? 1 : 0);
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntry()) await main();
