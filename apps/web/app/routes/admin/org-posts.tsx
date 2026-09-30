// 投稿审核队列：新投稿（pending）与挂在原条目上的变更申请。批准后进入统一内容库；驳回要填理由。
import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import type { Route } from "./+types/org-posts";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, FilterChips, ReasonDialog } from "../../features/admin/ui";
import { bj } from "../../features/admin/format";
import type { OrgPost } from "../../features/org/action";

interface Row extends OrgPost {
  orgName: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return adminGet<{ items: Row[] }>(request, `/api/admin/org-posts${url.search}`);
}

export const meta: Route.MetaFunction = () => [{ title: `投稿审核 · ${SITE.name} 后台` }];

const STATUS: Record<string, { label: string; tone: "warn" | "ok" | "bad" }> = {
  pending: { label: "待审核", tone: "warn" },
  published: { label: "已发布", tone: "ok" },
  rejected: { label: "已驳回", tone: "bad" },
};

const CHANGE_LABEL: Record<string, string> = { update: "修改", reschedule: "改期", cancel: "取消" };

function FieldDiff({ label, from, to }: { label: string; from: string | null; to: unknown }) {
  const next = typeof to === "string" ? to : to == null ? null : String(to);
  if ((from ?? "") === (next ?? "")) return null;
  return (
    <div className="flex gap-2 text-[12.5px] leading-relaxed">
      <span className="w-14 shrink-0 text-ink-4">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="text-ink-4 line-through">{from ?? "（空）"}</span>
        <span className="mx-1.5 text-ink-4">→</span>
        <span className="text-ink">{next ?? "（空）"}</span>
      </span>
    </div>
  );
}

function PostCard({ p }: { p: Row }) {
  const { run, pending } = useAdminAction();
  const [dialog, setDialog] = useState<null | "reject" | "change-reject">(null);
  const st = STATUS[p.status]!;
  const change = p.pendingChange;
  const patch = (change?.patch ?? {}) as Record<string, unknown>;
  const busy = !!pending;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <Badge tone={st.tone}>{st.label}</Badge>
        {change && <Badge tone="warn">变更申请：{CHANGE_LABEL[change.type]}</Badge>}
        <span className="font-medium text-ink-2">{p.orgName}</span>
        <span className="num">{bj(p.createdAt, true)} 提交</span>
        {p.articleId && (
          <a href={`/items/${p.articleId}`} className="text-accent hover:underline">
            公开页
          </a>
        )}
      </div>
      <h3 className="mt-2 text-[15px] font-semibold text-ink">{p.title}</h3>
      <div className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-3">
        {p.eventAt && <div>时间：{bj(p.eventAt, true)}</div>}
        {p.location && <div>地点:{p.location}</div>}
        {p.audience && <div>面向：{p.audience}</div>}
        {p.fee && <div>费用：{p.fee}</div>}
        {p.signup && <div>报名:{p.signup}</div>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{p.body}</p>
      {p.posterUrl && <img src={p.posterUrl} alt="海报" className="mt-2 max-h-44 rounded-control ring-1 ring-line" />}
      {p.reviewNote && p.status === "rejected" && <p className="mt-2 text-[12.5px] text-hot">驳回理由：{p.reviewNote}</p>}

      {change && change.type !== "cancel" && (
        <div className="mt-3 space-y-1 rounded-control bg-bg-sunk p-3">
          <div className="text-[12px] font-medium text-ink-3">变更内容{change.reason ? `（${change.reason}）` : ""}</div>
          <FieldDiff label="标题" from={p.title} to={patch.title} />
          <FieldDiff label="时间" from={p.eventAt ? bj(p.eventAt, true) : null} to={patch.eventAt} />
          <FieldDiff label="地点" from={p.location} to={patch.location} />
          <FieldDiff label="面向" from={p.audience} to={patch.audience} />
          <FieldDiff label="费用" from={p.fee} to={patch.fee} />
          <FieldDiff label="报名" from={p.signup} to={patch.signup} />
          <FieldDiff label="正文" from={p.body} to={patch.body} />
        </div>
      )}
      {change?.type === "cancel" && <p className="mt-3 rounded-control bg-bg-sunk p-3 text-[12.5px] text-ink-3">组织申请取消这条活动{change.reason ? `：${change.reason}` : "。"}批准后公开条目下架。</p>}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {p.status === "pending" && (
          <>
            <Button tone="primary" size="sm" busy={busy} onClick={() => run("POST", `/api/admin/org-posts/${p.id}/approve`, {}, { label: `approve-${p.id}`, success: "已发布，进入内容库" })}>
              批准发布
            </Button>
            <Button tone="danger" size="sm" busy={busy} onClick={() => setDialog("reject")}>
              驳回
            </Button>
          </>
        )}
        {change && (
          <>
            <Button tone="primary" size="sm" busy={busy} onClick={() => run("POST", `/api/admin/org-posts/${p.id}/change`, { approve: true }, { label: `change-ok-${p.id}`, success: "变更已批准" })}>
              批准变更
            </Button>
            <Button tone="secondary" size="sm" busy={busy} onClick={() => setDialog("change-reject")}>
              驳回变更
            </Button>
          </>
        )}
      </div>

      <ReasonDialog
        open={dialog === "reject"}
        title="驳回投稿"
        description="理由会展示给投稿组织。"
        confirmLabel="确认驳回"
        danger
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const res = await run("POST", `/api/admin/org-posts/${p.id}/reject`, { reason }, { label: `reject-${p.id}`, success: "已驳回" });
          if (res) setDialog(null);
          return !!res;
        }}
      />
      <ReasonDialog
        open={dialog === "change-reject"}
        title="驳回变更申请"
        description="已发布的内容保持不变。"
        confirmLabel="驳回变更"
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const res = await run("POST", `/api/admin/org-posts/${p.id}/change`, { approve: false, note: reason }, { label: `change-no-${p.id}`, success: "变更已驳回" });
          if (res) setDialog(null);
          return !!res;
        }}
      />
    </Card>
  );
}

export default function OrgPosts({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  return (
    <AdminPage title="投稿审核" subtitle="组织投稿批准后进入统一内容库，走与普通采集一致的分析与归组；驳回必须填理由。">
      <div className="mb-4">
        <FilterChips
          param="status"
          options={[
            { value: "", label: "待办" },
            { value: "pending", label: "新投稿" },
            { value: "published", label: "已发布" },
            { value: "rejected", label: "已驳回" },
          ]}
        />
      </div>
      <div className="space-y-4">{items.length === 0 ? <Empty>这个筛选下没有投稿。</Empty> : items.map((p) => <PostCard key={p.id} p={p} />)}</div>
    </AdminPage>
  );
}
