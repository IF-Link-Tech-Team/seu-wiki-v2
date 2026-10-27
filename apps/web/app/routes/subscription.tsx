import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { EmptyState } from "../components/ui/Page";
import type { SubscriptionItem, SubscriptionProfile, SubscriptionResponse } from "@aihot/contracts/subscription";
import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import { OptimizedOnboarding } from "../features/subscription/OptimizedOnboarding";
import { OPTIMIZED_TOPIC_GROUPS } from "@aihot/industry/subscription-onboarding";
import { CategoryTabs } from "../features/feed/Filters";
import { pageMeta } from "../lib/seo";

const PROFILE_KEY = "seuwiki.subscription.v2.profile";
const FEEDBACK_KEY = "seuwiki.subscription.v2.feedback";
const emptyProfile = (): SubscriptionProfile => ({ degree: "", college: "", enrollmentYear: "", international: "", interests: [], publishers: [], types: [], identityNotices: true });
const DEFAULT_REPLAY_DAY = "2026-10-25";
const tags = TAX.tags as readonly { id: string; label: string; dimension: string; reserved: boolean }[];
const label = (id: string) => tags.find(t=>t.id === id)?.label ?? id;
const button = "rounded-xl border border-line px-4 py-2 text-sm hover:bg-accent-soft disabled:opacity-40";
const primary = "rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const input = "mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm";
type Feedback = { id: string; title: string; verdict: string; note: string; profile: SubscriptionProfile; asOf: string; version: string; annotation: SubscriptionItem["annotation"]; lane: string; reasons: string[]; recordedAt: string };

export function meta() { return pageMeta({ title: "我的订阅 · 本地测试", path: "/subscription", noindex: true }); }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export function loader() { return { localTrial: process.env.NODE_ENV !== "production" }; }

export default function Subscription() {
  const { localTrial } = useLoaderData<typeof loader>();
  if (!localTrial) return <div className="pb-6">
    <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">订阅</h1>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <EmptyState title="订阅尚未开放" action={<Link to="/" className="font-medium text-accent hover:text-accent-ink">返回精选</Link>}>
      个性化规则仍在设计中，后续将提供与你相关的内容。
    </EmptyState>
  </div>;
  return <SubscriptionTrial />;
}

function SubscriptionTrial() {
  const [ready,setReady] = useState(false);
  const [profile,setProfile] = useState<SubscriptionProfile|null>(null);
  const [editing,setEditing] = useState(true);
  const [asOf,setAsOf] = useState(DEFAULT_REPLAY_DAY);
  const [lane,setLane] = useState<SubscriptionItem["lane"] | "feed">("feed");
  const [page,setPage] = useState(1);
  const [query,setQuery] = useState("");
  const [data,setData] = useState<SubscriptionResponse|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [storageNotice,setStorageNotice] = useState("");
  const [feedback,setFeedback] = useState<Feedback[]>([]);
  const [retry,setRetry] = useState(0);
  const requestId = useRef(0);

  useEffect(()=>{
    try {
      const raw=localStorage.getItem(PROFILE_KEY);
      if(raw){const saved=JSON.parse(raw);if(saved.version===TAX.version && Array.isArray(saved.profile?.interests) && Array.isArray(saved.profile?.publishers) && Array.isArray(saved.profile?.types)){
        const p={...emptyProfile(),...saved.profile};setProfile(p);setEditing(false);
      }}
      const reviews=JSON.parse(localStorage.getItem(FEEDBACK_KEY)??"[]");if(Array.isArray(reviews))setFeedback(reviews);
    } catch {setStorageNotice("浏览器未能恢复设置，本次仍可测试；请及时导出反馈。");}
    setReady(true);
  },[]);

  useEffect(()=>{
    if(!profile || editing)return;
    const controller=new AbortController();const id=++requestId.current;
    setLoading(true);setError("");setData(null);
    fetch("/api/site/subscription-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile,asOf,lane,page,q:query}),signal:controller.signal})
      .then(async res=>{if(!res.ok)throw new Error(res.status===404?"这是本地测试功能，请从本地开发网站打开。":"订阅加载失败，请确认本地服务运行正常，并检查回放日期。");return res.json() as Promise<SubscriptionResponse>;})
      .then(result=>{if(id===requestId.current)setData(result);})
      .catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));})
      .finally(()=>{if(id===requestId.current)setLoading(false);});
    return ()=>controller.abort();
  },[profile,editing,asOf,lane,page,query,retry]);

  function save(draft: SubscriptionProfile) {
    try {localStorage.setItem(PROFILE_KEY,JSON.stringify({version:TAX.version,profile:draft}));}catch{setStorageNotice("设置仅在本次页面打开期间生效，浏览器未允许保存。");}
    setProfile(draft);setEditing(false);setPage(1);setLane("feed");setQuery("");
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function reset() {
    try{localStorage.removeItem(PROFILE_KEY);}catch{setStorageNotice("浏览器未能清除旧设置，请使用无痕窗口重新测试。");}
    setProfile(null);setEditing(true);setData(null);
  }
  function review(item: SubscriptionItem, verdict: string, note: string) {
    if(!profile)return;
    const next=[...feedback,{id:item.id,title:item.title,verdict,note,profile,asOf,version:TAX.version,annotation:item.annotation,lane:item.lane,reasons:item.reasons,recordedAt:new Date().toISOString()}];
    setFeedback(next);try{localStorage.setItem(FEEDBACK_KEY,JSON.stringify(next));}catch{setStorageNotice("反馈尚未保存到浏览器，请点击导出测试反馈。");}
  }
  function exportFeedback() {
    const blob=new Blob([JSON.stringify({version:TAX.version,exportedAt:new Date().toISOString(),feedback},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="SEU订阅测试反馈.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  return <div className="subscription-page pb-10">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold text-ink">我的订阅</h1><span className="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent-ink">标签 v2 · 本地试验</span></div>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <p className="my-5 text-sm leading-6 text-ink-3">从你的身份与兴趣出发，找到与你相关的校园信息。本次回放截至 2026-10-25 的历史消息，不是实时通知；标题、摘要不能说明的条件会标为待确认。</p>
    {storageNotice && <p role="status" className="mb-4 rounded-xl border border-line p-3 text-sm">{storageNotice}</p>}
    {!ready ? <p>正在准备订阅设置…</p> : editing ? <OptimizedOnboarding initialProfile={profile} onComplete={save} onCancel={profile ? () => setEditing(false) : undefined} /> : <>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm leading-7"><strong>{[profile?.degree,profile?.college].filter(Boolean).join(" · ")||"按兴趣浏览"}</strong><br/>兴趣：{profile?.interests.map(label).join("、")||"未选择"}<br/>关注机构：{profile?.publishers.map(label).join("、")||"未选择"}{!profile?.mode && <> · 类型：{profile?.types.map(label).join("、")||"不限"}</>}</p>
        {profile?.mode && <p className="mt-2 text-sm leading-7">接收范围：{profile.mode === "identity_all" ? "也接收兴趣之外的信息，仍核对身份条件" : "按兴趣或关注机构匹配"}<br/>整组兴趣：{profile.topicGroups?.map(id => OPTIMIZED_TOPIC_GROUPS.find(g => g.id === id)?.label ?? id).join("、") || "未选择"}<br/>本学院信息：{profile.followOwnCollege && profile.college ? `已关注${profile.college}` : "未关注"}<br/>不看的类型：{profile.excludedTypes?.map(label).join("、") || "未排除"} · 不看的线下校区：{profile.excludedLocations?.map(label).join("、") || "未排除"}（线上信息不受校区排除影响）</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={()=>{setEditing(true);}}>修改订阅</button><button className={button} onClick={reset}>重新体验新用户</button><button className={button} onClick={exportFeedback}>导出测试反馈（{feedback.length}）</button></div>
      </section>
      <details className="my-4 rounded-xl border border-line p-4 text-sm"><summary className="cursor-pointer">测试方式与遗漏检查</summary><p className="mt-3 leading-7">先检查“符合订阅”和“可能相关”。再到“过滤记录”搜索你认为应收到的消息，标记“本应收到”。同一条消息可展开查看新标签、证据和过滤理由。结果按发布时间从新到旧排列，没有综合分数门槛。</p><label className="mt-3 block">回放截止日（含当天及此前 30 天）<input aria-label="回放截止日" type="date" className={input} value={asOf} onChange={e=>{setAsOf(e.target.value);setPage(1);}} /></label><p className="mt-2 text-xs text-ink-3">已导入样本为 2026-09-25 至 2026-10-25；日期范围内没有本地数据时会显示空结果。</p></details>
      <div role="tablist" aria-label="订阅结果" className="my-5 flex flex-wrap gap-2">{([["feed","订阅流"],["matched","条件明确"],["possible","可能相关 · 待确认"],["excluded","过滤记录 · 查漏推"]] as const).map(([key,name])=><button key={key} role="tab" aria-selected={lane===key} className={lane===key?primary:button} onClick={()=>{setLane(key);setPage(1);setQuery("");}}>{name}{data?`（${key==="feed"?data.counts.matched+data.counts.possible:data.counts[key]}）`:""}</button>)}</div>
      <input aria-label="搜索当前结果" className={`${input} mb-4`} placeholder="在当前结果中搜索标题、摘要、来源或标签" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} />
      {error && <div role="alert" className="rounded-xl border border-line p-4">{error}<button className={`${button} ml-2`} onClick={()=>setRetry(retry+1)}>重试</button></div>}
      {loading && <p role="status" className="py-6 text-ink-3">正在核对订阅条件…</p>}
      {data && <>
        <p className="mb-4 text-xs leading-6 text-ink-3">核对 {data.total} 条公开消息（{data.from}—{data.asOf}）。{data.quality.unknownAudience} 条对象未明确，{data.quality.noTopics} 条未识别主题。标注基于标题和摘要，需人工验证。{data.truncated && "数据超过单次测试上限，仅核对最新 5000 条。"}</p>
        {!data.items.length && <div className="rounded-2xl border border-line p-8 text-center"><h2 className="font-medium">当前没有这一类消息</h2><p className="mt-2 text-sm text-ink-3">可查看“可能相关”，或修改兴趣、日期和搜索词。没有结果不等于没有相关信息。</p></div>}
        <div className="space-y-4">{data.items.map(item=><SubscriptionCard key={item.id} item={item} onReview={review} reviewed={feedback.some(f=>f.id===item.id && JSON.stringify(f.profile)===JSON.stringify(profile))} />)}</div>
        <div className="mt-5 flex items-center justify-between"><button className={button} disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>上一页</button><span className="text-sm">{data.page} / {data.pageCount}</span><button className={button} disabled={data.page>=data.pageCount} onClick={()=>setPage(data.page+1)}>下一页</button></div>
      </>}
    </>}
  </div>;
}

function SubscriptionCard({item,onReview,reviewed}:{item:SubscriptionItem;onReview:(item:SubscriptionItem,verdict:string,note:string)=>void;reviewed:boolean}){
  const [note,setNote]=useState("");
  const a=item.annotation;
  return <article className="rounded-2xl border border-line bg-surface p-5">
    <p className="mb-2 text-xs font-medium text-accent">{item.lane === "matched" ? "命中订阅 · 已识别的条件相符" : item.lane === "possible" ? "命中订阅 · 适用条件待确认" : "已过滤 · 可反馈漏推"}</p>
    <p className="text-xs text-ink-3">{item.source.replace(/（本地快照）$/,"")} · {new Date(item.publishedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}</p>
    <h2 className="mt-2 text-lg font-semibold leading-7"><Link to={`/items/${item.id}`} target="_blank" rel="noreferrer" className="hover:text-accent">{item.title}</Link></h2>
    <p className="mt-2 text-sm leading-7 text-ink-2">{item.summary||"暂无摘要，请查看原始信息。"}</p>
    <div className="mt-3 flex flex-wrap gap-2">{[...a.topics,...a.types].map(t=><span key={t} className="rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent-ink">{t}</span>)}</div>
    <div className="mt-3 text-sm leading-6">{item.reasons.map((r,i)=><p key={i}>· {r}</p>)}</div>
    <details className="mt-4 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium">查看标注依据与测试反馈{reviewed?"（已记录反馈）":""}</summary>
      <p className="mt-3 leading-6">发布主体：{a.publishers.join("、")||"未识别"}<br/>适用对象：{[...a.audience.degrees,...a.audience.colleges,...a.audience.years.map(y=>`${y} 级`),...(a.audience.schoolwide?["全校"]:[]),...(a.audience.internationalOnly?["留学生"]:[]),...(a.audience.staffOnly?["教职工"]:[])].join("、")||"待确认"}<br/>参与动作：{a.actions.join("、")||"未识别"} · 地点：{a.locations.join("、")||"未识别"} · 形式：{a.formats.join("、")||"未识别"}<br/>截止日期：{a.deadline||"未明确提取，不代表没有截止时间"}</p>
      <ul className="my-3 space-y-2 text-xs text-ink-3">{a.evidence.map((e,i)=><li key={i}>【{e.tag}】{e.field}：“{e.quote}”</li>)}</ul>
      <label className="block text-sm">反馈备注<input aria-label={`反馈备注 ${item.id}`} className={input} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：原文实际仅限硕士，或这条是我想要的" /></label>
      <div className="mt-3 flex flex-wrap gap-2">{(item.lane==="excluded"?["本应收到","过滤正确","标签有误"]:["符合需要","不符合需要","标签有误"]).map(v=><button key={v} className={button} onClick={()=>onReview(item,v,note)}>{v}</button>)}</div>
    </details>
  </article>;
}
