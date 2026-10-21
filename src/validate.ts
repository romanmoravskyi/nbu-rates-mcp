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

/** Today's calendar date in Kyiv as YYYY-MM-DD. NBU publishes rates on Kyiv time. */
export function kyivToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

/** Round to a fixed number of decimal places, avoiding most binary float artefacts. */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
