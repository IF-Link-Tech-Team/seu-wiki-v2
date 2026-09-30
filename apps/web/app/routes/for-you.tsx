// 「为你」：画像（学院/学历/兴趣）存在 seuwiki_profile cookie 里，SSR 读 cookie 调 API。
// 个性化只做加权和标注，不剔除：未设置画像的访客看到引导卡，流仍是全部内容。
import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/for-you";
import type { ForYouProfile, ForYouResponse } from "@aihot/contracts/site";
import { isCategoryKey } from "@aihot/contracts/taxonomy";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { COLLEGES } from "@aihot/industry/colleges";
import { apiGet, loadOr404, queryString } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { FeedItem } from "../features/feed/FeedItem";
import { TimelineSlot } from "../features/feed/Timeline";
import { EmptyState } from "../components/ui/Page";
import { markRead, useReadSet } from "../lib/local-state";

const PROFILE_COOKIE = "seuwiki_profile";
const DEGREES = ["本科", "硕士", "博士"] as const;

export function parseProfileCookie(header: string | null): ForYouProfile | null {
  const raw = header?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${PROFILE_COOKIE}=`));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(decodeURIComponent(raw.slice(PROFILE_COOKIE.length + 1)), "base64").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const p = value as Record<string, unknown>;
    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 30)).slice(0, 10) : []);
    const degree = str(p.degree, 10);
    const profile: ForYouProfile = {
      college: str(p.college, 40),
      degree: degree && (DEGREES as readonly string[]).includes(degree) ? degree : null,
      grade: str(p.grade, 20),
      interests: list(p.interests),
      orgs: list(p.orgs),
    };
    return profile.college || profile.degree || profile.grade || profile.interests!.length || profile.orgs!.length ? profile : null;
  } catch {
    return null;
  }
}

interface MemberMe {
  member: { id: string; name: string | null; profile: { college: string | null; degree: string | null; grade: string | null; interests: string[] } };
  csrf: string;
}

/** 登录成员的画像存在账号里（优先于 cookie）；匿名访客的画像在 seuwiki_profile cookie。 */
async function memberProfile(request: Request): Promise<MemberMe | null> {
  try {
    const res = await fetch(`${process.env.API_BASE_URL || "http://127.0.0.1:3001"}/api/member/me`, {
      headers: { accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    });
    if (!res.ok) return null;
    return (await res.json()) as MemberMe;
  } catch {
    return null;
  }
}

const hasProfile = (p: { college?: string | null; degree?: string | null; grade?: string | null; interests?: string[] } | null) =>
  !!p && !!(p.college || p.degree || p.grade || p.interests?.length);

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const member = await memberProfile(request);
  const memberP = member?.member.profile ?? null;
  const cookieProfile = parseProfileCookie(request.headers.get("cookie"));
  const profile = hasProfile(memberP) ? memberP : cookieProfile;
  const categoryParam = url.searchParams.get("category");
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const data = await loadOr404<ForYouResponse>(
    `/api/site/for-you${queryString({
      college: profile?.college,
      degree: profile?.degree,
      grade: profile?.grade,
      interests: profile?.interests?.length ? profile.interests.join(",") : null,
      orgs: profile && "orgs" in profile && profile.orgs?.length ? profile.orgs.join(",") : null,
      category,
      cursor: url.searchParams.get("cursor"),
    })}`,
    { signal: request.signal },
  );
  // migratable：cookie 里有画像而账号里没有（或不同），登录后可以一键迁入。
  const migratable = !!member && !!cookieProfile && JSON.stringify(cookieProfile) !== JSON.stringify(memberP ? { college: memberP.college, degree: memberP.degree, grade: memberP.grade, interests: memberP.interests, orgs: [] } : null);
  // 兴趣词表从运行时词表（DB）读；接口失败时用种子兜底。
  const topics = await apiGet<{ topics: string[] }>("/api/site/taxonomy", { signal: request.signal }).then((r) => r.topics).catch(() => [...TOPIC_TAGS]);
  return { data, profile, topics, member: member ? { name: member.member.name, hasProfile: hasProfile(memberP), csrf: member.csrf } : null, migratable };
}

export function meta() {
  return pageMeta({ title: "为你", description: "选选你关心的学院、学历和兴趣，相关的内容会给你放前面，并标出为什么。", path: "/for-you", noindex: true });
}

export function headers() {
  return { "Cache-Control": "private, no-store", Vary: "Cookie" };
}

function saveProfile(profile: ForYouProfile | null) {
  const empty = !profile || (!profile.college && !profile.degree && !profile.grade && !profile.interests?.length && !profile.orgs?.length);
  if (empty) {
    document.cookie = `${PROFILE_COOKIE}=; Path=/; Max-Age=0`;
    return;
  }
  const json = JSON.stringify(profile);
  const value = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  document.cookie = `${PROFILE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function ProfileBar({ profile, memberCsrf, topics }: { profile: ForYouProfile | null; memberCsrf?: string; topics: string[] }) {
  const revalidator = useRevalidator();
  const update = (patch: Partial<ForYouProfile>) => {
    const next = { college: null, degree: null, grade: null, ...profile, ...patch };
    if (memberCsrf) {
      // 登录成员：画像写账号；cookie 同步清掉，避免两处画像漂移。
      saveProfile(null);
      void fetch("/api/member/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": memberCsrf },
        body: JSON.stringify({ college: next.college, degree: next.degree, grade: next.grade, interests: next.interests ?? [] }),
      }).finally(() => revalidator.revalidate());
      return;
    }
    saveProfile(next);
    revalidator.revalidate();
  };
  const selectClass = "h-9 rounded-full border border-line-soft bg-surface px-3 text-[13px] text-ink-2 outline-none focus:border-accent";
  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="学院" className={selectClass} value={profile?.college ?? ""} onChange={(e) => update({ college: e.target.value || null })}>
          <option value="">学院（不限）</option>
          {COLLEGES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select aria-label="学历" className={selectClass} value={profile?.degree ?? ""} onChange={(e) => update({ degree: e.target.value || null })}>
          <option value="">学历（不限）</option>
          {DEGREES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {profile && (
          <button type="button" onClick={() => { saveProfile(null); revalidator.revalidate(); }} className="text-[12.5px] text-ink-4 hover:text-accent">
            清空
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {topics.map((t) => {
          const active = !!profile?.interests?.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const interests = active ? (profile?.interests ?? []).filter((x) => x !== t) : [...(profile?.interests ?? []), t];
                update({ interests });
              }}
              className={active ? "chip border-accent/50 bg-accent-soft text-accent" : "chip hover:text-accent"}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 登录后把 cookie 画像一键迁入账号（迁入后清 cookie，之后画像跟着账号走）。 */
function MigrateProfile({ csrf, profile }: { csrf: string; profile: ForYouProfile }) {
  const revalidator = useRevalidator();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const migrate = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/member/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ college: profile.college, degree: profile.degree, grade: profile.grade, interests: profile.interests ?? [] }),
      });
      if (!res.ok) throw new Error();
      saveProfile(null); // 清 cookie，画像已在账号上
      setState("done");
      revalidator.revalidate();
    } catch {
      setState("error");
    }
  };
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 border border-accent/40 p-4 text-[13px] text-ink-2">
      <span>已登录。把当前画像保存到账号，换设备也生效。</span>
      <button type="button" disabled={state === "busy" || state === "done"} onClick={migrate} className="chip border-accent/50 text-accent hover:bg-accent-soft">
        {state === "busy" ? "保存中…" : state === "done" ? "已保存到账号" : "保存到账号"}
      </button>
      {state === "error" && <span className="text-hot">保存失败，请重试</span>}
    </div>
  );
}

export default function ForYouPage() {
  const { data, profile, topics, member, migratable } = useLoaderData<typeof loader>();
  const readSet = useReadSet();
  return (
    <div className="pb-6">
      <h1 className="pt-5 text-[22px] font-bold text-ink lg:pt-0 lg:text-[24px] lg:font-semibold">为你</h1>
      <div className="mt-4">
        <ProfileBar profile={profile} memberCsrf={member?.csrf} topics={topics} />
      </div>

      {migratable && member && profile && <MigrateProfile csrf={member.csrf} profile={profile} />}

      {!profile && (
        <div className="card mb-4 border border-line-soft p-4 text-[13.5px] leading-relaxed text-ink-3">
          选选你关心的学院、学历和兴趣，相关的会给你放前面，并在卡片上标出为什么；没选也不影响，下面还是全部内容。
        </div>
      )}

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState title="暂时没有内容">稍后再来看看。</EmptyState>
        </div>
      ) : (
        <ol>
          {data.items.map((it) => (
            <TimelineSlot key={it.id} at={it.timelineAt}>
              <FeedItem item={it} matchReasons={it.matchReasons} showTags read={readSet.has(it.id)} onOpen={markRead} />
            </TimelineSlot>
          ))}
        </ol>
      )}
      {data.nextCursor && (
        <div className="mt-6 text-center">
          <a href={`/for-you?cursor=${encodeURIComponent(data.nextCursor)}`} className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13px] text-ink-3 hover:border-ink-4 hover:text-ink">
            加载更多
          </a>
        </div>
      )}
    </div>
  );
}
