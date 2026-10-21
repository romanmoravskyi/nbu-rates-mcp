/**
 * Pure parsing of the HTTP listen settings (PORT, HOST, ALLOWED_HOSTS) from an environment object.
 * Empty or whitespace-only values count as unset, so `HOST=` from an env file keeps the loopback
 * default instead of binding every interface. An invalid PORT throws a ConfigError.
 */
export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = "127.0.0.1";

export interface ListenConfig {
  port: number;
  host: string;
  /** Extra hostnames from ALLOWED_HOSTS, on top of the always-allowed loopback names. */
  extraAllowedHosts: string[];
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

export function readListenConfig(env: NodeJS.ProcessEnv): ListenConfig {
  return {
    port: parsePort(setting(env, "PORT")),
    host: setting(env, "HOST") ?? DEFAULT_HOST,
    extraAllowedHosts: (env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  };
}
