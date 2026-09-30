// 经验详情页 /experience/…，与手册页共用阅读器（没有目录树）。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/experience.$";
import { pageMeta } from "../lib/seo";
import { DocPage } from "../features/docs/DocPage";
import { docLoader } from "../features/docs/doc-loader.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return docLoader(request, "experience", params["*"] ?? "");
}

export function meta({ loaderData }: Route.MetaArgs) {
  const doc = loaderData?.doc;
  return pageMeta({ title: doc?.title ?? "经验分享", description: doc?.description ?? undefined, path: `/${doc?.slug ?? "experience"}`, type: "article" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

export default function ExperienceDoc() {
  const { doc } = useLoaderData<typeof loader>();
  return <DocPage doc={doc} />;
}
