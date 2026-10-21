import { describe, expect, it } from "vitest";
import { NbuClient } from "../src/nbu.js";
import { convert, getRate, listRates, runTool } from "../src/tools.js";
import { fakeFetch, RATES_2026_10_22 } from "./fixtures.js";

const DATE = "2026-10-20"; // a past date, so validation passes regardless of the real clock
const nbu = () => new NbuClient({ fetch: fakeFetch({ "20261020": RATES_2026_10_22 }).fetch, cache: null });

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

  it("runTool turns validation and lookup failures into MCP tool errors", async () => {
    const bad = await runTool(getRate, nbu(), { currency: "XXX", date: DATE });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toMatch(/XXX/);
    const future = await runTool(getRate, nbu(), { currency: "USD", date: "2999-01-01" });
    expect(future.isError).toBe(true);
    expect(future.content[0]?.text).toMatch(/in the future/);
  });
});
