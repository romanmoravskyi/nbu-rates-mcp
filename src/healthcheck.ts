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

/** Where the server configured by some environment answers /health. */
export interface HealthTarget {
  host: string;
  port: number;
}

/**
 * The address to probe for a server configured by `env`. Throws ConfigError when it cannot be known.
 * `machine` is passed through to readListenConfig (this machine's hostname by default).
 */
export function healthTarget(env: NodeJS.ProcessEnv, machine?: string): HealthTarget {
  const { port, host } = readListenConfig(env, machine);
  if (port === 0) {
    throw new ConfigError(
      "PORT=0 picks a random port, which the health check cannot know. Set a fixed PORT.",
    );
  }
  // A wildcard bind accepts loopback connections; other hosts are probed where the server listens.
  return { host: host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host, port };
}

/** The probed URL, for messages: IPv6 hosts in brackets. */
export function healthUrl({ host, port }: HealthTarget): string {
  return `http://${urlHost(host)}:${port}/health`;
}

/**
 * GET /health on `target`; resolves to undefined on a 2xx answer, else to a one-line reason.
 * Uses node:http with host/port options rather than fetch or a URL string: fetch refuses the Fetch
 * spec's "bad ports" (e.g. 6000, 10080), and a URL cannot carry an IPv6 zone ID (fe80::1%eth0).
 */
export function probe(target: HealthTarget, timeoutMs = HEALTH_TIMEOUT_MS): Promise<string | undefined> {
  const url = healthUrl(target);
  return new Promise((resolve) => {
    let req: ClientRequest;
    try {
      req = get({ ...target, path: "/health", agent: false }, onResponse);
    } catch (error) {
      // Invalid options make `get` throw synchronously: report, don't crash.
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
    reason = await probe(healthTarget(process.env));
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
