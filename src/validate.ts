/** Input validation and date helpers shared by the NBU client and the MCP tools. */

/** Error whose message is safe and useful to show to an MCP client. */
export class UserError extends Error {
  override name = "UserError";
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const NBU_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** Normalise an ISO 4217 code ("usd" -> "USD"). Throws UserError when malformed. */
export function normalizeCurrency(input: string): string {
  const code = input.trim();
  if (!CURRENCY.test(code)) {
    throw new UserError(
      `Invalid currency code "${input}". Use a 3-letter ISO 4217 code such as USD, EUR or PLN.`,
    );
  }
  return code.toUpperCase();
}

/**
 * A year/month/day formatter for the first time zone the runtime's ICU knows. "Europe/Kiev" is
 * the pre-2022b name, kept as a fallback for Node builds linked against older system tzdata.
 */
export function createDateFormatter(zones: readonly string[] = ["Europe/Kyiv", "Europe/Kiev"]) {
  for (const timeZone of zones) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // RangeError: unknown time zone; try the next name.
    }
  }
  throw new Error(`None of the time zones ${zones.join(", ")} is supported by this runtime.`);
}

// Created on first use, so a runtime without either zone name fails a tool call, not the import.
let kyivDate: Intl.DateTimeFormat | undefined;
const kyivFormatter = () => {
  kyivDate ??= createDateFormatter();
  return kyivDate;
};

/** Today's calendar date in Kyiv as YYYY-MM-DD. NBU publishes rates on Kyiv time. */
export function kyivToday(now: Date = new Date(), formatter: Intl.DateTimeFormat = kyivFormatter()): string {
  // Build from parts rather than relying on a locale's pattern happening to be YYYY-MM-DD.
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month").padStart(2, "0")}-${part("day").padStart(2, "0")}`;
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Validate a YYYY-MM-DD date. It must be a real calendar day and not later than
 * tomorrow in Kyiv (NBU sets the next day's rates around 15:30 Kyiv time).
 */
export function validateDate(input: string, now: Date = new Date()): string {
  const match = ISO_DATE.exec(input.trim());
  if (!match) {
    throw new UserError(`Invalid date "${input}". Use the YYYY-MM-DD format, e.g. 2026-10-22.`);
  }
  const iso = match[0];
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new UserError(`Invalid date "${input}": no such calendar day.`);
  }
  const latest = addDays(kyivToday(now), 1);
  if (iso > latest) {
    throw new UserError(
      `Date ${iso} is in the future. NBU publishes rates at most one day ahead (latest: ${latest}).`,
    );
  }
  return iso;
}

/** YYYY-MM-DD -> YYYYMMDD as expected by the NBU API. */
export function toNbuQueryDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

/** NBU "DD.MM.YYYY" -> YYYY-MM-DD. Returns the input unchanged when it does not match. */
export function fromNbuDate(nbuDate: string): string {
  const m = NBU_DATE.exec(nbuDate);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : nbuDate;
}

/**
 * Multiply by 10^exp by editing the shortest decimal representation, so 1.005 shifts to exactly
 * 100.5 (1.005 * 100 in binary floats is 100.49999999999999).
 */
function shiftDecimal(value: number, exp: number): number {
  const [mantissa, e = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(e) + exp}`);
}

/** Round half away from zero to a fixed number of decimal places. round(-x, d) === -round(x, d). */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = shiftDecimal(Math.round(shiftDecimal(Math.abs(value), decimals)), -decimals);
  return value < 0 && rounded !== 0 ? -rounded : rounded; // no -0
}

/**
 * Round to `decimals` places, but keep at least `significant` significant digits when
 * |value| < 1, so small results (e.g. 100 UAH in gold) do not collapse to 0.
 */
export function roundAdaptive(value: number, decimals: number, significant: number): number {
  const abs = Math.abs(value);
  if (abs >= 1 || abs === 0 || !Number.isFinite(value)) return round(value, decimals);
  const needed = significant - 1 - Math.floor(Math.log10(abs));
  return round(value, Math.max(decimals, needed));
}
