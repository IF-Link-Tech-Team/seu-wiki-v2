// Dajiala API responses are persisted in paid receipts before business parsing.
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import type { MediaItem } from "../content/materials.ts";
import { paidRequest, ProviderRejectedError, rejectReceivedResponse, type CallOutcome } from "./receipts.ts";

export const MP_RESPONSE_VERSION = "history-by-ghid-detail-mode2-v1";
export interface MpPost {
  position: number; url: string; title: string; post_time: number;
  digest?: string; sn?: string; cover_url?: string; original?: number; item_show_type?: number;
}
export interface MpHistory {
  posts: MpPost[]; nickname: string | null; ghid: string | null; remainMoney: number | null;
  receiptId: number; reused: boolean;
}
export interface MpArticle {
  title: string; content: string; contentHtml: string | null; images: MediaItem[]; coverUrl: string | null;
  nickname: string | null; ghid: string | null; biz: string | null;
  author: string | null; desc: string | null; pubtime: string | null; receiptId: number;
}
type Json = Record<string, any>;
function base() {
  const key = credential("collectors", "DAJIALA_KEY");
  if (!key) throw new Error("DAJIALA_KEY is not configured");
  return { url: (credential("collectors", "DAJIALA_BASE_URL") ?? "https://www.dajiala.com").replace(/\/$/, ""),
    key, verifycode: credential("collectors", "DAJIALA_VERIFYCODE") ?? "" };
}
function assertSuccess(json: Json, label: string): void {
  if (!((typeof json.code === "number" && Number.isFinite(json.code)) ||
        (typeof json.code === "string" && /^-?\d+$/.test(json.code.trim()))))
    throw new ProviderRejectedError(`dajiala ${label}: invalid status`, null, false);
  const code = Number(json.code);
  if (code === -1) throw new ProviderRejectedError(`dajiala ${label}: rate limited`, 429, true);
  if (code !== 0) throw new ProviderRejectedError(`dajiala ${label} code ${code}`, code, false);
}
function costOf(json: Json): CallOutcome["cost"] {
  const amount = json.cost_money ?? json.cost;
  return typeof amount === "number" && Number.isFinite(amount)
    ? { amount, currency: "CNY", basis: "actual" } : null;
}
function assertAccount(actual: unknown, expected?: string): void {
  if (expected && String(actual ?? "").trim() !== expected.trim())
    throw new ProviderRejectedError("dajiala account mismatch", null, false);
}
function postTime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}+08:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
function withoutSecrets(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    // A verification code can be a single digit: replacing it throughout article text would corrupt content.
    const key = secrets[0];
    return (key && key.length >= 8 ? value.replaceAll(key, "[redacted]") : value)
      .replace(/([?&](?:key|verifycode)=)[^&#\s]+/gi, "$1[redacted]");
  }
  if (Array.isArray(value)) return value.map((v) => withoutSecrets(v, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, /^(key|verifycode)$/i.test(k) ? "[redacted]" : withoutSecrets(v, secrets)]));
  return value;
}
export function parseMpHistory(json: Json, expectedNickname?: string): Omit<MpHistory, "receiptId" | "reused"> {
  assertSuccess(json, "history_by_ghid");
  assertAccount(json.AccountInfo?.NickName, expectedNickname);
  if (!Array.isArray(json.MsgList?.Msg)) throw new ProviderRejectedError("dajiala history: invalid article list", null, false);
  const posts: MpPost[] = [];
  for (const message of json.MsgList.Msg) {
    for (const p of message.AppMsg?.DetailInfo ?? []) {
      if (!p.ContentUrl || !p.Title) continue;
      posts.push({ position: Number(p.ItemIndex ?? 1), url: String(p.ContentUrl), title: String(p.Title),
        post_time: postTime(p.send_time) || postTime(p.PublishTime) || postTime(message.BaseInfo?.DateTime),
        digest: p.Digest, sn: p.Sn, cover_url: p.CoverImgUrl, original: p.IsOriginal, item_show_type: p.ItemShowType });
    }
  }
  return { posts, nickname: json.AccountInfo?.NickName ?? null, ghid: json.AccountInfo?.UserName ?? null,
    remainMoney: typeof json.remain_money === "number" ? json.remain_money : null };
}
export function parseMpArticle(json: Json, expectedNickname?: string): Omit<MpArticle, "receiptId"> {
  assertSuccess(json, "article_detail");
  assertAccount(json.nick_name, expectedNickname);
  const pictures = Array.isArray(json.picture_page_info_list) ? json.picture_page_info_list : [];
  const images: MediaItem[] = pictures.filter((p: Json) => typeof p?.cdn_url === "string")
    .map((p: Json) => ({ kind: "image", url: p.cdn_url, width: typeof p.width === "number" ? p.width : null,
      height: typeof p.height === "number" ? p.height : null }));
  return { title: json.title ?? "", content: typeof json.content === "string" ? json.content : "",
    contentHtml: typeof json.content_multi_text === "string" && json.content_multi_text.trim() ? json.content_multi_text : null,
    images, coverUrl: json.cdn_url || json.cdn_url_1_1 || null, nickname: json.nick_name || null,
    ghid: json.user_name || null, biz: json.biz || null, author: json.author || null, desc: json.desc || null,
    pubtime: json.pubtime ?? null };
}
/** Never persist a network error URL containing a key. */
async function request(url: string, key: string, verifycode: string, opts: Parameters<typeof guardedFetch>[1]): Promise<Json> {
  try {
    const res = await guardedFetch(url, { ...opts, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, maxRedirects: 0, route: "direct" });
    if (res.status === 429 || res.status >= 500) throw new ProviderRejectedError(`dajiala HTTP ${res.status}`, res.status, true);
    if (res.status < 200 || res.status >= 300) throw new ProviderRejectedError(`dajiala HTTP ${res.status}`, res.status, false);
    return withoutSecrets(JSON.parse(res.text()), [key, verifycode]) as Json;
  } catch (error) {
    if (error instanceof ProviderRejectedError) throw error;
    throw new Error("dajiala request outcome unknown");
  }
}
export async function mpHistory(ghid: string, opts: { subject: string; window: string; url?: string; nickname?: string }): Promise<MpHistory> {
  const account = ghid.trim() ? { ghid: ghid.trim(), url: "", nickname: "" }
    : opts.url ? { ghid: "", url: opts.url, nickname: "" } : { ghid: "", url: "", nickname: opts.nickname ?? "" };
  if (!account.ghid && !account.url && !account.nickname) throw new Error("dajiala account is not configured");
  const { url, key, verifycode } = base();
  const receipt = await paidRequest({ service: "dajiala", purpose: "mp_history", subject: opts.subject,
    identity: { version: MP_RESPONSE_VERSION, account, window: opts.window }, requestSummary: account }, async () => {
    const json = await request(`${url}/fbmain/monitor/v3/history_by_ghid`, key, verifycode, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ...account, offset: "", key, verifycode }),
    });
    return { response: json, cost: costOf(json) };
  });
  const json = receipt.response as Json;
  if (Number(json.code) === -1) await rejectReceivedResponse(receipt.receiptId, "dajiala rate limited");
  return { ...parseMpHistory(json, opts.nickname), receiptId: receipt.receiptId, reused: receipt.reused };
}
export async function mpArticle(articleUrl: string, opts: { subject: string; identity: string; nickname?: string }): Promise<MpArticle> {
  const { url, key, verifycode } = base();
  const receipt = await paidRequest({ service: "dajiala", purpose: "mp_article", subject: opts.subject,
    identity: { version: MP_RESPONSE_VERSION, article: opts.identity }, requestSummary: { url: articleUrl, mode: 2 } }, async () => {
    const json = await request(`${url}/fbmain/monitor/v3/article_detail?${new URLSearchParams({ url: articleUrl, key, mode: "2", verifycode })}`,
      key, verifycode, { headers: { accept: "application/json" } });
    return { response: json, cost: costOf(json), usage: { chars: String(json.content ?? "").length } };
  });
  const json = receipt.response as Json;
  if (Number(json.code) === -1) await rejectReceivedResponse(receipt.receiptId, "dajiala rate limited");
  return { ...parseMpArticle(json, opts.nickname), receiptId: receipt.receiptId };
}
