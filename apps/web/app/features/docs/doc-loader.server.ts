// 手册/经验长文页共用的 loader：slug 与旧站一致；找不到时查 doc_redirects（"已迁移"兼容页等）301。
import { redirect } from "react-router";
import type { DocDetail, SurvivalPartView } from "@aihot/contracts/site";
import { ApiError, apiGet } from "../../lib/api.server";

export async function docLoader(request: Request, kind: "survival" | "experience", rest: string) {
  const slug = `${kind}/${rest.replace(/\/+$/, "")}`.slice(0, 300);
  try {
    const doc = await apiGet<DocDetail>(`/api/site/docs/${slug.split("/").map(encodeURIComponent).join("/")}`, { signal: request.signal });
    const parts = kind === "survival" ? (await apiGet<{ parts: SurvivalPartView[] }>("/api/site/docs/survival", { signal: request.signal })).parts : undefined;
    return { doc, parts };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      const found = await apiGet<{ target: string }>(`/api/site/doc-redirect?path=${encodeURIComponent(`/${slug}/`)}`, { signal: request.signal }).catch(() => null);
      if (found) throw redirect(found.target, 301);
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}
