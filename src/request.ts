/**
 * Helpers that read client-controlled parts of an HTTP request (target URL, Host, X-Forwarded-Proto).
 * They never throw and never pass through a value they have not validated.
 */
import type { IncomingHttpHeaders } from "node:http";

const FALLBACK_HOST = "localhost";

/**
 * Path of the request target, for routing. Origin-form ("/a?b") is resolved against a fixed base,
 * so headers play no part and "//x/y" stays a path; absolute-form must be http(s); "*" is kept as is.
 * Returns undefined for anything else, or if the target is not a valid URL.
 */
export function requestPath(target: string | undefined): string | undefined {
  const raw = target ?? "/";
  if (raw === "*") return raw;
  if (!raw.startsWith("/") && !/^https?:\/\//i.test(raw)) return undefined;
  try {
    return new URL(raw.startsWith("/") ? `http://localhost${raw}` : raw).pathname;
  } catch {
    return undefined;
  }
}

/** "http" or "https" from the first X-Forwarded-Proto value; anything else means "http". */
export function forwardedProto(value: string | string[] | undefined): "http" | "https" {
  const first = String(value ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return first === "https" ? "https" : "http";
}

/**
 * The Host header as `proto://host[:port]`, normalized by the WHATWG URL parser (the same parser
 * the /mcp Host check uses). Anything that is not a bare host[:port] falls back to "localhost".
 */
function originFor(proto: "http" | "https", host = ""): string {
  // Without these characters the URL can only have an authority, so its origin is host[:port] alone.
  if (!/[/?#@\\]/.test(host)) {
    try {
      return new URL(`${proto}://${host}`).origin;
    } catch {
      // not a valid host[:port]: fall back
    }
  }
  return `${proto}://${FALLBACK_HOST}`;
}

/**
 * Origin advertised on the home page, from X-Forwarded-Proto (http/https only) and Host.
 * X-Forwarded-Host is deliberately ignored so it cannot change what the page advertises.
 */
export function publicOrigin(headers: IncomingHttpHeaders): string {
  return originFor(forwardedProto(headers["x-forwarded-proto"]), headers.host);
}
