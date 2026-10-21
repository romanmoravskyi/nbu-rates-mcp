import { describe, expect, it } from "vitest";
import {
  addDays,
  createDateFormatter,
  fromNbuDate,
  kyivToday,
  normalizeCurrency,
  round,
  roundAdaptive,
  toNbuQueryDate,
  UserError,
  validateDate,
} from "../src/validate.js";
import { NOW } from "./fixtures.js";

describe("normalizeCurrency", () => {
  it("upper-cases and trims valid codes", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("Eur")).toBe("EUR");
  });

  it("rejects malformed codes with a helpful message", () => {
    expect(() => normalizeCurrency("US")).toThrow(UserError);
    expect(() => normalizeCurrency("dollar")).toThrow(/3-letter ISO 4217/);
    expect(() => normalizeCurrency("U5D")).toThrow(UserError);
  });
});

describe("validateDate", () => {
  it("accepts past dates, today and tomorrow (Kyiv)", () => {
    expect(validateDate("2024-02-29", NOW)).toBe("2024-02-29");
    expect(validateDate("2026-10-22", NOW)).toBe("2026-10-22");
    expect(validateDate("2026-10-23", NOW)).toBe("2026-10-23");
  });

  it("rejects wrong formats and impossible days", () => {
    expect(() => validateDate("22.10.2026", NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => validateDate("2026-1-5", NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => validateDate("2025-02-29", NOW)).toThrow(/no such calendar day/);
    expect(() => validateDate("2026-13-01", NOW)).toThrow(/no such calendar day/);
  });

  it("rejects dates more than one day ahead", () => {
    expect(() => validateDate("2026-10-24", NOW)).toThrow(/in the future/);
  });
});

describe("date helpers", () => {
  it("uses Kyiv time for 'today' around midnight UTC", () => {
    // 22:30 UTC on 21 Oct is already 22 Oct in Kyiv (UTC+3 in summer time).
    expect(kyivToday(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
  });

  it("converts between ISO, NBU display and NBU query formats", () => {
    expect(toNbuQueryDate("2026-10-22")).toBe("20261022");
    expect(fromNbuDate("22.10.2026")).toBe("2026-10-22");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles winter time (UTC+2) at the year boundary", () => {
    expect(kyivToday(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    expect(kyivToday(new Date("2026-12-31T21:30:00Z"))).toBe("2026-12-31");
  });

  it("builds YYYY-MM-DD from date parts, not from the locale's pattern (#17)", () => {
    const at = new Date("2026-10-21T22:30:00Z");
    // A formatter whose pattern is MM/DD/YYYY, with parts in a different order, still works.
    const formatter = createDateFormatter();
    expect(formatter.format(at)).toBe("10/22/2026");
    expect(kyivToday(at, formatter)).toBe("2026-10-22");
    const shuffled = {
      formatToParts: () => [
        { type: "day", value: "22" },
        { type: "literal", value: "." },
        { type: "month", value: "10" },
        { type: "literal", value: "." },
        { type: "year", value: "2026" },
      ],
    } as unknown as Intl.DateTimeFormat;
    expect(kyivToday(at, shuffled)).toBe("2026-10-22");
  });

  it("falls back to the legacy Europe/Kiev zone name when Europe/Kyiv is unknown (#17)", () => {
    const formatter = createDateFormatter(["Not/AZone", "Europe/Kiev"]);
    expect(formatter.resolvedOptions().timeZone).toMatch(/^Europe\/Ki(e|y)v$/);
    expect(kyivToday(new Date("2026-10-21T22:30:00Z"), formatter)).toBe("2026-10-22");
    expect(() => createDateFormatter(["Not/AZone"])).toThrow(/Not\/AZone/);
  });

  it("rounds to fixed decimals", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(112.29261, 2)).toBe(112.29);
    expect(round(1e21, 2)).toBe(1e21);
    expect(round(2.675, 2)).toBe(2.68);
    // A single rounding step: no double rounding of large values via an intermediate precision.
    expect(round(123456789012.3449, 2)).toBe(123456789012.34);
  });

  it("rounds negatives symmetrically, half away from zero (#15)", () => {
    expect(round(-1.005, 2)).toBe(-1.01);
    expect(round(-2.5, 0)).toBe(-3);
    expect(round(-112.29261, 2)).toBe(-112.29);
    expect(Object.is(round(-0.001, 2), 0)).toBe(true);
  });
});

describe("roundAdaptive (#13)", () => {
  it("keeps fixed decimals for values of 1 or more", () => {
    expect(roundAdaptive(112.29261, 2, 4)).toBe(112.29);
    expect(roundAdaptive(1.122919, 6, 6)).toBe(1.122919);
    expect(roundAdaptive(0, 2, 4)).toBe(0);
  });

  it("keeps significant digits for values below 1", () => {
    expect(roundAdaptive(100 / 170000, 2, 4)).toBe(0.0005882);
    expect(roundAdaptive(1 / 170000, 6, 6)).toBe(0.00000588235);
    expect(roundAdaptive(0.5123456, 2, 4)).toBe(0.5123);
    expect(roundAdaptive(-0.00012345, 2, 4)).toBe(-0.0001235);
    // Very small values come back as the shortest representation, without float noise.
    expect(roundAdaptive(1.23456e-20, 2, 4)).toBe(1.235e-20);
    expect(String(roundAdaptive(1.23456e-20, 2, 4))).toBe("1.235e-20");
  });
});
