// /api/logto/* 与 /api/member/*: IF.Link 统一账户接入（Logto OIDC + Accounts UUID）。
// 合同按 iflink-community-auth：return cookie 一次性、固定完成地址、精确 Origin、认证响应
// private, no-store + Vary: Cookie。未配置时全部 503 JSON；匿名浏览是主路径。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AUTH_PRIVATE_NO_STORE_HEADERS, AUTH_RETURN_COOKIE_MAX_AGE, authorizationFromClaims, buildAccountsBootstrapCompleteUrl,
  parseAuthReturnCookieValue, requestOriginMatches, serializeAuthReturnCookieValue,
} from "iflink-community-auth";
import { cookie, createAdminSessionForIdentity, endSession, parseCookies, SESSION_COOKIE as ADMIN_SESSION_COOKIE, SESSION_DAYS as ADMIN_SESSION_DAYS } from "@aihot/backend/admin/auth";
import { forwardRevocation, resolveAccountsUuid } from "@aihot/backend/member/accounts";
import { createMemberSession, endMemberSession, MEMBER_SESSION_COOKIE, MEMBER_SESSION_DAYS, memberPrincipal, updateMemberProfile, upsertMember } from "@aihot/backend/member/auth";
import { memberAuthConfig, type MemberAuthConfig } from "@aihot/backend/member/config";
import { beginSignIn, completeSignIn, OIDC_PENDING_COOKIE, OIDC_STATE_COOKIE, OidcError, readPendingIdentity, verifyLogoutToken } from "@aihot/backend/member/oidc";
import { sendProblem } from "../http/respond.ts";

/** 合同包按 Fetch 的 Request 写（headers.get）；Fastify 的 headers 是平面对象，适配一层。 */
function originMatches(req: FastifyRequest, baseUrl: string): boolean {
  const origin = req.headers.origin;
  const headers = { get: (name: string) => (name.toLowerCase() === "origin" ? (Array.isArray(origin) ? origin[0]! : origin ?? null) : null) };
  return requestOriginMatches({ headers: headers as Headers }, baseUrl);
}

// 各站不同名（合同包默认值是 iflink_auth_return）。
const RETURN_COOKIE = "seuwiki_auth_return";

const secure = (cfg: MemberAuthConfig) => cfg.baseUrl.startsWith("https://");

function authHeaders(reply: FastifyReply) {
  for (const [k, v] of Object.entries(AUTH_PRIVATE_NO_STORE_HEADERS)) reply.header(k, v);
}

function unavailable(req: FastifyRequest, reply: FastifyReply) {
  return sendProblem(req, reply, { status: 503, code: "member_auth_unavailable", detail: "账号功能未启用", cacheControl: "no-store" });
}

export function registerMember(app: FastifyInstance) {
  // 发起登录：?redirect= 的站内相对路径消毒后写一次性 return cookie，再跳 Logto 授权。
  app.get("/api/logto/sign-in", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const cfg = memberAuthConfig();
    if (!cfg) return unavailable(req, reply);
    const redirectTo = String((req.query as Record<string, string>).redirect ?? "/");
    const { url, cookieValue } = beginSignIn(cfg);
    reply.header("Set-Cookie", [
      cookie(RETURN_COOKIE, serializeAuthReturnCookieValue(redirectTo, cfg.baseUrl), AUTH_RETURN_COOKIE_MAX_AGE, secure(cfg)),
      cookie(OIDC_STATE_COOKIE, cookieValue, AUTH_RETURN_COOKIE_MAX_AGE, secure(cfg)),
    ]);
    return reply.redirect(url, 302);
  });

  // OIDC 回调：验证完成后先存 pending 身份，再跳 Accounts 建档（固定完成地址，不传页面 URL）。
  app.get("/api/logto/sign-in-callback", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const cfg = memberAuthConfig();
    if (!cfg) return unavailable(req, reply);
    try {
      const raw = new URL(req.raw.url ?? "/", cfg.baseUrl).toString();
      const { identity, pendingCookie } = await completeSignIn(cfg, raw, parseCookies(req.headers.cookie)[OIDC_STATE_COOKIE]);
      reply.header("Set-Cookie", [
        cookie(OIDC_PENDING_COOKIE, pendingCookie, AUTH_RETURN_COOKIE_MAX_AGE, secure(cfg)),
        cookie(OIDC_STATE_COOKIE, "", 0, secure(cfg)),
      ]);
      return reply.redirect(buildAccountsBootstrapCompleteUrl(cfg.accountsUrl, `${cfg.baseUrl}/api/logto/bootstrap-complete`), 302);
    } catch (error) {
      if (error instanceof OidcError) return sendProblem(req, reply, { status: 400, code: "oidc_failed", detail: error.message, cacheControl: "no-store" });
      throw error;
    }
  });

  // 固定完成地址：Accounts 建档后回跳这里。解析 UUID → 建/更新 member → 签会话 →
  // 读并删 return cookie 302 回原页面；cookie 缺失/非法回 /。
  app.get("/api/logto/bootstrap-complete", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const cfg = memberAuthConfig();
    if (!cfg) return unavailable(req, reply);
    const cookies = parseCookies(req.headers.cookie);
    const identity = readPendingIdentity(cfg, cookies[OIDC_PENDING_COOKIE]);
    const clearCookies = [cookie(OIDC_PENDING_COOKIE, "", 0, secure(cfg)), cookie(RETURN_COOKIE, "", 0, secure(cfg))];
    reply.header("Set-Cookie", clearCookies);
    if (!identity) return reply.redirect("/", 302);
    try {
      const resolved = await resolveAccountsUuid(cfg, identity.sub);
      if (!resolved) {
        // 该端点不建用户：没建档说明 bootstrap 没成功，重新走一遍。
        return reply.redirect(buildAccountsBootstrapCompleteUrl(cfg.accountsUrl, `${cfg.baseUrl}/api/logto/bootstrap-complete`), 302);
      }
      const memberId = await upsertMember({ uuid: resolved.uuid, sub: identity.sub, email: identity.email ?? resolved.email, name: identity.name ?? resolved.name });
      const session = await createMemberSession(memberId, identity, req.headers["user-agent"]);
      const setCookies = [...clearCookies, cookie(MEMBER_SESSION_COOKIE, session, MEMBER_SESSION_DAYS * 86400, secure(cfg))];
      const target = parseAuthReturnCookieValue(cookies[RETURN_COOKIE], cfg.baseUrl) ?? "/";
      // 后台授权（决策 13.7）：roles 里的社区管理员角色在服务端判定，权限真源在 IF.Link，本站不留名单。
      const wantsAdmin = /^\/admin(\/|\?|$)/.test(target);
      const authz = authorizationFromClaims({ roles: identity.roles });
      if (wantsAdmin && !authz.isAdmin) {
        reply.header("Set-Cookie", setCookies);
        return reply.code(403).type("text/html; charset=utf-8").send(
          `<!doctype html><meta charset="utf-8"><title>没有后台权限</title><p style="font:16px system-ui;padding:40px">这个 IF.Link 账户不是社区管理员，进不了后台。<a href="/">回到首页</a></p>`,
        );
      }
      if (authz.isAdmin) {
        const admin = await createAdminSessionForIdentity({ ...identity, uuid: resolved.uuid }, req.headers["user-agent"]);
        setCookies.push(cookie(ADMIN_SESSION_COOKIE, admin.token, ADMIN_SESSION_DAYS * 86400, secure(cfg)));
      }
      reply.header("Set-Cookie", setCookies);
      return reply.redirect(target, 302);
    } catch (error) {
      req.log.error({ err: error }, "bootstrap-complete failed");
      return sendProblem(req, reply, { status: 503, code: "accounts_unavailable", detail: "账号服务暂时不可用，请重试", cacheControl: "no-store" });
    }
  });

  // back-channel logout：验 Logto 签名/issuer/audience/iat/jti/logout event，转发 Accounts。
  // 有效 204，无效 400，无效通知不写本地库。
  app.post("/api/logto/backchannel-logout", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const cfg = memberAuthConfig();
    if (!cfg) return reply.code(400).send({ error: "member auth not configured" });
    const token = String((req.body as Record<string, unknown> | null)?.logout_token ?? "");
    try {
      const payload = await verifyLogoutToken(cfg, token);
      await forwardRevocation(cfg, payload);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof OidcError) return reply.code(400).send({ error: error.message });
      req.log.error({ err: error }, "backchannel logout forward failed");
      return reply.code(400).send({ error: "forward failed" });
    }
  });

  // 退出本站（只清本站会话；Logto 中心会话的退出由 Accounts 身份中心负责）。
  app.post("/api/logto/sign-out", async (req, reply) => {
    await endMemberSession(req.headers.cookie);
    const cfg = memberAuthConfig();
    reply.header("Set-Cookie", cookie(MEMBER_SESSION_COOKIE, "", 0, cfg ? secure(cfg) : false)).header("Cache-Control", "no-store");
    return reply.redirect("/", 303);
  });

  // 登录状态：动态、禁缓存、按 Cookie 变化。
  app.get("/api/member/me", async (req, reply) => {
    authHeaders(reply);
    if (!memberAuthConfig()) return unavailable(req, reply);
    const member = await memberPrincipal(req.headers.cookie);
    if (!member) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "未登录", cacheControl: "private, no-store, max-age=0" });
    return reply.send({
      member: {
        id: member.memberId, email: member.email, name: member.name,
        profile: { college: member.college, degree: member.degree, grade: member.grade, interests: member.interests },
      },
      csrf: member.csrf,
    });
  });

  // 画像绑定（cookie 画像一键迁入）：认证 + CSRF + 精确 Origin。
  app.post("/api/member/profile", async (req, reply) => {
    authHeaders(reply);
    const cfg = memberAuthConfig();
    if (!cfg) return unavailable(req, reply);
    const member = await memberPrincipal(req.headers.cookie);
    if (!member) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "未登录", cacheControl: "private, no-store, max-age=0" });
    if (req.headers["x-csrf-token"] !== member.csrf) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "Missing or stale CSRF token." });
    if (!originMatches(req, cfg.baseUrl)) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "Origin mismatch." });
    const b = (req.body ?? {}) as Record<string, unknown>;
    await updateMemberProfile(member.memberId, {
      college: typeof b.college === "string" ? b.college.trim().slice(0, 40) || null : null,
      degree: typeof b.degree === "string" && ["本科", "硕士", "博士"].includes(b.degree) ? b.degree : null,
      grade: typeof b.grade === "string" ? b.grade.trim().slice(0, 20) || null : null,
      interests: Array.isArray(b.interests) ? (b.interests as string[]) : [],
    });
    return reply.send({ ok: true });
  });
}
