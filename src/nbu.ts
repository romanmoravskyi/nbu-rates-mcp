/** Client for the public NBU exchange-rate API, with an in-memory cache in front of it. */
import { TtlCache } from "./cache.js";
import { fromNbuDate, kyivToday, toNbuQueryDate, UserError } from "./validate.js";

export const NBU_API_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";

/** One item as returned by the NBU API. */
export interface NbuRateItem {
  r030: number;
  txt: string;
  rate: number;
  cc: string;
  exchangedate: string;
  special?: string | null;
}

/** Normalised rate used by the tools. */
export interface Rate {
  currency: string;
  rate_uah: number;
  name_uk: string;
  date: string;
}

/** Raised when the NBU API is unreachable or returns something unexpected. */
export class UpstreamError extends Error {
  override name = "UpstreamError";
}

export interface NbuClientOptions {
  /** Defaults to the global fetch. Injected in tests. */
  fetch?: typeof fetch;
  /** Defaults to a new in-memory TtlCache. Pass null to disable caching. */
  cache?: TtlCache<Rate[]> | null;
  /** Clock, injectable for tests. */
  now?: () => Date;
  timeoutMs?: number;
}

export const TTL_CURRENT_SECONDS = 60 * 60; // today / tomorrow: rates can still appear
export const TTL_PAST_SECONDS = 24 * 60 * 60; // past dates never change

export function buildUrl(date?: string): string {
  return date ? `${NBU_API_URL}?date=${toNbuQueryDate(date)}&json` : `${NBU_API_URL}?json`;
}

export function ttlFor(date: string | undefined, now: Date): number {
  return !date || date >= kyivToday(now) ? TTL_CURRENT_SECONDS : TTL_PAST_SECONDS;
}

/** Validate and normalise the raw upstream payload. */
export function parseRates(payload: unknown): Rate[] {
  if (!Array.isArray(payload)) {
    throw new UpstreamError("NBU API returned an unexpected payload (expected a JSON array).");
  }
  return payload.flatMap((item: Partial<NbuRateItem>) => {
    if (typeof item?.cc !== "string" || typeof item.rate !== "number") return [];
    return [
      {
        currency: item.cc.toUpperCase(),
        rate_uah: item.rate,
        name_uk: typeof item.txt === "string" ? item.txt : item.cc,
        date: fromNbuDate(String(item.exchangedate ?? "")),
      },
    ];
  });
}

export class NbuClient {
  readonly #fetch: typeof fetch;
  readonly #cache: TtlCache<Rate[]> | null;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: NbuClientOptions = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? (() => new Date());
    this.#cache =
      options.cache === undefined
        ? new TtlCache<Rate[]>({ now: () => this.#now().getTime() })
        : options.cache;
    this.#timeoutMs = options.timeoutMs ?? 8000;
  }

  /** All official rates for a date (YYYY-MM-DD, already validated), or today when omitted. */
  async getRates(date?: string): Promise<Rate[]> {
    const url = buildUrl(date);
    const cached = this.#cache?.get(url);
    if (cached) return cached;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError(`Could not reach the NBU API: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new UpstreamError(`NBU API responded with HTTP ${response.status}. Try again later.`);
    }
    const body = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new UpstreamError("NBU API returned a response that is not valid JSON.");
    }
    const rates = parseRates(payload);

    // Only cache non-empty answers: an empty list for tomorrow may fill in later.
    if (this.#cache && rates.length > 0) {
      this.#cache.set(url, rates, ttlFor(date, this.#now()));
    }
    return rates;
  }

  /** All rates for a date, failing with a helpful message when NBU has none. */
  async getRatesOrThrow(date?: string): Promise<Rate[]> {
    const rates = await this.getRates(date);
    if (rates.length === 0) {
      throw new UserError(
        date
          ? `NBU has not published rates for ${date} yet. Rates for the next day usually appear after 15:30 Kyiv time.`
          : "NBU returned no rates for today. Try again later.",
      );
    }
    return rates;
  }

  /** A single currency's rate, or a UserError when NBU does not quote it. */
  async getRate(currency: string, date?: string): Promise<Rate> {
    const rates = await this.getRatesOrThrow(date);
    const rate = rates.find((r) => r.currency === currency);
    if (!rate) {
      throw new UserError(
        `NBU does not publish an official rate for "${currency}"${date ? ` on ${date}` : ""}. Use list_rates to see available currencies.`,
      );
    }
    return rate;
  }
}
