// 我的活动：审核中 / 已发布 / 已结束三段。改期和取消在详情页走变更申请。
import { Link } from "react-router";
import type { Route } from "./+types/index";
import { orgGet } from "../../lib/org.server";
import { buttonClass } from "../../components/ui/Controls";
import type { OrgPost } from "../../features/org/action";
import { bj } from "../../features/admin/format";

export async function loader({ request }: Route.LoaderArgs) {
  return orgGet<{ items: OrgPost[] }>(request, "/api/org/posts");
}

const STATUS_LABEL: Record<OrgPost["status"], { text: string; className: string }> = {
  pending: { text: "审核中", className: "bg-amber/10 text-amber ring-amber/25" },
  published: { text: "已发布", className: "bg-accent-soft text-accent ring-accent/20" },
  rejected: { text: "已驳回", className: "bg-hot-soft text-hot ring-hot/25" },
};

function PostCard({ p }: { p: OrgPost }) {
  const s = STATUS_LABEL[p.status];
  return (
    <li className="rounded-panel bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/org/posts/${p.id}`} className="text-[14.5px] font-medium text-ink hover:text-accent">
          {p.title}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${s.className}`}>{s.text}</span>
        {p.pendingChange && <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[11.5px] font-medium text-amber ring-1 ring-amber/25">变更审核中</span>}
        {p.ended && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11.5px] text-ink-4 ring-1 ring-line">已结束</span>}
        <span className="num ml-auto text-[12px] text-ink-4">{p.eventAt ? bj(p.eventAt, true) : "时间待定"}</span>
      </div>
      {p.status === "rejected" && p.reviewNote && <p className="mt-2 text-[12.5px] leading-relaxed text-hot">驳回理由：{p.reviewNote}</p>}
      <div className="mt-2 flex items-center gap-3 text-[12.5px]">
        <Link to={`/org/posts/${p.id}`} className="text-accent hover:underline">
          {p.status === "pending" ? "查看 / 修改" : "查看"}
        </Link>
        {p.articleId && (
          <a href={`/items/${p.articleId}`} className="text-ink-4 hover:text-accent">
            公开页
          </a>
        )}
      </div>
    </li>
  );
}

export default function OrgHome({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const pending = items.filter((p) => p.status === "pending");
  const live = items.filter((p) => p.status === "published" && !p.ended);
  const past = items.filter((p) => p.status === "rejected" || (p.status === "published" && p.ended));
  const sections: Array<{ title: string; list: OrgPost[] }> = [
    { title: "审核中", list: pending },
    { title: "已发布", list: live },
    { title: "已结束与已驳回", list: past },
  ];
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-ink">我的活动</h1>
        <Link to="/org/posts/new" className={buttonClass("primary", "sm")}>
          新建投稿
        </Link>
      </div>
      {items.length === 0 && (
        <div className="rounded-panel bg-surface px-4 py-12 text-center ring-1 ring-line">
          <p className="text-[13.5px] text-ink-3">还没有投稿。发布第一场活动吧——审核通过后就会出现在统一信息流里。</p>
        </div>
      )}
      {sections.map(
        (sec) =>
          sec.list.length > 0 && (
            <section key={sec.title} className="mb-6">
              <h2 className="mb-2 text-[12.5px] font-medium text-ink-4">
                {sec.title} <span className="num">{sec.list.length}</span>
              </h2>
              <ul className="space-y-2.5">
                {sec.list.map((p) => (
                  <PostCard key={p.id} p={p} />
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}
