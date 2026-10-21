import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_HOST, DEFAULT_PORT, parsePort, readListenConfig } from "../src/env.js";

describe("readListenConfig", () => {
  it("defaults to loopback and port 8787", () => {
    expect(readListenConfig({})).toEqual({ port: DEFAULT_PORT, host: DEFAULT_HOST, extraAllowedHosts: [] });
    expect(DEFAULT_HOST).toBe("127.0.0.1");
  });

  // Regression for #8: HOST= used to reach listen() as "" and bind every interface.
  it("treats an empty or blank HOST as unset", () => {
    expect(readListenConfig({ HOST: "" }).host).toBe("127.0.0.1");
    expect(readListenConfig({ HOST: "  " }).host).toBe("127.0.0.1");
  });

  it("keeps an explicit HOST, trimmed", () => {
    expect(readListenConfig({ HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
  });

  it("treats an empty PORT as unset", () => {
    expect(readListenConfig({ PORT: "" }).port).toBe(8787);
    expect(readListenConfig({ PORT: " 3000 " }).port).toBe(3000);
  });

  it("splits ALLOWED_HOSTS on commas and drops blanks", () => {
    expect(readListenConfig({ ALLOWED_HOSTS: " a.example , ,b.example," }).extraAllowedHosts).toEqual([
      "a.example",
      "b.example",
    ]);
  });
});

describe("parsePort", () => {
  it("accepts whole numbers from 0 to 65535", () => {
    expect(parsePort(undefined)).toBe(8787);
    expect(parsePort("0")).toBe(0);
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort("65535")).toBe(65535);
  });

  // Regression for #8: PORT=abc used to become NaN and crash listen() with ERR_SOCKET_BAD_PORT.
  it.each(["abc", "80abc", "-1", "65536", "1.5", "0x50", "1e3"])(
    "rejects %s with a readable error",
    (raw) => {
      expect(() => parsePort(raw)).toThrow(ConfigError);
      expect(() => parsePort(raw)).toThrow(`Invalid PORT "${raw}": expected a whole number from 0 to 65535.`);
    },
  );
});
