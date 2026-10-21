/**
 * Graceful shutdown for the HTTP server: stop accepting connections, close idle keep-alive sockets,
 * let in-flight requests finish, then exit. A grace timer is the hard stop, and a second signal
 * exits at once. Importing this module has no side effects; src/index.ts wires it to signals.
 */
import type { Server, ServerResponse } from "node:http";

export const DEFAULT_GRACE_MS = 5000;

export interface ShutdownOptions {
  /** How long in-flight requests may run after the signal before the process is forced to exit. */
  graceMs?: number;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

/** Ask the client not to reuse this connection, if the response headers are still unsent. */
function closeAfter(res: ServerResponse): void {
  if (!res.headersSent) res.setHeader("connection", "close");
}

/**
 * Build a signal handler that drains `server` and then calls `exit`. Call it before the server
 * accepts requests: it tracks responses so that, once shutdown has begun, each one tells the client
 * not to reuse its connection where it still can, and a keep-alive socket is closed as soon as its
 * response is sent instead of lingering until its idle timeout. Exit code is 0 in every case, as
 * before: a stop requested by a signal is not a crash.
 */
export function gracefulShutdown(server: Server, options: ShutdownOptions = {}): (signal: string) => void {
  const {
    graceMs = DEFAULT_GRACE_MS,
    exit = (code: number) => process.exit(code),
    log = (message: string) => console.log(message),
  } = options;
  let shuttingDown = false;
  const inFlight = new Set<ServerResponse>();

  server.on("request", (_req, res) => {
    if (shuttingDown) closeAfter(res);
    inFlight.add(res);
    res.on("finish", () => {
      if (shuttingDown) server.closeIdleConnections();
    });
    res.on("close", () => inFlight.delete(res));
  });

  return (signal) => {
    if (shuttingDown) {
      log(`${signal} received again, exiting now`);
      exit(0);
      return;
    }
    shuttingDown = true;
    log(`${signal} received, finishing in-flight requests (up to ${graceMs} ms)`);
    for (const res of inFlight) closeAfter(res);
    // close() stops listening, closes idle keep-alive sockets (Node 19+) and runs the callback once
    // every connection has ended. Sockets with a request in flight are left to finish it.
    server.close(() => exit(0));
    setTimeout(() => {
      log(`Requests still running after ${graceMs} ms, exiting`);
      exit(0);
    }, graceMs).unref();
  };
}
