import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

// Integer nanodollars keep reservations and refunds exact across concurrent requests.
export const MONTHLY_CHAT_BUDGET = 5_000_000_000;
export const PUBLIC_CHAT_MODEL = "gpt-5.4-mini-2026-03-17";
export const MAX_CHAT_OUTPUT_TOKENS = 900;
const MAX_INPUT_TOKENS = 400_000;
const INPUT_PRICE = 750;
const OUTPUT_PRICE = 4500;
export const MAX_REQUEST_COST = MAX_INPUT_TOKENS * INPUT_PRICE + MAX_CHAT_OUTPUT_TOKENS * OUTPUT_PRICE;
const MAX_ATTEMPTS = 6;

type Usage = { input_tokens: number; output_tokens: number };
type Ledger = { reservedAndUsed: number; pending: string[] };
type Snapshot = { ledger: Ledger; etag: string };

export type BudgetStore = {
  read: (key: string) => Promise<Snapshot | null>;
  write: (key: string, ledger: Ledger, etag: string | undefined) => Promise<boolean>;
};

export class BudgetUnavailable extends Error {}

function validate(ledger: Ledger) {
  if (!ledger || !Number.isSafeInteger(ledger.reservedAndUsed) || ledger.reservedAndUsed > MONTHLY_CHAT_BUDGET
    || !Array.isArray(ledger.pending) || ledger.pending.some((id) => typeof id !== "string")
    || new Set(ledger.pending).size !== ledger.pending.length
    || ledger.reservedAndUsed < ledger.pending.length * MAX_REQUEST_COST) {
    throw new BudgetUnavailable("Invalid monthly ledger");
  }
  return ledger;
}

export function blobBudgetStore(): BudgetStore {
  return {
    async read(key) {
      const result = await get(key, { access: "private", useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.blob.etag) throw new BudgetUnavailable("Missing ledger version");
      return { ledger: await new Response(result.stream).json() as Ledger, etag: result.blob.etag };
    },
    async write(key, ledger, etag) {
      try {
        await put(key, JSON.stringify(ledger), {
          access: "private", contentType: "application/json", addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        // A concurrent first write may be reported as a generic BlobError. Only
        // an existing version justifies retrying an unsuccessful create.
        if (!etag && error instanceof BlobError && await this.read(key)) return false;
        throw error;
      }
    },
  };
}

async function updateLedger(store: BudgetStore, key: string, update: (ledger: Ledger) => Ledger | null) {
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await store.read(key);
      const next = update(current ? validate(current.ledger) : { reservedAndUsed: 0, pending: [] });
      if (!next) return false;
      if (await store.write(key, validate(next), current?.etag)) return true;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 10));
    }
  } catch (error) {
    throw new BudgetUnavailable("Monthly budget storage unavailable", { cause: error });
  }
  throw new BudgetUnavailable("Monthly budget storage is busy");
}

export function monthlyBudgetKey(scope: "production" | "preview", now = new Date()) {
  return `copiloto/monthly-budget/${scope}/${now.toISOString().slice(0, 7)}.json`;
}

export async function reserveChatBudget(store: BudgetStore, key: string) {
  const reservation = randomUUID();
  const accepted = await updateLedger(store, key, (ledger) => {
    const reservedAndUsed = ledger.reservedAndUsed + MAX_REQUEST_COST;
    if (reservedAndUsed > MONTHLY_CHAT_BUDGET) return null;
    return { reservedAndUsed, pending: [...ledger.pending, reservation] };
  });
  if (!accepted) return null;

  return async function settle(usage: Usage | null | undefined) {
    if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || usage.input_tokens > MAX_INPUT_TOKENS
      || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0 || usage.output_tokens > MAX_CHAT_OUTPUT_TOKENS) return;
    // Cached input is charged at the full input price in this ledger.
    const cost = usage.input_tokens * INPUT_PRICE + usage.output_tokens * OUTPUT_PRICE;
    await updateLedger(store, key, (ledger) => {
      if (!ledger.pending.includes(reservation)) return null;
      return {
        reservedAndUsed: ledger.reservedAndUsed - MAX_REQUEST_COST + cost,
        pending: ledger.pending.filter((id) => id !== reservation),
      };
    });
  };
}
