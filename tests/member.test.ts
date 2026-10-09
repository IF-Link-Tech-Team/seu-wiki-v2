// IF.Link 统一账户接入：stub Logto OIDC 端点（auth/token/userinfo/jwks，jose 真签）与 Accounts
// 内部端点（by-subject、session-revocation、bootstrap），验证完整登录链、回跳消毒、fail closed、
// 撤销目录、未配置降级和画像绑定。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";
import { createHmac } from "node:crypto";

const T = tag();
const SUB = `logto-sub-${T}`;
const UUID = crypto.randomUUID();

// ── Logto + Accounts 桩（一个服务器扮两个角色；授权与 bootstrap 需要 302，所以裸写）────────
import http from "node:http";
import type { AddressInfo } from "node:net";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
const nonces = new Map<string, string>(); // state → nonce（auth 时记，token 时用）
let userinfoSub: string | null = null; // 设为别的值可测 sub 不一致
let rolesForUser: string[] = []; // 设为 ["community_admin"] 可测后台授权
let accountsReady = true;
let revokedKeys = new Set<string>(); // "sub|sid|iat"
let sidCounter = 0; // "sub|sid|iat"
const forwardedRevocations: unknown[] = [];

const raw = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/oidc/auth") {
      const state = url.searchParams.get("state")!;
      nonces.set(state, url.searchParams.get("nonce")!);
      res.writeHead(302, { location: `${url.searchParams.get("redirect_uri")}?code=code-${state}&state=${state}` });
      return res.end();
    }
    if (url.pathname === "/oidc/token" && body.includes("client_credentials")) return res.end(JSON.stringify({ access_token: "m2m-token", expires_in: 3600 }));
    if (url.pathname === "/oidc/token") {
      const state = new URLSearchParams(body).get("code")!.replace("code-", "");
      const idToken = await new SignJWT({ sid: `sid-${T}-${++sidCounter}`, nonce: nonces.get(state) })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(SUB)
        .setIssuer(`${logtoBase}/`)
        .setAudience("test-app")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return res.end(JSON.stringify({ id_token: idToken, access_token: "at" }));
    }
    if (url.pathname === "/oidc/me") return res.end(JSON.stringify({ sub: userinfoSub ?? SUB, email: `member-${T}@example.com`, name: "测试同学", roles: rolesForUser }));
    if (url.pathname === "/oidc/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === "/bootstrap") {
      res.writeHead(302, { location: url.searchParams.get("return_to")! });
      return res.end();
    }
    if (url.pathname === "/internal/v1/users/by-subject") {
      if (!accountsReady) { res.writeHead(404); return res.end("{}"); }
      if (req.headers.authorization !== "Bearer m2m-token") {
        res.writeHead(401);
        return res.end("{}");
      }
      // 与 Accounts 生产真实形状一致：{ user: { id, display_name, email, … } }
      return res.end(JSON.stringify({ user: { id: UUID, email: `member-${T}@example.com`, display_name: "测试同学" } }));
    }
    if (url.pathname === "/internal/v1/logto/session-revocation" && req.method === "GET") {
      const key = `${url.searchParams.get("subject")}|${url.searchParams.get("sid") ?? ""}|${url.searchParams.get("iat") ?? ""}`;
      return res.end(JSON.stringify({ revoked: revokedKeys.has(key) }));
    }
    if (url.pathname === "/internal/v1/logto/session-revocation") {
      forwardedRevocations.push(JSON.parse(body));
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404);
    res.end("{}");
  });
});
await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
const logtoBase = `http://127.0.0.1:${(raw.address() as AddressInfo).port}`;

const app_ = await buildApp();

const ENV = {
  LOGTO_ENDPOINT: logtoBase,
  LOGTO_APP_ID: "test-app",
  LOGTO_APP_SECRET: "test-app-secret",
  LOGTO_COOKIE_SECRET: `cookie-secret-${T}-0123456789abcdef`,
  LOGTO_BASE_URL: "http://localhost",
  ACCOUNTS_URL: logtoBase,
  ACCOUNTS_API_RESOURCE: `${logtoBase}/api`,
  ACCOUNTS_M2M_APP_ID: "m2m-app",
  ACCOUNTS_M2M_APP_SECRET: "m2m-secret",
};

before(() => {
  Object.assign(process.env, ENV);
});
after(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await sql`DELETE FROM members WHERE logto_sub = ${SUB}`;
  await sql`DELETE FROM member_oidc_pending WHERE identity->>'sub' = ${SUB}`;
  await new Promise<void>((resolve) => raw.close(() => resolve()));
  await app_.close();
  await stopBoss();
  await closeDb();
});

// ── 驱动登录链的工具 ─────────────────────────────────────────────────────────
type Jar = Map<string, string>; // value null 表示这包 Set-Cookie 把它删了
const jarOf = (setCookie: string[] | string | undefined): Map<string, string | null> => {
  const jar: Map<string, string | null> = new Map();
  for (const line of Array.isArray(setCookie) ? setCookie ?? [] : [setCookie ?? ""]) {
    const [pair] = line.split(";");
    const i = pair!.indexOf("=");
    const name = pair!.slice(0, i).trim();
    const value = pair!.slice(i + 1);
    jar.set(name, /Max-Age=0($|;)/i.test(line) || value === "" ? null : value);
  }
  return jar;
};
const merge = (a: Jar, b: Map<string, string | null>): Jar => {
  const out: Jar = new Map(a);
  for (const [k, v] of b) if (v === null) out.delete(k);
  else out.set(k, v);
  return out;
};
const cookieHeader = (jar: Jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function pendingFlow(returnPath: string): Promise<Jar> {
  const r1 = await app_.inject({ method: "GET", url: `/api/logto/sign-in?redirect=${encodeURIComponent(returnPath)}` });
  assert.equal(r1.statusCode, 302);
  let jar: Jar = new Map([...jarOf(r1.headers["set-cookie"])].filter((e): e is [string, string] => e[1] !== null));
  const authorizeUrl = r1.headers.location!;
  // 浏览器去 Logto 授权页（桩），被 302 回本站 callback。
  const auth = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = new URL(auth.headers.get("location")!);
  const r2 = await app_.inject({ method: "GET", url: `${callbackUrl.pathname}${callbackUrl.search}`, headers: { cookie: cookieHeader(jar) } });
  assert.equal(r2.statusCode, 302, "callback 302 去 Accounts bootstrap");
  assert.match(String(r2.headers["set-cookie"]), /seuwiki_oidc_pending=[^;]+;[^,]*Max-Age=300/);
  jar = merge(jar, jarOf(r2.headers["set-cookie"]));
  const bootstrapUrl = r2.headers.location!;
  assert.ok(bootstrapUrl.startsWith(`${logtoBase}/bootstrap?`), "去 Accounts 建档");
  assert.ok(decodeURIComponent(bootstrapUrl).includes("return_to=http://localhost/api/logto/bootstrap-complete"), "固定完成地址");
  return jar;
}

async function loginFlow(returnPath: string): Promise<Jar> {
  let jar = await pendingFlow(returnPath);
  // Accounts 建档后回固定完成地址。
  const r3 = await app_.inject({ method: "GET", url: "/api/logto/bootstrap-complete", headers: { cookie: cookieHeader(jar) } });
  jar = merge(jar, jarOf(r3.headers["set-cookie"]));
  return Object.assign(jar, { lastStatus: r3.statusCode, lastBody: r3.body });
}

test("pending identity is consumed once, including concurrent bootstrap requests", async () => {
  rolesForUser = ["community_admin"];
  try {
    const jar = await pendingFlow("/admin");
    const request = { method: "GET" as const, url: "/api/logto/bootstrap-complete", headers: { cookie: cookieHeader(jar) } };
    const results = await Promise.all([app_.inject(request), app_.inject(request)]);
    assert.equal(results.filter(r => jarOf(r.headers["set-cookie"]).get("seuwiki_member")).length, 1);
    assert.equal(results.filter(r => jarOf(r.headers["set-cookie"]).get("aihot_admin")).length, 1);
    const replay = await app_.inject(request);
    assert.equal(replay.headers.location, "/");
    assert.ok(!jarOf(replay.headers["set-cookie"]).get("seuwiki_member"));
    assert.ok(!jarOf(replay.headers["set-cookie"]).get("aihot_admin"));
  } finally { rolesForUser = []; }
});

test("server rejects an expired pending identity even when the browser resends the cookie", async () => {
  const jar = await pendingFlow("/");
  await sql`UPDATE member_oidc_pending SET expires_at = now() - interval '1 second' WHERE identity->>'sub' = ${SUB}`;
  const result = await app_.inject({ method: "GET", url: "/api/logto/bootstrap-complete", headers: { cookie: cookieHeader(jar) } });
  assert.equal(result.headers.location, "/");
  assert.ok(!jarOf(result.headers["set-cookie"]).get("seuwiki_member"));
});

test("unfinished Accounts bootstrap preserves pending and return cookies for retry", async () => {
  const jar = await pendingFlow("/for-you");
  accountsReady = false;
  try {
    const result = await app_.inject({ method: "GET", url: "/api/logto/bootstrap-complete", headers: { cookie: cookieHeader(jar) } });
    assert.ok(result.headers.location?.startsWith(logtoBase + "/bootstrap"));
    assert.equal(result.headers["set-cookie"], undefined);
  } finally { accountsReady = true; }
  const retried = await app_.inject({ method: "GET", url: "/api/logto/bootstrap-complete", headers: { cookie: cookieHeader(jar) } });
  assert.equal(retried.headers.location, "/for-you");
  assert.ok(jarOf(retried.headers["set-cookie"]).get("seuwiki_member"));
});

test("server rejects signed state older than ten minutes before token exchange", async () => {
  const value = JSON.stringify({ state: "stale", nonce: "nonce", issuedAt: Date.now() - 601_000 });
  const signed = value + "." + createHmac("sha256", ENV.LOGTO_COOKIE_SECRET).update(value).digest("base64url");
  const result = await app_.inject({ method: "GET", url: "/api/logto/sign-in-callback?code=unused&state=stale",
    headers: { cookie: "seuwiki_oidc_state=" + encodeURIComponent(signed) } });
  assert.equal(result.statusCode, 400);
  assert.match(result.body, /expired oidc state/);
});

test("完整登录链：sign-in → callback → bootstrap → member 落库 → 302 回原页面，return cookie 已删", async () => {
  const jar = await loginFlow("/for-you");
  assert.ok(jar.has("seuwiki_member"), "签发 member 会话");
  assert.ok(!jar.has("seuwiki_auth_return"), "return cookie 一次性删除");
  const [m] = await sql<{ id: string; email: string; display_name: string }[]>`SELECT id, email, display_name FROM members WHERE logto_sub = ${SUB}`;
  assert.equal(m!.id, UUID, "Accounts UUID 为主键");
  assert.equal(m!.display_name, "测试同学");
  const me = await app_.inject({ method: "GET", url: "/api/member/me", headers: { cookie: cookieHeader(jar) } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.headers["cache-control"], "private, no-store, max-age=0");
  assert.equal(me.headers.vary, "Cookie");
});

test("return cookie 非法/缺失时回 /", async () => {
  const jar = await loginFlow("//evil.com/x");
  // sign-in 时已被消毒成 "/"：登录完成后落回 "/"
  const me = await app_.inject({ method: "GET", url: "/api/member/me", headers: { cookie: cookieHeader(jar) } });
  assert.equal(me.statusCode, 200);
  // 直接打 bootstrap-complete：没有 pending cookie → /
  const bare = await app_.inject({ method: "GET", url: "/api/logto/bootstrap-complete", headers: { cookie: "seuwiki_auth_return=" + encodeURIComponent("https://evil.com/") } });
  assert.equal(bare.statusCode, 302);
  assert.equal(bare.headers.location, "/");
});

test("claims.sub 与 userInfo.sub 不一致 fail closed", async () => {
  userinfoSub = `other-${T}`;
  try {
    const r1 = await app_.inject({ method: "GET", url: "/api/logto/sign-in" });
    const jar: Jar = new Map([...jarOf(r1.headers["set-cookie"])].filter((e): e is [string, string] => e[1] !== null));
    const auth = await fetch(r1.headers.location!, { redirect: "manual" });
    const cb = new URL(auth.headers.get("location")!);
    const r2 = await app_.inject({ method: "GET", url: `${cb.pathname}${cb.search}`, headers: { cookie: cookieHeader(jar) } });
    assert.equal(r2.statusCode, 400, "sub 不一致拒绝建档");
    assert.match(r2.body, /sub mismatch/);
  } finally {
    userinfoSub = null;
  }
});

test("会话撤销：中心目录标记后旧会话失效（fail closed 的另一面）", async () => {
  const jar = await loginFlow("/");
  // 不在撤销前先查 /api/member/me：撤销目录的 60s 缓存是合同行为，先查会缓存"未撤销"。
  const [s] = await sql<{ sid: string; sub: string; iat: string }[]>`SELECT sid, sub, iat FROM member_sessions WHERE sub = ${SUB} ORDER BY created_at DESC LIMIT 1`;
  revokedKeys = new Set([`${s!.sub}|${s!.sid}|${s!.iat}`]);
  const me2 = await app_.inject({ method: "GET", url: "/api/member/me", headers: { cookie: cookieHeader(jar) } });
  assert.equal(me2.statusCode, 401, "撤销后会话失效");
  revokedKeys = new Set();
});

test("未配置时 /api/logto/* 与 /api/member/* 返 503 JSON，站点其余功能不受影响", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(ENV)) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    for (const path of ["/api/logto/sign-in", "/api/logto/sign-in-callback", "/api/logto/bootstrap-complete", "/api/member/me"]) {
      const res = await app_.inject({ method: "GET", url: path });
      assert.equal(res.statusCode, 503, path);
      assert.equal((res.json() as { code: string }).code, "member_auth_unavailable");
    }
    assert.equal((await app_.inject({ method: "GET", url: "/api/health" })).statusCode, 200, "匿名主路径不受影响");
    const meta = await app_.inject({ method: "GET", url: "/api/site/meta" });
    assert.equal((meta.json() as { memberAuth: boolean }).memberAuth, false, "前端据此不显示登录入口");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("画像绑定：认证 + CSRF + 精确 Origin，写入 members", async () => {
  const jar = await loginFlow("/");
  const me = await app_.inject({ method: "GET", url: "/api/member/me", headers: { cookie: cookieHeader(jar) } });
  const csrf = (me.json() as { csrf: string }).csrf;
  const badOrigin = await app_.inject({
    method: "POST", url: "/api/member/profile",
    headers: { cookie: cookieHeader(jar), "x-csrf-token": csrf, origin: "https://evil.com" },
    payload: { college: "信息科学与工程学院" },
  });
  assert.equal(badOrigin.statusCode, 403, "伪造 Origin 拒绝");
  const noCsrf = await app_.inject({ method: "POST", url: "/api/member/profile", headers: { cookie: cookieHeader(jar), origin: "http://localhost" }, payload: {} });
  assert.equal(noCsrf.statusCode, 403, "缺 CSRF 拒绝");
  const ok = await app_.inject({
    method: "POST", url: "/api/member/profile",
    headers: { cookie: cookieHeader(jar), "x-csrf-token": csrf, origin: "http://localhost" },
    payload: { college: "信息科学与工程学院", degree: "本科", interests: ["保研", "实习"] },
  });
  assert.equal(ok.statusCode, 200);
  const [m] = await sql<{ college: string; degree: string; interests: string[] }[]>`SELECT college, degree, interests FROM members WHERE id = ${UUID}`;
  assert.deepEqual([m!.college, m!.degree, m!.interests], ["信息科学与工程学院", "本科", ["保研", "实习"]]);
});

test("backchannel-logout：验签通过转发 Accounts（204），无效 token 400 且不写库", async () => {
  const logoutToken = await new SignJWT({ events: { "http://schemas.openid.net/event/backchannel-logout": {} }, sid: `sid-${T}` })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(SUB)
    .setIssuer(`${logtoBase}/`)
    .setAudience("test-app")
    .setIssuedAt()
    .setJti(`jti-${T}`)
    .sign(privateKey);
  const ok = await app_.inject({ method: "POST", url: "/api/logto/backchannel-logout", payload: { logout_token: logoutToken } });
  assert.equal(ok.statusCode, 204);
  assert.equal(forwardedRevocations.length, 1);
  assert.equal((forwardedRevocations[0] as { sub: string }).sub, SUB);
  const bad = await app_.inject({ method: "POST", url: "/api/logto/backchannel-logout", payload: { logout_token: "garbage" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(forwardedRevocations.length, 1, "无效通知不转发");
});

// ── 后台管理员：IF.Link 账户 + 社区管理员角色（决策 13.7）────────────────────

test("有社区管理员角色：签发 admin 会话进后台，审计记录具体身份", async () => {
  rolesForUser = ["community_admin"];
  try {
    const jar = await loginFlow("/admin");
    assert.ok(jar.has("aihot_admin"), "签发 admin 会话");
    const me = await app_.inject({ method: "GET", url: "/api/admin/me", headers: { cookie: cookieHeader(jar) } });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { name: string }).name, `member-${T}@example.com`, "后台身份是账户邮箱");
    // 一个真实的后台写操作，审计 actor 应该是具体管理员身份而不是 admin:<行号>
    const csrf = (me.json() as { csrf: string }).csrf;
    const created = await app_.inject({
      method: "POST", url: "/api/admin/orgs",
      headers: { cookie: cookieHeader(jar), "x-csrf-token": csrf },
      payload: { name: `审计测试社团-${T}` },
    });
    assert.equal(created.statusCode, 200);
    const [a] = await sql<{ actor: string }[]>`SELECT actor FROM audit_log WHERE action = 'org.create' ORDER BY id DESC LIMIT 1`;
    assert.equal(a!.actor, `admin:member-${T}@example.com`);
  } finally {
    rolesForUser = [];
  }
});

test("无管理员角色进后台：bootstrap-complete 403，member 会话照常", async () => {
  rolesForUser = [];
  const jar = await loginFlow("/admin");
  assert.equal((jar as Jar & { lastStatus: number }).lastStatus, 403, "回后台但没有角色 → 403");
  assert.ok(jar.has("seuwiki_member"), "member 会话不受影响");
  assert.ok(!jar.has("aihot_admin"), "不签发 admin 会话");
  const me = await app_.inject({ method: "GET", url: "/api/admin/me", headers: { cookie: cookieHeader(jar) } });
  assert.equal(me.statusCode, 401);
});

test("撤权：撤销目录命中后旧 admin 会话失效", async () => {
  rolesForUser = ["community_admin"];
  try {
    const jar = await loginFlow("/admin");
    const [s] = await sql<{ sid: string; sub: string; iat: string }[]>`SELECT sid, sub, iat FROM admin_sessions WHERE sub = ${SUB} ORDER BY created_at DESC LIMIT 1`;
    revokedKeys = new Set([`${s!.sub}|${s!.sid}|${s!.iat}`]);
    const me = await app_.inject({ method: "GET", url: "/api/admin/me", headers: { cookie: cookieHeader(jar) } });
    assert.equal(me.statusCode, 401, "撤权后旧会话失效");
    revokedKeys = new Set();
  } finally {
    rolesForUser = [];
  }
});

test("DEV_ADMIN_BYPASS 只在显式设置时放行（非生产）", async () => {
  process.env.DEV_ADMIN_BYPASS = "true";
  try {
    const me = await app_.inject({ method: "GET", url: "/api/admin/me" });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { dev: boolean }).dev, true);
  } finally {
    delete process.env.DEV_ADMIN_BYPASS;
  }
  assert.equal((await app_.inject({ method: "GET", url: "/api/admin/me" })).statusCode, 401, "没有 bypass 也没有会话时 401");
});
