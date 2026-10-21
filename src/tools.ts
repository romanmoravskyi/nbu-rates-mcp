/** MCP tool definitions (zod schemas) and their handlers. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type NbuClient, UpstreamError } from "./nbu.js";
import { normalizeCurrency, round, UserError, validateDate } from "./validate.js";

const currency = z.string().describe("ISO 4217 currency code, case-insensitive, e.g. USD, eur, PLN.");
const date = z
  .string()
  .optional()
  .describe("Date in YYYY-MM-DD format. Defaults to today (Kyiv time). Tomorrow works after ~15:30 Kyiv.");

export const getRateInput = z.object({ currency, date });
export const listRatesInput = z.object({
  date,
  currencies: z.array(z.string()).optional().describe('Optional filter, e.g. ["USD", "EUR"].'),
});
export const convertInput = z.object({
  amount: z.number().finite().describe("Amount to convert, in units of `from`."),
  from: currency.describe("Source currency (ISO 4217). UAH is allowed."),
  to: currency.describe("Target currency (ISO 4217). UAH is allowed."),
  date,
});

const opt = (d: string | undefined) => (d === undefined ? undefined : validateDate(d));

export async function getRate(client: NbuClient, args: z.infer<typeof getRateInput>) {
  const code = normalizeCurrency(args.currency);
  const rate = await client.getRate(code, opt(args.date));
  const data = { currency: rate.currency, rate_uah: rate.rate_uah, date: rate.date, name_uk: rate.name_uk };
  return { data, summary: `1 ${data.currency} = ${data.rate_uah} UAH (NBU official rate, ${data.date})` };
}

export async function listRates(client: NbuClient, args: z.infer<typeof listRatesInput>) {
  const wanted = args.currencies?.map(normalizeCurrency);
  const all = await client.getRatesOrThrow(opt(args.date));
  if (wanted) {
    const missing = wanted.filter((c) => c !== "UAH" && !all.some((r) => r.currency === c));
    if (missing.length > 0) {
      throw new UserError(`NBU does not publish official rates for: ${missing.join(", ")}.`);
    }
  }
  const rates = all
    .filter((r) => !wanted || wanted.includes(r.currency))
    .map(({ currency, rate_uah, name_uk }) => ({ currency, rate_uah, name_uk }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const data = { date: all[0]?.date ?? "", rates };
  return { data, summary: `${rates.length} NBU official rates (UAH per 1 unit) for ${data.date}` };
}

export async function convert(client: NbuClient, args: z.infer<typeof convertInput>) {
  const from = normalizeCurrency(args.from);
  const to = normalizeCurrency(args.to);
  const day = opt(args.date);
  const rates = await client.getRatesOrThrow(day);
  const uahPer = (code: string): number => {
    if (code === "UAH") return 1;
    const r = rates.find((x) => x.currency === code);
    if (!r)
      throw new UserError(
        `NBU does not publish an official rate for "${code}". Use list_rates to see available currencies.`,
      );
    return r.rate_uah;
  };
  // Cross rate via UAH: amount * (UAH per `from`) / (UAH per `to`).
  const rateUsed = uahPer(from) / uahPer(to);
  const data = {
    amount: args.amount,
    from,
    to,
    result: round(args.amount * rateUsed, 2),
    rate_used: round(rateUsed, 6),
    date: rates[0]?.date ?? day ?? "",
  };
  return {
    data,
    summary: `${data.amount} ${from} = ${data.result} ${to} (rate ${data.rate_used}, NBU ${data.date})`,
  };
}

type Handler<A> = (client: NbuClient, args: A) => Promise<{ data: Record<string, unknown>; summary: string }>;

/** Run a handler and shape the result (or a friendly error) as an MCP tool result. */
export async function runTool<A>(handler: Handler<A>, client: NbuClient, args: A) {
  try {
    const { data, summary } = await handler(client, args);
    return {
      content: [
        { type: "text" as const, text: summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
      structuredContent: data,
    };
  } catch (err) {
    const known = err instanceof UserError || err instanceof UpstreamError;
    if (!known) console.error(JSON.stringify({ msg: "tool failed", error: String(err) }));
    const message = known ? (err as Error).message : "Unexpected error while fetching NBU rates.";
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

const annotations = { readOnlyHint: true, openWorldHint: true, idempotentHint: true };

export function registerTools(server: McpServer, client: NbuClient): void {
  server.registerTool(
    "get_rate",
    {
      title: "Get NBU rate",
      description: "Official National Bank of Ukraine rate for one currency: how many UAH per 1 unit.",
      inputSchema: getRateInput,
      annotations,
    },
    (args) => runTool(getRate, client, args),
  );
  server.registerTool(
    "list_rates",
    {
      title: "List NBU rates",
      description: "All official NBU exchange rates (UAH per 1 unit) for a date, sorted by currency code.",
      inputSchema: listRatesInput,
      annotations,
    },
    (args) => runTool(listRates, client, args),
  );
  server.registerTool(
    "convert",
    {
      title: "Convert currency",
      description:
        "Convert an amount between two currencies (UAH allowed) using official NBU rates, crossing via UAH.",
      inputSchema: convertInput,
      annotations,
    },
    (args) => runTool(convert, client, args),
  );
}
