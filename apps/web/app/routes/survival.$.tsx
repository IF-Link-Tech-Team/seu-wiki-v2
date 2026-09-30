// 手册长文页 /survival/…。slug 与旧站一致；找不到时查 doc_redirects（"已迁移"兼容页等）301。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/survival.$";
import { pageMeta } from "../lib/seo";
import { DocPage } from "../features/docs/DocPage";
import { docLoader } from "../features/docs/doc-loader.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return docLoader(request, "survival", params["*"] ?? "");
}

export function meta({ loaderData }: Route.MetaArgs) {
  const doc = loaderData?.doc;
  return pageMeta({ title: doc?.title ?? "生存手册", description: doc?.description ?? undefined, path: `/${doc?.slug ?? "survival"}`, type: "article" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

export default function SurvivalDoc() {
  const { doc, parts } = useLoaderData<typeof loader>();
  return <DocPage doc={doc} parts={parts} />;
}
