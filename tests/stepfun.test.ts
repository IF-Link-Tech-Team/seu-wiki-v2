import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { z } from "zod";
import { closeDb, sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { modelFor } from "@aihot/backend/editorial/models";

const requests: Array<{ url: string; authorization: string | undefined; body: Record<string, unknown> }> = [];
const provider = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push({ url: req.url!, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({
    id: `step-stub-${requests.length}`, choices: [{ message: { reasoning: "internal reasoning", content: '{"ok":true}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const port = (provider.address() as { port: number }).port;
Object.assign(process.env, {
  STEPFUN_BASE_URL: `http://127.0.0.1:${port}/step_plan/v1`, STEPFUN_API_KEY: "step-test-key", MODEL_CALLS_ENABLED: "true",
  LLM_BASE_URL: `http://127.0.0.1:${port}/legacy`, LLM_API_KEY: "legacy-test-key", LLM_MODEL: "MiniMax-M3.1-Flash-Preview",
});
const ask = (model: string, subject = `stepfun-${tag()}`) => chatJson({
  model, subject, purpose: "invariant_test", promptVersion: "stepfun-test-v1", system: "Return JSON", user: subject,
  maxTokens: 1024, schema: z.object({ ok: z.boolean() }),
});
after(async () => {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDb();
});

test("StepFun migrations retain a circuit breaker", async () => {
  const [budget] = await sql<{ per_minute: number; per_hour: number; per_day: number }[]>`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'stepfun'`;
  assert.ok(budget, "StepFun must never start without a seeded budget");
  assert.ok(budget.per_minute > 0 && budget.per_hour > 0 && budget.per_day > 0);
});

test("task overrides send the selected StepFun model and preserve its paid receipt", async () => {
  const cases = [
    { capability: "prefilter" as const, env: "PREFILTER_MODEL", model: "step-3.5-flash-2603", effort: "low", budget: 9216 },
    { capability: "score" as const, env: "SCORE_MODEL", model: "step-3.7-flash", effort: "low", budget: 17408 },
    { capability: "groupReview" as const, env: "GROUP_REVIEW_MODEL", model: "step-5-preview", effort: "medium", budget: 33792 },
  ];
  for (const c of cases) {
    process.env[c.env] = c.model;
    const selected = await modelFor(c.capability);
    assert.equal(selected, c.model, "a registered task override must not silently fall back to the default");
    const subject = `stepfun-${tag()}`;
    const before = requests.length;
    const result = await ask(selected, subject);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(requests.length, before + 1);
    const request = requests.at(-1)!;
    assert.equal(request.url, "/step_plan/v1/chat/completions");
    assert.equal(request.authorization, "Bearer step-test-key", "the legacy MiniMax key must not be used");
    assert.equal(request.body.model, c.model);
    assert.equal(request.body.reasoning_effort, c.effort);
    assert.equal(request.body.max_tokens, c.budget, "the provider needs output tokens in addition to its reasoning budget");
    assert.deepEqual(request.body.response_format, { type: "json_object" });
    const [receipt] = await sql<{ service: string; model: string; request: { maxTokens: number }; usage: { total_tokens: number } }[]>`
      SELECT service, model, request, usage FROM receipts WHERE id = ${result.receiptId}`;
    assert.equal(receipt!.service, "stepfun");
    assert.equal(receipt!.model, c.model);
    assert.equal(receipt!.request.maxTokens, c.budget, "the receipt must record the budget actually sent");
    assert.equal(receipt!.usage.total_tokens, 15);
    assert.equal((await ask(selected, subject)).reused, true);
    assert.equal(requests.length, before + 1, "recovery must not buy the same response again");
  }
});

test("StepFun's stopped budget prevents sending any request", async () => {
  const [saved] = await sql<{ per_minute: number }[]>`SELECT per_minute FROM budgets WHERE service = 'stepfun'`;
  assert.ok(saved);
  await sql`UPDATE budgets SET per_minute = 0 WHERE service = 'stepfun'`;
  try {
    const before = requests.length;
    await assert.rejects(ask("step-3.5-flash-2603"), BudgetExceededError);
    assert.equal(requests.length, before);
  } finally {
    await sql`UPDATE budgets SET per_minute = ${saved.per_minute} WHERE service = 'stepfun'`;
  }
});

test("the legacy MiniMax preset still uses its own endpoint and reasoning allowance", async () => {
  await ask("minimax-m27");
  const request = requests.at(-1)!;
  assert.equal(request.url, "/legacy/chat/completions");
  assert.equal(request.authorization, "Bearer legacy-test-key");
  assert.equal(request.body.model, "MiniMax-M2.7");
  assert.equal(request.body.max_tokens, 33792);
});
