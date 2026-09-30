// 新建投稿：AI 辅助草稿（可选）+ 表单。提交后进审核队列（pending）。
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/posts.new";
import { AiDraftBox, EMPTY_POST, PostForm, type PostFormValue } from "../../features/org/PostForm";
import { useOrgAction } from "../../features/org/action";

export default function NewPost() {
  const navigate = useNavigate();
  const { run, error } = useOrgAction();
  const [seed, setSeed] = useState<PostFormValue>(EMPTY_POST);
  const [draftKey, setDraftKey] = useState(0);
  return (
    <div>
      <h1 className="mb-4 text-[20px] font-semibold text-ink">新建投稿</h1>
      <div className="mb-4">
        <AiDraftBox
          onFill={(draft) => {
            setSeed({ ...EMPTY_POST, ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v ?? ""])) } as PostFormValue);
            setDraftKey((k) => k + 1);
          }}
        />
      </div>
      <div className="rounded-panel bg-surface p-4 ring-1 ring-line">
        <PostForm
          key={draftKey}
          initial={seed}
          submitLabel="提交审核"
          onSubmit={async (v) => {
            const res = await run<{ id: number }>("POST", "/api/org/posts", v);
            if (res) await navigate("/org");
            return !!res;
          }}
        />
        {error && <p className="mt-3 text-[12.5px] text-hot">{error}</p>}
      </div>
    </div>
  );
}
