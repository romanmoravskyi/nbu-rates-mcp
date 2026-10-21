import { describe, expect, it } from "vitest";
import { NbuClient } from "../src/nbu.js";
import { convert, convertInput, getRate, listRates, runTool } from "../src/tools.js";
import { kyivToday } from "../src/validate.js";
import { fakeFetch, RATES_2026_10_22 } from "./fixtures.js";

const DATE = "2026-10-20"; // a past date, so validation passes regardless of the real clock
const nbu = () => new NbuClient({ fetch: fakeFetch({ "20261020": RATES_2026_10_22 }).fetch, cache: null });

/** True when an undated call reports today's Kyiv date (either side of midnight, to avoid flakes). */
async function undatedDate(call: () => Promise<{ data: { date: string } }>): Promise<boolean> {
  const before = kyivToday();
  const { data } = await call();
  return data.date === before || data.date === kyivToday();
}

describe("tool handlers", () => {
  it("get_rate is case-insensitive and returns the documented shape", async () => {
    const { data, summary } = await getRate(nbu(), { currency: "usd", date: DATE });
    expect(data).toEqual({ currency: "USD", rate_uah: 45.0256, date: "2026-10-22", name_uk: "Долар США" });
    expect(summary).toBe("1 USD = 45.0256 UAH (NBU official rate, 2026-10-22)");
  });

  it("list_rates sorts by code and supports a filter", async () => {
    const all = await listRates(nbu(), { date: DATE });
    expect(all.data.rates.map((r) => r.currency)).toEqual(["AUD", "EUR", "PLN", "USD"]);
    const some = await listRates(nbu(), { date: DATE, currencies: ["usd", "EUR"] });
    expect(some.data.rates.map((r) => r.currency)).toEqual(["EUR", "USD"]);
    await expect(listRates(nbu(), { date: DATE, currencies: ["XXX"] })).rejects.toThrow(/XXX/);
  });

  it("convert crosses via UAH: 100 EUR -> USD", async () => {
    const { data } = await convert(nbu(), { amount: 100, from: "EUR", to: "usd", date: DATE });
    expect(data).toEqual({
      amount: 100,
      from: "EUR",
      to: "USD",
      result: 112.29,
      rate_used: 1.122919,
      date: "2026-10-22",
    });
  });

  it("convert handles UAH on either side", async () => {
    const toUah = await convert(nbu(), { amount: 2, from: "USD", to: "UAH", date: DATE });
    expect(toUah.data.result).toBe(90.05);
    const fromUah = await convert(nbu(), { amount: 1000, from: "UAH", to: "PLN", date: DATE });
    expect(fromUah.data.result).toBe(84.22);
    const same = await convert(nbu(), { amount: 5, from: "uah", to: "UAH", date: DATE });
    expect(same.data.rate_used).toBe(1);
  });

  it("list_rates treats an empty currencies array as no filter (#7)", async () => {
    const { data, summary } = await listRates(nbu(), { date: DATE, currencies: [] });
    expect(data.rates.map((r) => r.currency)).toEqual(["AUD", "EUR", "PLN", "USD"]);
    expect(summary).toMatch(/^4 NBU official rates/);
  });

  it("get_rate and list_rates return UAH as the base currency with rate 1 (#11)", async () => {
    const fake = fakeFetch({ "20261020": RATES_2026_10_22 });
    const client = new NbuClient({ fetch: fake.fetch, cache: null });
    const uah = await getRate(client, { currency: "uah", date: DATE });
    expect(uah.data).toEqual({ currency: "UAH", rate_uah: 1, date: DATE, name_uk: "Українська гривня" });
    expect(uah.summary).toBe(`1 UAH = 1 UAH (base currency, not an NBU quote, ${DATE})`);
    expect(fake.calls).toEqual([]);
    expect(await undatedDate(() => getRate(client, { currency: "UAH" }))).toBe(true);

    const mixed = await listRates(client, { date: DATE, currencies: ["USD", "uah"] });
    expect(mixed.data.rates).toEqual([
      { currency: "UAH", rate_uah: 1, name_uk: "Українська гривня" },
      { currency: "USD", rate_uah: 45.0256, name_uk: RATES_2026_10_22[0]?.txt },
    ]);
    expect(mixed.data.date).toBe("2026-10-22");

    fake.calls.length = 0;
    const only = await listRates(client, { date: DATE, currencies: ["UAH"] });
    expect(only.data).toEqual({
      date: DATE,
      rates: [{ currency: "UAH", rate_uah: 1, name_uk: "Українська гривня" }],
    });
    expect(fake.calls).toEqual([]);
  });

  it("convert keeps significant digits for small results instead of rounding to 0 (#13)", async () => {
    const xau = { r030: 959, txt: "Золото", rate: 170000, cc: "XAU", exchangedate: "22.10.2026" };
    const gold = [...RATES_2026_10_22, xau];
    const client = new NbuClient({ fetch: fakeFetch({ "20261020": gold }).fetch, cache: null });
    const { data, summary } = await convert(client, { amount: 100, from: "UAH", to: "XAU", date: DATE });
    expect(data.result).toBe(0.0005882);
    expect(data.rate_used).toBe(0.00000588235);
    expect(summary).toContain("= 0.0005882 XAU");
    // Results of 1 or more keep 2 decimals.
    const back = await convert(client, { amount: 1, from: "XAU", to: "USD", date: DATE });
    expect(back.data.result).toBe(3775.63);
  });

  it("convert rejects negative amounts (#15)", async () => {
    expect(convertInput.safeParse({ amount: -100, from: "EUR", to: "USD" }).success).toBe(false);
    expect(convertInput.safeParse({ amount: 0, from: "EUR", to: "USD" }).success).toBe(true);
  });

  it("convert UAH -> UAH works without calling NBU (#18)", async () => {
    const down = fakeFetch({ today: () => new Response("down", { status: 503 }) });
    const client = new NbuClient({ fetch: down.fetch, cache: null });
    const { data } = await convert(client, { amount: 5, from: "UAH", to: "uah", date: DATE });
    expect(data).toEqual({ amount: 5, from: "UAH", to: "UAH", result: 5, rate_used: 1, date: DATE });
    expect(await undatedDate(() => convert(client, { amount: 5, from: "UAH", to: "UAH" }))).toBe(true);
    expect(down.calls).toEqual([]);
  });

  it("runTool turns validation and lookup failures into MCP tool errors", async () => {
    const bad = await runTool(getRate, nbu(), { currency: "XXX", date: DATE });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toMatch(/XXX/);
    const future = await runTool(getRate, nbu(), { currency: "USD", date: "2999-01-01" });
    expect(future.isError).toBe(true);
    expect(future.content[0]?.text).toMatch(/in the future/);
  });
});
