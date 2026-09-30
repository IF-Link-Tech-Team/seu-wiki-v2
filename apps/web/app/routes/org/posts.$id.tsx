// 投稿详情：待审核可直接编辑；已发布的改期/修改/取消走变更申请（更新原条目，不重新发布）。
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/posts.$id";
import { orgGet } from "../../lib/org.server";
import { buttonClass } from "../../components/ui/Controls";
import { PostForm, valueOfPost } from "../../features/org/PostForm";
import { useOrgAction, type OrgPost } from "../../features/org/action";
import { bj } from "../../features/admin/format";

export async function loader({ request, params }: Route.LoaderArgs) {
  return { post: await orgGet<OrgPost>(request, `/api/org/posts/${params.id}`) };
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 text-[13px] leading-relaxed">
      <span className="w-16 shrink-0 text-ink-4">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink">{value ?? "—"}</span>
    </div>
  );
}

export default function PostDetail({ loaderData }: Route.ComponentProps) {
  const { post } = loaderData;
  const { run, pending, error } = useOrgAction();
  const [mode, setMode] = useState<"view" | "edit" | "change">("view");
  const [cancelReason, setCancelReason] = useState("");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link to="/org" className="text-[13px] text-ink-4 hover:text-ink-2">← 我的活动</Link>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-ink">{post.title}</h1>
        {post.articleId && (
          <a href={`/items/${post.articleId}`} className={buttonClass("secondary", "sm")}>
            公开页
          </a>
        )}
      </div>

      {post.status === "rejected" && (
        <div className="mb-4 rounded-panel bg-hot-soft px-4 py-3 text-[13px] leading-relaxed text-hot ring-1 ring-hot/25">
          已驳回{post.reviewNote ? `：${post.reviewNote}` : "。"}
        </div>
      )}
      {post.pendingChange && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-panel bg-amber/10 px-4 py-3 text-[13px] text-amber ring-1 ring-amber/25">
          <span>变更申请审核中（{{ update: "修改", reschedule: "改期", cancel: "取消" }[post.pendingChange.type]}）</span>
          <button
            type="button"
            className="underline"
            disabled={!!pending}
            onClick={() => run("POST", `/api/org/posts/${post.id}/change/retract`)}
          >
            撤回申请
          </button>
        </div>
      )}

      {mode === "view" && (
        <div className="space-y-2.5 rounded-panel bg-surface p-4 ring-1 ring-line">
          <Row label="时间" value={post.eventAt ? bj(post.eventAt, true) : null} />
          <Row label="地点" value={post.location} />
          <Row label="面向" value={post.audience} />
          <Row label="费用" value={post.fee} />
          <Row label="报名" value={post.signup} />
          <Row label="正文" value={post.body} />
          {post.posterUrl && (
            <div className="flex gap-3">
              <span className="w-16 shrink-0 text-[13px] text-ink-4">海报</span>
              <img src={post.posterUrl} alt="海报" className="max-h-52 rounded-control ring-1 ring-line" />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            {post.status === "pending" && (
              <button type="button" className={buttonClass("primary", "sm")} onClick={() => setMode("edit")}>
                修改
              </button>
            )}
            {post.status === "published" && !post.pendingChange && (
              <>
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setMode("change")}>
                  申请改期 / 修改
                </button>
              </>
            )}
          </div>
          {post.status === "published" && !post.pendingChange && (
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <input
                className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
                placeholder="取消原因（提交平台审核）"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <button
                type="button"
                className={buttonClass("danger", "sm")}
                disabled={!!pending || !cancelReason.trim()}
                onClick={() => run("POST", `/api/org/posts/${post.id}/change`, { type: "cancel", reason: cancelReason })}
              >
                申请取消
              </button>
            </div>
          )}
        </div>
      )}

      {(mode === "edit" || mode === "change") && (
        <div className="rounded-panel bg-surface p-4 ring-1 ring-line">
          <p className="mb-3 text-[12.5px] text-ink-4">
            {mode === "edit" ? "还在审核中，改动直接生效。" : "变更申请提交后由平台审核，批准后原条目更新，不会重新发布。"}
          </p>
          <PostForm
            initial={valueOfPost(post)}
            submitLabel={mode === "edit" ? "保存修改" : "提交变更申请"}
            onSubmit={async (v) => {
              const res =
                mode === "edit"
                  ? await run("PATCH", `/api/org/posts/${post.id}`, v)
                  : await run("POST", `/api/org/posts/${post.id}/change`, { type: "update", patch: v });
              if (res) setMode("view");
              return !!res;
            }}
          />
        </div>
      )}
      {error && <p className="mt-3 text-[12.5px] text-hot">{error}</p>}
    </div>
  );
}
