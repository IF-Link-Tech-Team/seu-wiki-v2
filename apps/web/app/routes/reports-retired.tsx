import { data } from "react-router";
import { EmptyState } from "../components/ui/Page";
import { pageMeta } from "../lib/seo";

export function loader() {
  return data(null, { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
}

export function meta() {
  return pageMeta({ title: "报告已下线", path: "/", noindex: true });
}

export default function ReportsRetired() {
  return <EmptyState title="日报、周报和月报已下线">请通过精选、分类或搜索查看校园信息。</EmptyState>;
}
