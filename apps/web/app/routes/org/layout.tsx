// 组织门户的外壳：顶栏（组织名、角色、新建投稿、退出）+ 窄栏内容。loader 鉴权，未登录去 /org/login。
import { SITE } from "@aihot/industry/site";
import { Link, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { orgGet } from "../../lib/org.server";
import { RingMark } from "../../components/Logo";
import type { OrgMe } from "../../features/org/action";

export async function loader({ request }: Route.LoaderArgs) {
  const me = await orgGet<OrgMe>(request, "/api/org/me");
  return { me };
}

export const meta: Route.MetaFunction = () => [{ title: `组织门户 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store" });

export default function OrgLayout({ loaderData }: Route.ComponentProps) {
  const { me } = loaderData;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[860px] items-center gap-3 px-4">
          <Link to="/org" className="flex items-center gap-2">
            <RingMark className="size-5 text-accent" />
            <span className="text-[14px] font-semibold text-ink">{SITE.name} 组织门户</span>
          </Link>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">{me.orgName}</span>
          <span className="text-[12px] text-ink-4">{me.role === "owner" ? "管理员" : "编辑"}{me.name ? ` · ${me.name}` : ""}</span>
          <div className="ml-auto flex items-center gap-3">
            <Link to="/" className="text-[12.5px] text-ink-4 hover:text-ink-2">回到站点</Link>
            <form method="post" action="/api/org/logout">
              <button type="submit" className="text-[12.5px] text-ink-4 hover:text-ink-2">退出</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[860px] px-4 pb-24 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
