import type { NbuRateItem } from "../src/nbu.js";

export const RATES_2026_10_22: NbuRateItem[] = [
  { r030: 840, txt: "Долар США", rate: 45.0256, cc: "USD", exchangedate: "22.10.2026", special: "N" },
  { r030: 978, txt: "Євро", rate: 50.5601, cc: "EUR", exchangedate: "22.10.2026", special: "N" },
  { r030: 985, txt: "Злотий", rate: 11.8742, cc: "PLN", exchangedate: "22.10.2026", special: null },
  {
    r030: 36,
    txt: "Австралійський долар",
    rate: 31.6589,
    cc: "AUD",
    exchangedate: "22.10.2026",
    special: null,
  },
];

/** Fixed clock: 22 Oct 2026, 12:00 Kyiv. */
export const NOW = new Date("2026-10-22T09:00:00Z");

export interface FakeFetch {
  fetch: typeof fetch;
  calls: string[];
}

/** A fetch stub answering NBU URLs from a map of query date -> payload (or a Response factory). */
export function fakeFetch(routes: Record<string, unknown | (() => Response)>): FakeFetch {
  const calls: string[] = [];
  const impl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.toString());
    const key = url.searchParams.get("date") ?? "today";
    const route = routes[key];
    if (route === undefined) return Response.json([]);
    return typeof route === "function" ? (route as () => Response)() : Response.json(route);
  };
  return { fetch: impl as typeof fetch, calls };
}
