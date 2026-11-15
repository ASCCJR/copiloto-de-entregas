import assert from "node:assert/strict";
import test from "node:test";
import {
  BudgetUnavailable, MAX_REQUEST_COST, MONTHLY_CHAT_BUDGET, monthlyBudgetKey, reserveChatBudget,
} from "../lib/budget.ts";

function memoryStore() {
  const entries = new Map();
  let version = 0;
  return {
    async read(key) { return structuredClone(entries.get(key) ?? null); },
    async write(key, ledger, etag) {
      if (etag !== entries.get(key)?.etag) return false;
      entries.set(key, { ledger: structuredClone(ledger), etag: String(++version) });
      return true;
    },
  };
}

const month = monthlyBudgetKey("production", new Date("2026-11-15T14:00:00Z"));

test("allows only one concurrent request with one reservation left", async () => {
  const store = memoryStore();
  await store.write(month, { reservedAndUsed: MONTHLY_CHAT_BUDGET - MAX_REQUEST_COST, pending: [] });
  const attempts = await Promise.all(Array.from({ length: 5 }, () => reserveChatBudget(store, month)));
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal((await store.read(month)).ledger.reservedAndUsed, MONTHLY_CHAT_BUDGET);
  assert.equal(await reserveChatBudget(store, month), null);
});

test("settles measured usage only once and keeps an unknown charge reserved", async () => {
  const store = memoryStore();
  const settle = await reserveChatBudget(store, month);
  const usage = { input_tokens: 20, output_tokens: 30 };
  await Promise.all([settle(usage), settle(usage)]);
  const unknown = await reserveChatBudget(store, month);
  await unknown(undefined);
  const { ledger } = await store.read(month);
  assert.equal(ledger.reservedAndUsed, MAX_REQUEST_COST + 150_000);
  assert.equal(ledger.pending.length, 1);
});

test("resets for the new UTC month without clearing another environment", async () => {
  const store = memoryStore();
  const end = new Date("2026-11-30T23:59:59Z");
  const rollover = new Date("2026-12-01T00:00:00Z");
  await store.write(monthlyBudgetKey("production", end), { reservedAndUsed: MONTHLY_CHAT_BUDGET, pending: [] });
  assert.equal(await reserveChatBudget(store, monthlyBudgetKey("production", end)), null);
  assert.ok(await reserveChatBudget(store, monthlyBudgetKey("production", rollover)));
  assert.ok(await reserveChatBudget(store, monthlyBudgetKey("preview", end)));
});

test("does not authorize calls if storage fails or the counter is corrupt", async () => {
  const store = memoryStore();
  await store.write(month, { reservedAndUsed: -1, pending: [] });
  await assert.rejects(reserveChatBudget(store, month), BudgetUnavailable);
  await assert.rejects(reserveChatBudget({ ...store, read: async () => { throw Error("offline"); } }, month), BudgetUnavailable);
});
