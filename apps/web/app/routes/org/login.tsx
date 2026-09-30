// 组织登录：管理员在后台创建组织/成员时发下的令牌。表单直发 API（设置 cookie 后跳回 /org）。
import { SITE } from "@aihot/industry/site";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { RingMark } from "../../components/Logo";

export const meta: Route.MetaFunction = () => [{ title: `组织登录 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store" });

export default function OrgLogin() {
  const error = useSearchParams()[0].get("error");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <RingMark className="mx-auto mb-3 size-9 text-accent" />
          <h1 className="text-[20px] font-semibold text-ink">{SITE.name} 组织门户</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">社团与学生组织在这里发布活动和比赛信息，审核通过后进入统一信息流。</p>
        </div>
        <form method="post" action="/api/org/login" className="rounded-panel bg-surface p-5 ring-1 ring-line">
          <label className="block text-[12.5px] font-medium text-ink-3" htmlFor="token">组织令牌</label>
          <input
            id="token"
            name="token"
            type="password"
            required
            autoComplete="off"
            placeholder="suo_…"
            className="mt-1.5 h-10 w-full rounded-control border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-accent"
          />
          {error === "wrong" && <p className="mt-2 text-[12.5px] text-hot">令牌不对，请核对后重试。</p>}
          {error === "too-many" && <p className="mt-2 text-[12.5px] text-hot">尝试太频繁了，请 15 分钟后再试。</p>}
          <button type="submit" className="mt-4 h-10 w-full rounded-control bg-accent text-[14px] font-medium text-accent-contrast hover:bg-accent-ink">
            登录
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-4">令牌由平台管理员在组织入驻时签发；还没有令牌请联系平台。</p>
        </form>
      </div>
    </div>
  );
}
