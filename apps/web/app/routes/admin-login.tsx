// Admin sign-in: IF.Link 统一账户一个按钮（决策 13.7；密码与飞书登录已退役）。未配置时显示
// "账号功能未启用"，站点其余功能不受影响。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/admin-login";
import { SITE } from "@aihot/industry/site";
import { apiGet } from "../lib/api.server";
import { Wordmark } from "../components/Logo";
import { buttonClass } from "../components/ui/Controls";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") ?? "/admin";
  const options = await apiGet<{ memberAuth: boolean }>("/api/auth/options", { signal: request.signal }).catch(() => ({ memberAuth: false }));
  return { returnTo: returnTo.startsWith("/admin") ? returnTo : "/admin", error: url.searchParams.get("error"), ...options };
}

export const meta: Route.MetaFunction = () => [{ title: `登录 · ${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export default function AdminLogin() {
  const { returnTo, memberAuth } = useLoaderData<typeof loader>();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[360px]">
        <div className="flex items-center justify-center gap-2">
          <Wordmark size={26} className="text-ink" />
          <span className="text-[15px] font-semibold text-ink-3">后台</span>
        </div>
        <div className="card mt-8 p-6">
          {memberAuth ? (
            <>
              <p className="text-[13px] leading-relaxed text-ink-3">后台使用 IF.Link 统一账户登录，需要社区管理员角色。权限由 IF.Link 社区管理，本站不维护管理员名单。</p>
              <a href={`/api/logto/sign-in?${new URLSearchParams({ redirect: returnTo })}`} className={`${buttonClass("primary", "lg")} mt-5 w-full`}>
                使用 IF.Link 账户登录
              </a>
            </>
          ) : (
            <p role="alert" className="text-[13px] leading-relaxed text-hot">
              账号功能未启用：还没有配置 IF.Link 统一账户（.env 里的 LOGTO_* 与 ACCOUNTS_* 九项）。配置并重启后，这里会出现登录按钮。站点其余功能不受影响。
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-[12px] text-ink-4">
          <a href="/" className="hover:text-ink-2">
            回到 {SITE.name}
          </a>
        </p>
      </div>
    </div>
  );
}
