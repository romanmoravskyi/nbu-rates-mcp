import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/cache.js";
import {
  buildUrl,
  NbuClient,
  parseRates,
  type Rate,
  TTL_CURRENT_SECONDS,
  TTL_PAST_SECONDS,
  ttlFor,
  UpstreamError,
} from "../src/nbu.js";
import { UserError } from "../src/validate.js";
import { fakeFetch, NOW, RATES_2026_10_22 } from "./fixtures.js";

const client = (f: typeof fetch, cache: TtlCache<Rate[]> | null = null) =>
  new NbuClient({ fetch: f, cache, now: () => NOW });

describe("parseRates", () => {
  it("normalises upstream items and skips malformed ones", () => {
    const rates = parseRates([...RATES_2026_10_22, { foo: 1 }, null]);
    expect(rates).toHaveLength(4);
    expect(rates[0]).toEqual({
      currency: "USD",
      rate_uah: 45.0256,
      name_uk: "Долар США",
      date: "2026-10-22",
    });
  });

  it("rejects non-array payloads", () => {
    expect(() => parseRates({ message: "oops" })).toThrow(UpstreamError);
  });
});

describe("URLs and TTLs", () => {
  it("builds the documented NBU query URLs", () => {
    expect(buildUrl("2026-10-21")).toBe(
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=20261021&json",
    );
  });

  it("caches today and tomorrow for 1 hour, past dates for 24 hours", () => {
    expect(ttlFor("2026-10-22", NOW)).toBe(TTL_CURRENT_SECONDS);
    expect(ttlFor("2026-10-23", NOW)).toBe(TTL_CURRENT_SECONDS);
    expect(ttlFor("2026-10-01", NOW)).toBe(TTL_PAST_SECONDS);
  });
});

describe("NbuClient", () => {
  it("returns a single currency rate", async () => {
    const f = fakeFetch({ "20261022": RATES_2026_10_22 });
    const rate = await client(f.fetch).getRate("EUR", "2026-10-22");
    expect(rate.rate_uah).toBe(50.5601);
    expect(f.calls[0]).toContain("date=20261022");
  });

  it("raises a UserError for unknown currencies", async () => {
    const f = fakeFetch({ "20261022": RATES_2026_10_22 });
    await expect(client(f.fetch).getRate("XXX", "2026-10-22")).rejects.toThrow(
      /does not publish an official rate for "XXX"/,
    );
  });

  it("raises a UserError when NBU has no rates yet", async () => {
    const f = fakeFetch({ "20261023": [] });
    await expect(client(f.fetch).getRatesOrThrow("2026-10-23")).rejects.toThrow(UserError);
    await expect(client(f.fetch).getRatesOrThrow("2026-10-23")).rejects.toThrow(/not published .* yet/);
  });

  it("says a past date has no rates instead of 'not published yet'", async () => {
    const f = fakeFetch({ "19000101": [] });
    const err = await client(f.fetch)
      .getRatesOrThrow("1900-01-01")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toMatch(/NBU has no official rates for 1900-01-01/);
    expect((err as Error).message).not.toMatch(/yet|15:30/);
  });

  it("picks the empty-answer message from the day it queried, even if midnight passes mid-fetch", async () => {
    let now = new Date("2026-10-22T20:59:59Z"); // 23:59:59 Kyiv, 22 Oct
    const f = fakeFetch({ "20261022": [] });
    const slow = (async (...args: Parameters<typeof fetch>) => {
      now = new Date("2026-10-22T21:00:01Z"); // answer arrives at 00:00:01 Kyiv, 23 Oct
      return f.fetch(...args);
    }) as typeof fetch;
    const c = new NbuClient({ fetch: slow, cache: null, now: () => now });
    await expect(c.getRatesOrThrow("2026-10-22")).rejects.toThrow(/not published rates for 2026-10-22 yet/);
  });

  it("requests today by its explicit Kyiv date and shares the cache with dated lookups", async () => {
    const cache = new TtlCache<Rate[]>();
    const f = fakeFetch({ "20261022": RATES_2026_10_22 });
    const c = client(f.fetch, cache);
    expect(await c.getRates()).toHaveLength(4);
    expect(await c.getRates("2026-10-22")).toHaveLength(4);
    expect(f.calls).toEqual([buildUrl("2026-10-22")]);
  });

  it("does not serve yesterday's undated entry after Kyiv midnight", async () => {
    let now = new Date("2026-10-21T20:50:00Z").getTime(); // 23:50 Kyiv, 21 Oct
    const cache = new TtlCache<Rate[]>({ now: () => now });
    const f = fakeFetch({ "20261021": RATES_2026_10_22, "20261022": RATES_2026_10_22 });
    const c = new NbuClient({ fetch: f.fetch, cache, now: () => new Date(now) });
    await c.getRates();
    now += 30 * 60 * 1000; // 00:20 Kyiv, 22 Oct: well within the 1-hour TTL
    await c.getRates();
    expect(f.calls.map((u) => new URL(u).searchParams.get("date"))).toEqual(["20261021", "20261022"]);
  });

  it("wraps HTTP errors, network errors and invalid JSON as UpstreamError", async () => {
    const http = fakeFetch({ "20261022": () => new Response("busy", { status: 503 }) });
    await expect(client(http.fetch).getRates()).rejects.toThrow(/HTTP 503/);

    const broken = fakeFetch({ "20261022": () => new Response("Wrong date format") });
    await expect(client(broken.fetch).getRates()).rejects.toThrow(/not valid JSON/);

    const offline = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    await expect(client(offline).getRates()).rejects.toThrow(
      /Could not reach the NBU API: connection refused/,
    );
  });

  it("wraps a failure while reading the response body as UpstreamError", async () => {
    const stalled = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[{"cc":"USD"'));
            controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
          },
        }),
        { status: 200 },
      );
    const f = fakeFetch({ "20261022": stalled });
    const err = await client(f.fetch)
      .getRates()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as Error).message).toMatch(/Could not read the NBU API response: .*timeout/);
  });

  it("serves repeated lookups from the in-memory cache", async () => {
    const cache = new TtlCache<Rate[]>();
    const f = fakeFetch({ "20261020": RATES_2026_10_22 });
    const c = client(f.fetch, cache);
    await c.getRates("2026-10-20");
    const again = await c.getRates("2026-10-20");
    expect(again).toHaveLength(4);
    expect(f.calls).toHaveLength(1);
  });

  it("does not cache empty answers", async () => {
    const cache = new TtlCache<Rate[]>();
    const f = fakeFetch({ "20261023": [] });
    const c = client(f.fetch, cache);
    await c.getRates("2026-10-23");
    await c.getRates("2026-10-23");
    expect(f.calls).toHaveLength(2);
    expect(cache.size).toBe(0);
  });

  it("expires today's entry after 1 hour and a past date's after 24 hours", async () => {
    let now = NOW.getTime();
    const cache = new TtlCache<Rate[]>({ now: () => now });
    const f = fakeFetch({ "20261022": RATES_2026_10_22, "20261020": RATES_2026_10_22 });
    const c = new NbuClient({ fetch: f.fetch, cache, now: () => new Date(now) });
    await c.getRates("2026-10-22");
    await c.getRates("2026-10-20");
    now += TTL_CURRENT_SECONDS * 1000 + 1;
    await c.getRates("2026-10-22"); // expired: refetched
    await c.getRates("2026-10-20"); // still cached
    expect(f.calls.map((u) => new URL(u).searchParams.get("date"))).toEqual([
      "20261022",
      "20261020",
      "20261022",
    ]);
  });

  it("uses a shared in-memory cache by default", async () => {
    const f = fakeFetch({ "20261020": RATES_2026_10_22 });
    const c = new NbuClient({ fetch: f.fetch, now: () => NOW });
    await c.getRate("USD", "2026-10-20");
    await c.getRate("EUR", "2026-10-20");
    expect(f.calls).toHaveLength(1);
  });
});
