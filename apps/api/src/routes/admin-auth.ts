// /api/admin 的守卫与登录页跳转。后台登录走 IF.Link 统一账户（/api/logto/sign-in，
// 见 routes/member.ts），这里只剩：登录页跳转、选项查询、退出、代理探活。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "@aihot/backend/config";
import { cookie, endSession, safeReturn, SESSION_COOKIE, sessionPrincipal, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { memberAuthConfig } from "@aihot/backend/member/config";
import { orgSessionPrincipal } from "@aihot/backend/org/auth";
import { sendProblem } from "../http/respond.ts";

/** Cookies are Secure whenever the site is served over HTTPS. */
const secure = () => config.siteUrl.startsWith("https://");

const loginPage = (returnTo: string, error?: string) => `/admin/login?${new URLSearchParams({ return: safeReturn(returnTo), ...(error ? { error } : {}) })}`;

export type AdminHandler = (req: FastifyRequest, reply: FastifyReply, admin: AdminPrincipal) => Promise<unknown>;

/** Guard for /api/admin/*: a live session (or the development stand-in); writes need the CSRF token. */
export function adminHandler(fn: AdminHandler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const admin = await sessionPrincipal(req.headers.cookie);
    if (!admin) {
      // 组织会话在后台接口上明确拒绝（403），而不是当作未登录：权限隔离要可见、可测。
      const org = await orgSessionPrincipal(req.headers.cookie);
      if (org) return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "组织账户没有后台权限。" });
      return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "Sign in to the admin first." });
    }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-csrf-token"] !== admin.csrf) {
      return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "Missing or stale CSRF token." });
    }
    try {
      return await fn(req, reply, admin);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 400 || error instanceof SyntaxError) {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: String((error as Error).message).slice(0, 300) });
      }
      if ((error as { code?: string }).code === "conflict") return sendProblem(req, reply, { status: 409, code: "conflict", detail: (error as Error).message });
      req.log.error({ err: error, path: req.url.split("?")[0] }, "admin api error");
      return sendProblem(req, reply, { status: 500, code: "internal_error", detail: String((error as Error).message).slice(0, 300) });
    }
  };
}

export function registerAdminAuth(app: FastifyInstance) {
  // The sign-in form posts as a plain HTML form.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  // The web admin sends a signed-out visitor here with ?return=; the sign-in page lives in the web app.
  app.get("/api/auth/login", async (req, reply) => {
    const returnTo = String((req.query as Record<string, string>).return ?? "/admin");
    return reply.header("Cache-Control", "no-store").redirect(loginPage(returnTo), 302);
  });

  // 登录页据此决定显示 IF.Link 登录按钮还是"账号功能未启用"。
  app.get("/api/auth/options", async (_req, reply) => reply.header("Cache-Control", "no-store").send({ memberAuth: memberAuthConfig() !== null }));

  // For a reverse proxy that guards /admin itself (auth_request): 204 with a live session, else 401.
  // Only the session cookie counts here, never the development stand-in.
  app.get("/api/auth/check", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const admin = await sessionPrincipal(req.headers.cookie);
    return reply.code(admin && !admin.dev ? 204 : 401).send();
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await endSession(req.headers.cookie);
    reply.header("Set-Cookie", cookie(SESSION_COOKIE, "", 0, secure())).header("Cache-Control", "no-store");
    return reply.redirect("/", 303);
  });

  app.get("/api/admin/me", adminHandler(async (_req, _reply, admin) => ({ name: admin.name, csrf: admin.csrf, dev: admin.dev })));
}
