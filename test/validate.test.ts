import { describe, expect, it } from "vitest";
import {
  addDays,
  fromNbuDate,
  kyivToday,
  normalizeCurrency,
  round,
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

  it("rounds to fixed decimals", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(112.29261, 2)).toBe(112.29);
  });
});
