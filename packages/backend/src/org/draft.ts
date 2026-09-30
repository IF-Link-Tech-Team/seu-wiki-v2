// AI 辅助填表：粘贴公众号链接或一段文字 → 模型抽出投稿表单字段的草稿，发布者逐项确认后才提交。
// AI 只辅助填表，不替组织承诺信息。模型关闭（MODEL_CALLS_ENABLED=false）、没配 Key 或预算熔断时
// 返回 kind: "unavailable"，前端降级为纯手填，不报错。
import { z } from "zod";
import { config, credential } from "../config.ts";
import { extractFromUrl } from "../content/extract.ts";
import { BudgetExceededError, ProviderRejectedError } from "../providers/receipts.ts";
import { chatJson, MODELS, ModelOutputError } from "../providers/llm.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import type { OrgPrincipal } from "./auth.ts";
import { OrgError } from "./posts.ts";

const DraftSchema = z.object({
  title: z.string().max(120).nullish().catch(null),
  eventAt: z.string().max(30).nullish().catch(null),
  location: z.string().max(120).nullish().catch(null),
  audience: z.string().max(120).nullish().catch(null),
  fee: z.string().max(60).nullish().catch(null),
  signup: z.string().max(300).nullish().catch(null),
  body: z.string().max(4000).nullish().catch(null),
});

export interface OrgDraft {
  title: string | null;
  eventAt: string | null;
  location: string | null;
  audience: string | null;
  fee: string | null;
  signup: string | null;
  body: string | null;
}

export type DraftResult = { kind: "ok"; draft: OrgDraft } | { kind: "unavailable"; reason: string };

const DRAFT_PROMPT_VERSION = promptVersion("org-draft");
const DRAFT_SYSTEM = promptText("org-draft");

const MAX_INPUT_CHARS = 8000;

/** 输入是链接就先抓正文（纯 HTTP，不走付费的 Jina 兜底）；抓不到让发布者改贴文字。 */
async function materialOf(input: { text?: string; url?: string }): Promise<string> {
  const text = (input.text ?? "").trim();
  if (text) return text.slice(0, MAX_INPUT_CHARS);
  const url = (input.url ?? "").trim();
  if (!url) throw new OrgError(400, "请粘贴链接或一段文字");
  if (!/^https?:\/\//i.test(url)) throw new OrgError(400, "链接需要以 http(s):// 开头");
  const page = await extractFromUrl(url, { allowJina: false, subject: "org-draft" });
  if (!page || page.text.trim().length < 40) throw new OrgError(400, "这个链接抓不到正文，请直接粘贴文字");
  return page.text.slice(0, MAX_INPUT_CHARS);
}

export async function draftOrgPost(org: OrgPrincipal, input: { text?: string; url?: string }): Promise<DraftResult> {
  const material = await materialOf(input);
  if (!config.modelCallsEnabled) return { kind: "unavailable", reason: "off" };
  const model = await modelFor("summarize");
  const spec = MODELS[model];
  if (!spec || !credential("models", spec.baseUrlEnv) || !credential("models", spec.apiKeyEnv)) return { kind: "unavailable", reason: "unconfigured" };
  try {
    const res = await chatJson({
      model,
      purpose: "org_draft",
      subject: `org:${org.orgId}`,
      promptVersion: DRAFT_PROMPT_VERSION,
      system: DRAFT_SYSTEM,
      user: material,
      schema: DraftSchema,
      temperature: 0.2,
      maxTokens: 2048,
      attemptTag: undefined,
    });
    const d = res.data;
    return {
      kind: "ok",
      draft: { title: d.title ?? null, eventAt: d.eventAt ?? null, location: d.location ?? null, audience: d.audience ?? null, fee: d.fee ?? null, signup: d.signup ?? null, body: d.body ?? null },
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) return { kind: "unavailable", reason: "budget" };
    if (error instanceof ModelOutputError || error instanceof ProviderRejectedError) throw new OrgError(502, "AI 这次没给出可用的草稿，请重试或手动填写");
    throw error;
  }
}
