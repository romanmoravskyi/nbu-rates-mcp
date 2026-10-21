import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/cache.js";

describe("TtlCache", () => {
  it("returns values until their TTL passes", () => {
    let now = 1_000;
    const cache = new TtlCache<string>({ now: () => now });
    cache.set("a", "x", 10);
    expect(cache.get("a")).toBe("x");
    now += 9_999;
    expect(cache.get("a")).toBe("x");
    now += 1;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry beyond maxEntries", () => {
    const cache = new TtlCache<number>({ maxEntries: 2 });
    cache.set("a", 1, 60);
    cache.set("b", 2, 60);
    cache.set("a", 3, 60); // rewrite moves "a" to the newest position
    cache.set("c", 4, 60);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(3);
    expect(cache.get("c")).toBe(4);
  });
});
