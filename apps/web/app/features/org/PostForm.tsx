// 投稿表单（新建与待审核编辑共用）：工具型紧凑密度。AI 辅助填表只填草稿，逐项确认后才提交。
import { useState } from "react";
import { buttonClass } from "../../components/ui/Controls";
import { useOrgAction, type OrgPost } from "./action";

export interface PostFormValue {
  title: string;
  eventAt: string;
  location: string;
  audience: string;
  fee: string;
  signup: string;
  body: string;
  posterKey: string | null;
  suggestedTags: string;
}

export const EMPTY_POST: PostFormValue = { title: "", eventAt: "", location: "", audience: "", fee: "", signup: "", body: "", posterKey: null, suggestedTags: "" };

export function valueOfPost(p: OrgPost): PostFormValue {
  return {
    title: p.title,
    eventAt: p.eventAt ? p.eventAt.slice(0, 16) : "",
    location: p.location ?? "",
    audience: p.audience ?? "",
    fee: p.fee ?? "",
    signup: p.signup ?? "",
    body: p.body,
    posterKey: p.posterUrl?.split("/").pop() ?? null,
    suggestedTags: (p.suggestedTags ?? []).join(", "),
  };
}

const FIELD = "h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "mb-1 block text-[12px] font-medium text-ink-3";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span className={LABEL}>
        {label}
        {required && <span className="text-hot"> *</span>}
      </span>
      {children}
    </div>
  );
}

export function PostForm({ initial, submitLabel, onSubmit }: { initial: PostFormValue; submitLabel: string; onSubmit: (v: PostFormValue) => Promise<boolean> }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof PostFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Field label="活动标题" required>
        <input className={FIELD} value={v.title} onChange={set("title")} maxLength={120} placeholder="一句话说清是什么活动" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="活动时间">
          <input className={FIELD} value={v.eventAt} onChange={set("eventAt")} placeholder="2026-10-20 19:00" />
        </Field>
        <Field label="地点">
          <input className={FIELD} value={v.location} onChange={set("location")} maxLength={120} placeholder="九龙湖校区 …" />
        </Field>
        <Field label="面向对象">
          <input className={FIELD} value={v.audience} onChange={set("audience")} maxLength={120} placeholder="全校本科生" />
        </Field>
        <Field label="费用">
          <input className={FIELD} value={v.fee} onChange={set("fee")} maxLength={60} placeholder="免费" />
        </Field>
      </div>
      <Field label="报名方式">
        <input className={FIELD} value={v.signup} onChange={set("signup")} maxLength={300} placeholder="报名链接，或「现场报名」「群内接龙」等" />
      </Field>
      <Field label="正文介绍" required>
        <textarea
          className={`${FIELD} h-auto min-h-[140px] resize-y py-2 leading-relaxed`}
          value={v.body}
          onChange={set("body")}
          maxLength={10000}
          placeholder="活动流程、嘉宾、奖项、注意事项……"
        />
      </Field>
      <PosterField value={v.posterKey} onChange={(posterKey) => setV({ ...v, posterKey })} />
      <div>
        <span className={LABEL}>建议新增标签（可选，逗号分隔）</span>
        <input
          className={FIELD}
          value={v.suggestedTags}
          onChange={(e) => setV({ ...v, suggestedTags: e.target.value })}
          placeholder="词表里没有的主题词，如「嵌入式」；会进入平台审核，通过后成为可选标签"
        />
      </div>
      <div className="pt-1">
        <button type="button" disabled={busy || !v.title.trim() || !v.body.trim()} onClick={submit} className={buttonClass("primary")}>
          {busy ? "提交中…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function PosterField({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const { run, pending, error } = useOrgAction();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("读取文件失败"));
      r.readAsDataURL(file);
    });
    const res = await run<{ key: string }>("POST", "/api/org/poster", { image: dataUrl }, { revalidate: false });
    if (res) onChange(res.key);
  };
  return (
    <div>
      <span className={LABEL}>海报（可选，≤ 5MB）</span>
      <div className="flex items-center gap-3">
        {value && <img src={`/api/org/poster/${value}`} alt="海报预览" className="h-20 rounded-control ring-1 ring-line" />}
        <label className={`${buttonClass("secondary", "sm")} cursor-pointer ${pending ? "opacity-50" : ""}`}>
          {pending ? "上传中…" : value ? "更换海报" : "上传海报"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={!!pending} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {value && (
          <button type="button" className="text-[12.5px] text-ink-4 hover:text-hot" onClick={() => onChange(null)}>
            移除
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-hot">{error}</p>}
    </div>
  );
}

/** AI 辅助：粘贴链接或文字，抽成草稿填进表单；不可用时降级提示，不影响手填。 */
export function AiDraftBox({ onFill }: { onFill: (draft: Partial<PostFormValue>) => void }) {
  const { run, pending, error } = useOrgAction();
  const [text, setText] = useState("");
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const go = async () => {
    setUnavailable(null);
    const input = /^https?:\/\//i.test(text.trim()) ? { url: text.trim() } : { text: text.trim() };
    const res = await run<{ kind: "ok"; draft: Partial<PostFormValue> } | { kind: "unavailable" }>("POST", "/api/org/draft", input, { revalidate: false });
    if (!res) return;
    if (res.kind === "unavailable") {
      setUnavailable("AI 助手暂时不可用，请手动填写下面的表单。");
      return;
    }
    onFill(res.kind === "ok" ? res.draft : {});
  };
  return (
    <section className="rounded-panel border border-dashed border-line-strong bg-surface p-4">
      <div className="text-[13px] font-medium text-ink">AI 辅助填表（可选）</div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-4">粘贴公众号文章链接或一段宣传文字，AI 会抽出下面的表单草稿；请逐项核对后再提交，AI 抽错的信息由发布者负责。</p>
      <textarea
        className={`${FIELD} mt-2.5 h-auto min-h-[72px] resize-y py-2`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="https://mp.weixin.qq.com/… 或直接粘贴文字"
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" disabled={!!pending || !text.trim()} onClick={go} className={buttonClass("secondary", "sm")}>
          {pending ? "抽取中…" : "AI 抽取草稿"}
        </button>
        {unavailable && <span className="text-[12px] text-amber">{unavailable}</span>}
        {error && <span className="text-[12px] text-hot">{error}</span>}
      </div>
    </section>
  );
}
