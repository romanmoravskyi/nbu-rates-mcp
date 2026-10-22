import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_HOST,
  DEFAULT_PORT,
  exposureWarning,
  isLoopbackHost,
  isMachineHostname,
  mcpUrl,
  parsePort,
  readListenConfig,
  urlHost,
} from "../src/env.js";

const MACHINE = "Build-Box.corp.example";

describe("readListenConfig", () => {
  it("defaults to loopback and port 8787", () => {
    expect(readListenConfig({}, MACHINE)).toEqual({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      extraAllowedHosts: [],
      warnings: [],
    });
    expect(DEFAULT_HOST).toBe("127.0.0.1");
  });

  it("still works without a hostname argument", () => {
    expect(readListenConfig({ HOST: "0.0.0.0" })).toMatchObject({ port: 8787, host: "0.0.0.0" });
  });

  // Regression for #8: HOST= used to reach listen() as "" and bind every interface.
  it("treats an empty or blank HOST as unset", () => {
    expect(readListenConfig({ HOST: "" }, MACHINE).host).toBe("127.0.0.1");
    expect(readListenConfig({ HOST: "  " }, MACHINE).host).toBe("127.0.0.1");
  });

  it("keeps an explicit HOST, trimmed", () => {
    expect(readListenConfig({ HOST: " 0.0.0.0 " }, MACHINE)).toMatchObject({ host: "0.0.0.0", warnings: [] });
    expect(readListenConfig({ HOST: "192.168.1.20" }, MACHINE).host).toBe("192.168.1.20");
    expect(readListenConfig({ HOST: "::" }, MACHINE).host).toBe("::");
    expect(readListenConfig({ HOST: "other-box" }, MACHINE).host).toBe("other-box");
  });

  // Regression for #27: tcsh exports HOST=<machine name>, which bound a network interface.
  it.each([
    "Build-Box.corp.example",
    "build-box.CORP.example",
    "build-box.corp.example.",
    "build-box",
    "BUILD-BOX",
    "build-box.lan",
  ])("ignores HOST=%s because it is this machine's name", (host) => {
    const config = readListenConfig({ HOST: host }, MACHINE);
    expect(config.host).toBe("127.0.0.1");
    expect(config.warnings).toEqual([
      `Ignoring HOST=${host}: it matches this machine's hostname and is probably inherited from the ` +
        "shell. Listening on 127.0.0.1; set NBU_MCP_HOST to bind it.",
    ]);
  });

  it("ignores a fully qualified HOST when the machine name is short", () => {
    expect(readListenConfig({ HOST: "build-box.lan" }, "Build-Box").host).toBe("127.0.0.1");
  });

  it("does not ignore a HOST that only shares a prefix with the machine name", () => {
    expect(readListenConfig({ HOST: "build-box-2.corp.example" }, MACHINE).host).toBe(
      "build-box-2.corp.example",
    );
  });

  it("prefers NBU_MCP_HOST over HOST, and honours it even when it is the machine name", () => {
    expect(readListenConfig({ NBU_MCP_HOST: "0.0.0.0", HOST: "10.0.0.1" }, MACHINE).host).toBe("0.0.0.0");
    const config = readListenConfig({ NBU_MCP_HOST: " build-box ", HOST: "build-box" }, MACHINE);
    expect(config).toMatchObject({ host: "build-box", warnings: [] });
  });

  it("strips URL brackets from an IPv6 host so listen() accepts it", () => {
    expect(readListenConfig({ NBU_MCP_HOST: "[::1]" }, MACHINE).host).toBe("::1");
    expect(readListenConfig({ HOST: "[::]" }, MACHINE).host).toBe("::");
  });

  it("falls through a blank NBU_MCP_HOST to HOST, then to the default", () => {
    expect(readListenConfig({ NBU_MCP_HOST: " ", HOST: "0.0.0.0" }, MACHINE).host).toBe("0.0.0.0");
    expect(readListenConfig({ NBU_MCP_HOST: "" }, MACHINE).host).toBe("127.0.0.1");
  });

  it("treats an empty PORT as unset", () => {
    expect(readListenConfig({ PORT: "" }, MACHINE).port).toBe(8787);
    expect(readListenConfig({ PORT: " 3000 " }, MACHINE).port).toBe(3000);
  });

  it("splits ALLOWED_HOSTS on commas and drops blanks", () => {
    expect(
      readListenConfig({ ALLOWED_HOSTS: " a.example , ,b.example," }, MACHINE).extraAllowedHosts,
    ).toEqual(["a.example", "b.example"]);
  });
});

describe("isMachineHostname", () => {
  it("never matches IP literals, loopback names or an unknown machine name", () => {
    expect(isMachineHostname("127.0.0.1", "127.0.0.1")).toBe(false);
    expect(isMachineHostname("localhost", "localhost")).toBe(false);
    expect(isMachineHostname("build-box", "")).toBe(false);
    expect(isMachineHostname("build-box-2", MACHINE)).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "localhost",
    "LocalHost",
  ])("%s is loopback", (host) => expect(isLoopbackHost(host)).toBe(true));

  it.each(["0.0.0.0", "::", "192.168.1.20", "10.0.0.1", "fe80::1", "128.0.0.1", "build-box"])(
    "%s is not loopback",
    (host) => expect(isLoopbackHost(host)).toBe(false),
  );
});

describe("exposureWarning", () => {
  it("says nothing for a loopback bind", () => {
    expect(exposureWarning("127.0.0.1")).toBeUndefined();
    expect(exposureWarning("::1")).toBeUndefined();
  });

  it("warns for a wildcard or network bind", () => {
    for (const address of ["0.0.0.0", "::", "192.168.1.20"]) {
      expect(exposureWarning(address)).toContain(`listening on ${address}, which is not a loopback address`);
      expect(exposureWarning(address)).toContain("no authentication");
    }
  });
});

// Regression for #31: the startup log printed http://::1:8787/mcp.
describe("mcpUrl and urlHost", () => {
  it("brackets IPv6 literals", () => {
    expect(mcpUrl("::1", 8787)).toBe("http://[::1]:8787/mcp");
    expect(mcpUrl("fe80::1", 3000)).toBe("http://[fe80::1]:3000/mcp");
    expect(urlHost("[::1]")).toBe("[::1]");
    expect(urlHost("fe80::1%eth0")).toBe("[fe80::1%25eth0]");
  });

  it("leaves IPv4 and names alone and shows wildcard binds as localhost", () => {
    expect(mcpUrl("127.0.0.1", 8787)).toBe("http://127.0.0.1:8787/mcp");
    expect(mcpUrl("nbu.example.com", 80)).toBe("http://nbu.example.com:80/mcp");
    expect(mcpUrl("0.0.0.0", 8787)).toBe("http://localhost:8787/mcp");
    expect(mcpUrl("::", 8787)).toBe("http://localhost:8787/mcp");
    expect(mcpUrl("0:0:0:0:0:0:0:0", 8787)).toBe("http://localhost:8787/mcp");
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
