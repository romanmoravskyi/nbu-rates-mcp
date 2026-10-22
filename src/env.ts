/**
 * Pure parsing of the HTTP listen settings (PORT, NBU_MCP_HOST/HOST, ALLOWED_HOSTS) from an
 * environment object, plus the address helpers the entry point uses for its startup messages.
 * Empty or whitespace-only values count as unset, so `HOST=` from an env file keeps the loopback
 * default instead of binding every interface. An invalid PORT throws a ConfigError. Nothing here
 * logs: notes for the operator come back as `warnings` for the entry point to print.
 */
import { BlockList, isIP } from "node:net";
import { hostname as osHostname } from "node:os";

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = "127.0.0.1";

export interface ListenConfig {
  port: number;
  host: string;
  /** Extra hostnames from ALLOWED_HOSTS, on top of the always-allowed loopback names. */
  extraAllowedHosts: string[];
  /** Operator-facing notes about settings that were ignored; the entry point logs them to stderr. */
  warnings: string[];
}

/** A configuration value the process cannot start with; the message is meant for the operator. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** The trimmed value of an environment variable, or undefined when it is missing or blank. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Parse a TCP port: a whole number from 0 to 65535 (0 picks a free port). Undefined gives the default. */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(port >= 0 && port <= 65535)) {
    throw new ConfigError(`Invalid PORT ${JSON.stringify(raw)}: expected a whole number from 0 to 65535.`);
  }
  return port;
}

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");
const WILDCARD = new BlockList();
WILDCARD.addAddress("0.0.0.0", "ipv4");
WILDCARD.addAddress("::", "ipv6");

/** A host without the brackets of a URL-style IPv6 literal (`[::1]` becomes `::1`). */
function unbracket(host: string): string {
  return host.replace(/^\[(.*)\]$/, "$1");
}

/** True when `host` is an IP literal inside `list` (IPv4-mapped and expanded IPv6 forms included). */
function inList(list: BlockList, host: string): boolean {
  const family = isIP(host);
  return family !== 0 && list.check(host, family === 6 ? "ipv6" : "ipv4");
}

/** True for `localhost`, 127.0.0.0/8 and ::1 (including IPv4-mapped and expanded IPv6 forms). */
export function isLoopbackHost(host: string): boolean {
  const bare = unbracket(host).toLowerCase();
  return bare === "localhost" || inList(LOOPBACK, bare);
}

/** The part of a hostname before the first dot, lower-cased, ignoring a trailing root dot. */
function shortName(name: string): string {
  return name.toLowerCase().replace(/\.$/, "").split(".")[0] ?? "";
}

/**
 * True when HOST names this machine: the same short name (before the first dot, any case), so the
 * full and short names match either way round. Shells such as tcsh export HOST=<machine name>,
 * which would otherwise bind a network interface by accident.
 */
export function isMachineHostname(host: string, machine: string): boolean {
  if (isIP(host) !== 0 || isLoopbackHost(host)) return false;
  const short = shortName(machine);
  return short !== "" && shortName(host) === short;
}

/** Bind address: NBU_MCP_HOST, then HOST unless it is just the machine name, then 127.0.0.1. */
function readHost(env: NodeJS.ProcessEnv, machine: string, warnings: string[]): string {
  const raw = setting(env, "NBU_MCP_HOST");
  if (raw) return unbracket(raw);
  const host = setting(env, "HOST");
  if (host === undefined) return DEFAULT_HOST;
  if (isMachineHostname(host, machine)) {
    warnings.push(
      `Ignoring HOST=${host}: it matches this machine's hostname and is probably inherited from the ` +
        `shell. Listening on ${DEFAULT_HOST}; set NBU_MCP_HOST to bind it.`,
    );
    return DEFAULT_HOST;
  }
  return unbracket(host);
}

/** `machine` is this machine's hostname (injectable for tests); it defaults to `os.hostname()`. */
export function readListenConfig(env: NodeJS.ProcessEnv, machine: string = osHostname()): ListenConfig {
  const warnings: string[] = [];
  return {
    port: parsePort(setting(env, "PORT")),
    host: readHost(env, machine, warnings),
    extraAllowedHosts: (env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    warnings,
  };
}

/** A host as it appears before `:port` in a URL: IPv6 literals get brackets, a zone `%` becomes `%25`. */
export function urlHost(host: string): string {
  if (!host.includes(":") || host.startsWith("[")) return host;
  return `[${host.replace("%", "%25")}]`;
}

/** The MCP URL shown at startup; a wildcard bind is shown as localhost, which reaches it locally. */
export function mcpUrl(host: string, port: number): string {
  const shown = inList(WILDCARD, host) ? "localhost" : host;
  return `http://${urlHost(shown)}:${port}/mcp`;
}

/** A stderr warning when the bound address is reachable from other machines, else undefined. */
export function exposureWarning(address: string): string | undefined {
  if (isLoopbackHost(address)) return undefined;
  return (
    `Warning: listening on ${address}, which is not a loopback address, so the server is reachable ` +
    "from other machines and has no authentication. To keep it local, set NBU_MCP_HOST=127.0.0.1 " +
    "(or unset NBU_MCP_HOST and HOST). In a container, keep 0.0.0.0 and publish the port only to " +
    "127.0.0.1 or a trusted network instead (docker run -p 127.0.0.1:<port>:<port>)."
  );
}
