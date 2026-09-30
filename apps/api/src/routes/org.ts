// /api/org/*: 组织侧接口。守卫只认 org_sessions（seuwiki_org cookie），与 admin 会话互不相通；
// 写操作带 CSRF token。登录限流与 admin 口令同一规格。
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "@aihot/backend/config";
import { cookie } from "@aihot/backend/admin/auth";
import {
  endOrgSession, ORG_SESSION_COOKIE, ORG_SESSION_DAYS, orgLogin, orgSessionPrincipal, type OrgPrincipal,
} from "@aihot/backend/org/auth";
import { createPost, getMyPost, listMyPosts, OrgError, requestChange, retractChange, updatePost, uploadPoster } from "@aihot/backend/org/posts";
import { draftOrgPost } from "@aihot/backend/org/draft";
import { sendProblem } from "../http/respond.ts";

export type OrgHandler = (req: FastifyRequest, reply: FastifyReply, org: OrgPrincipal) => Promise<unknown>;

/** Guard for /api/org/*: a live org session; writes need the session's CSRF token. */
export function orgHandler(fn: OrgHandler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const org = await orgSessionPrincipal(req.headers.cookie);
    if (!org) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "请先登录组织账户。" });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-csrf-token"] !== org.csrf) {
      return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "Missing or stale CSRF token." });
    }
    try {
      return await fn(req, reply, org);
    } catch (error) {
      if (error instanceof OrgError) return sendProblem(req, reply, { status: error.status, code: "invalid_request", detail: error.message });
      req.log.error({ err: error, path: req.url.split("?")[0] }, "org api error");
      return sendProblem(req, reply, { status: 500, code: "internal_error", detail: "服务器开小差了，请稍后再试" });
    }
  };
}

const attempts = new Map<string, number[]>();
function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > 10;
}

const secure = () => config.siteUrl.startsWith("https://");

function decodeImage(dataUrl: unknown): Buffer {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(String(dataUrl ?? ""));
  if (!m) throw new OrgError(400, "图片需要是 PNG、JPEG 或 WebP");
  return Buffer.from(m[2]!, "base64");
}

export function registerOrg(app: FastifyInstance) {
  // 登录是 HTML 表单直发（application/x-www-form-urlencoded 解析器在 admin-auth 注册，app 级生效）。
  app.post("/api/org/login", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (tooManyAttempts(String(req.ip))) return reply.redirect("/org/login?error=too-many", 303);
    const b = (req.body ?? {}) as Record<string, string>;
    const result = await orgLogin(String(b.token ?? "").trim(), req.headers["user-agent"]);
    if (!result) return reply.redirect("/org/login?error=wrong", 303);
    reply.header("Set-Cookie", cookie(ORG_SESSION_COOKIE, result.session, ORG_SESSION_DAYS * 86400, secure()));
    return reply.redirect("/org", 303);
  });

  app.post("/api/org/logout", async (req, reply) => {
    await endOrgSession(req.headers.cookie);
    reply.header("Set-Cookie", cookie(ORG_SESSION_COOKIE, "", 0, secure())).header("Cache-Control", "no-store");
    return reply.redirect("/", 303);
  });

  app.get("/api/org/me", orgHandler(async (_req, _reply, org) => ({ orgName: org.orgName, name: org.name, role: org.role, csrf: org.csrf })));

  app.get("/api/org/posts", orgHandler(async (_req, _reply, org) => ({ items: await listMyPosts(org) })));
  app.get("/api/org/posts/:id", orgHandler(async (req, _reply, org) => getMyPost(org, Number((req.params as { id: string }).id))));
  app.post("/api/org/posts", orgHandler(async (req, _reply, org) => createPost(org, (req.body ?? {}) as Record<string, unknown>)));
  app.patch("/api/org/posts/:id", orgHandler(async (req, _reply, org) => updatePost(org, Number((req.params as { id: string }).id), (req.body ?? {}) as Record<string, unknown>)));
  app.post("/api/org/posts/:id/change", orgHandler(async (req, _reply, org) => requestChange(org, Number((req.params as { id: string }).id), (req.body ?? {}) as Record<string, unknown>)));
  app.post("/api/org/posts/:id/change/retract", orgHandler(async (req, _reply, org) => retractChange(org, Number((req.params as { id: string }).id))));

  app.post("/api/org/poster", orgHandler(async (req) => uploadPoster(decodeImage((req.body as Record<string, unknown> | null)?.image))));

  // AI 辅助填表：不可用时返回 200 + kind:"unavailable"，前端降级为纯手填。
  app.post("/api/org/draft", orgHandler(async (req, _reply, org) => draftOrgPost(org, (req.body ?? {}) as { text?: string; url?: string })));

  // 海报的公开读取：内容哈希命名，永久缓存。
  app.get("/api/org/poster/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^org-poster-[0-9a-f]{16}\.(png|jpg|webp)$/.test(file)) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    const data = await readFile(path.join(config.dataDir, "uploads", file)).catch(() => null);
    if (!data) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    const ext = file.split(".").pop()!;
    return reply.header("Cache-Control", "public, max-age=31536000, immutable").type(ext === "jpg" ? "image/jpeg" : `image/${ext}`).send(data);
  });
}
