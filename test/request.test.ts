import { describe, expect, it } from "vitest";
import { forwardedProto, publicOrigin, requestPath } from "../src/request.js";

describe("requestPath", () => {
  it("returns the path of origin-form and http(s) absolute-form targets", () => {
    expect(requestPath("/mcp?x=1")).toBe("/mcp");
    expect(requestPath(undefined)).toBe("/");
    expect(requestPath("http://localhost:8787/health")).toBe("/health");
    expect(requestPath("HTTPS://localhost/mcp")).toBe("/mcp");
  });

  it("keeps a leading // as part of the path instead of reading it as a host", () => {
    expect(requestPath("//evil.example/mcp")).toBe("//evil.example/mcp");
    expect(requestPath("//[")).toBe("//[");
  });

  it("keeps the asterisk-form target of OPTIONS *", () => {
    expect(requestPath("*")).toBe("*");
  });

  it("returns undefined for other schemes and unparsable targets instead of throwing", () => {
    for (const t of ["http://[/", "file:///mcp", "foo:/mcp", "mcp", "javascript:alert(1)"]) {
      expect(requestPath(t)).toBeUndefined();
    }
  });
});

describe("forwardedProto", () => {
  it("accepts http and https, case-insensitively, taking the first listed value", () => {
    expect(forwardedProto("https")).toBe("https");
    expect(forwardedProto(" HTTPS ")).toBe("https");
    expect(forwardedProto("https, http")).toBe("https");
    expect(forwardedProto("http, https")).toBe("http");
  });

  it("falls back to http for anything else", () => {
    for (const v of [undefined, "", "javascript", "ftp", "a b", "https://x", "<script>", ",https"]) {
      expect(forwardedProto(v)).toBe("http");
    }
  });
});

describe("publicOrigin", () => {
  const origin = (host: string | undefined, proto?: string) =>
    publicOrigin({ host, ...(proto === undefined ? {} : { "x-forwarded-proto": proto }) });

  it("uses a valid Host as normalized by the URL parser", () => {
    expect(origin("localhost:8787")).toBe("http://localhost:8787");
    expect(origin("Rates.Example.COM", "https")).toBe("https://rates.example.com");
    expect(origin("rates.example.com:443", "https")).toBe("https://rates.example.com");
    expect(origin("127.0.0.1")).toBe("http://127.0.0.1");
    expect(origin("[::1]:8787")).toBe("http://[::1]:8787");
    expect(origin("nbu_rates:8787")).toBe("http://nbu_rates:8787");
    expect(origin("rates.example.com.")).toBe("http://rates.example.com.");
  });

  it("falls back to localhost for malformed or hostile Host values", () => {
    const bad = [
      undefined,
      "",
      "local host",
      "<script>alert(1)</script>",
      "%3Cscript%3E",
      "evil.example/phish",
      "evil.example?x",
      "evil.example#x",
      "user@evil.example",
      "evil.example\\x",
      "evil.example:99999",
      "evil.example:80:80",
      "[::1",
      "[.:.]",
      "999.999.999.999",
    ];
    for (const v of bad) expect(origin(v, "https")).toBe("https://localhost");
  });

  it("ignores X-Forwarded-Host and a non-http(s) X-Forwarded-Proto", () => {
    expect(
      publicOrigin({
        host: "rates.example.com",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "ftp",
      }),
    ).toBe("http://rates.example.com");
  });
});
