import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { apiGet, ApiError } from "../lib/api.server";
import { EmptyState } from "../components/ui/Page";
import type { SubscriptionItem, SubscriptionProfile, SubscriptionResponse } from "@aihot/contracts/subscription";
import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import { OptimizedOnboarding } from "../features/subscription/OptimizedOnboarding";
import { OPTIMIZED_TOPIC_GROUPS } from "@aihot/industry/subscription-onboarding";
import { CategoryTabs } from "../features/feed/Filters";
import { pageMeta } from "../lib/seo";

const emptyProfile = (): SubscriptionProfile => ({ degree: "", college: "", enrollmentYear: "", international: "", interests: [], publishers: [], types: [], identityNotices: true });
const tags = TAX.tags as readonly { id: string; label: string; dimension: string; reserved: boolean }[];
const label = (id: string) => tags.find(t=>t.id === id)?.label ?? id;
const button = "rounded-xl border border-line px-4 py-2 text-sm hover:bg-accent-soft disabled:opacity-40";
const primary = "rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const input = "mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm";

export function meta() { return pageMeta({ title: "我的订阅", path: "/subscription", noindex: true }); }
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: { request: Request }) {
  if (process.env.SUBSCRIPTION_EXPERIMENT_ENABLED !== "true") return { enabled: false as const, memberId: null, profile: null, revision: 0, csrf: "", unavailable: false, configured: true };
  try {
    const data = await apiGet<{ member: { id: string }; profile: SubscriptionProfile | null; revision: number; csrf: string }>("/api/member/subscription-profile", { signal: request.signal, headers: { cookie: request.headers.get("cookie") ?? "" } });
    return { enabled: true as const, memberId: data.member.id, profile: data.profile, revision: data.revision, csrf: data.csrf, unavailable: false, configured: true };
  } catch (error) {
    if (request.signal.aborted) throw error;
    const anonymous = error instanceof ApiError && error.status === 401;
    const unconfigured = error instanceof ApiError && error.code === "member_auth_unavailable";
    const disabled = error instanceof ApiError && error.status === 404;
    return { enabled: !disabled as boolean, memberId: null, profile: null, revision: 0, csrf: "", unavailable: !anonymous && !unconfigured && !disabled, configured: !unconfigured };
  }
}

export default function Subscription() {
  const { enabled, memberId, profile, revision, csrf, configured, unavailable } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    const refresh = () => { void revalidator.revalidate(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, [revalidator.revalidate]);
  if (!enabled) return <div className="pb-6">
    <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">订阅</h1>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <EmptyState title="订阅尚未开放" action={<Link to="/" className="font-medium text-accent hover:text-accent-ink">返回精选</Link>}>
      个性化订阅仍在小范围试验中，完成产品、隐私和真实登录链路验证后再开放。
    </EmptyState>
  </div>;
  if (unavailable) return <div className="pb-6">
    <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">订阅</h1>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <EmptyState title="暂时无法载入订阅设置">服务器暂时无法读取你的画像。请稍后刷新；系统不会把读取失败误当作首次使用。</EmptyState>
  </div>;
  if (!memberId) return <div className="pb-6">
    <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">订阅</h1>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <EmptyState title="订阅功能登录后可解锁" action={configured ? <a href="/api/logto/sign-in?redirect=%2Fsubscription" className="font-medium text-accent hover:text-accent-ink">登录 IF.Link 账号</a> : <button disabled className="text-ink-4">登录暂未启用</button>}>
      登录后，选择你的身份和兴趣，开启专属订阅。
      {!configured && <span className="mt-3 block">本地尚未配置 IF.Link 统一账户，配置完成后即可登录。</span>}
      {unavailable && <span role="alert" className="mt-3 block">暂时无法确认登录状态，请稍后刷新重试。</span>}
    </EmptyState>
  </div>;
  return <SubscriptionTrial key={memberId} memberId={memberId} initialProfile={profile} initialRevision={revision} csrf={csrf} />;
}

function SubscriptionTrial({ memberId, initialProfile, initialRevision, csrf }: { memberId: string; initialProfile: SubscriptionProfile | null; initialRevision: number; csrf: string }) {
  const PROFILE_KEY = `seuwiki.subscription.v2.profile:${memberId}`;
  const OLD_PROFILE_KEY = "seuwiki.subscription.v2.profile";
  const [profile,setProfile] = useState<SubscriptionProfile|null>(initialProfile);
  const [revision,setRevision] = useState(initialRevision);
  const [editing,setEditing] = useState(!initialProfile);
  const [legacyProfile,setLegacyProfile] = useState<SubscriptionProfile|null>(null);
  const [lane,setLane] = useState<SubscriptionItem["lane"] | "feed">("feed");
  const [page,setPage] = useState(1);
  const [query,setQuery] = useState("");
  const [data,setData] = useState<SubscriptionResponse|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [storageNotice,setStorageNotice] = useState("");
  const [retry,setRetry] = useState(0);
  const [saving,setSaving] = useState(false);
  const requestId = useRef(0);

  useEffect(()=>{
    try {
      if (!initialProfile) {
        const raw=localStorage.getItem(PROFILE_KEY) ?? localStorage.getItem(OLD_PROFILE_KEY);
        if(raw){const saved=JSON.parse(raw);const candidate=saved.profile ?? saved;if(Array.isArray(candidate?.interests) && Array.isArray(candidate?.publishers) && Array.isArray(candidate?.types))setLegacyProfile({...emptyProfile(),...candidate});}
      }
    } catch {setStorageNotice("浏览器未能恢复旧画像，你仍可重新填写并保存到当前账号。");}
  },[]);

  useEffect(()=>{
    if(!profile || editing)return;
    const controller=new AbortController();const id=++requestId.current;
    setLoading(true);setError("");setData(null);
    fetch("/api/site/subscription-preview",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile,lane,page,q:query}),signal:controller.signal})
      .then(async res=>{
        if(res.status===401){window.location.reload();throw new Error("登录已失效，请重新登录。");}
        if(!res.ok)throw new Error("订阅加载失败，请稍后重试。");
        return res.json() as Promise<SubscriptionResponse>;
      })
      .then(result=>{if(id===requestId.current)setData(result);})
      .catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));})
      .finally(()=>{if(id===requestId.current)setLoading(false);});
    return ()=>controller.abort();
  },[profile,editing,lane,page,query,retry]);

  async function save(draft: SubscriptionProfile) {
    setSaving(true);setError("");
    try {
      const response=await fetch("/api/member/subscription-profile",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({profile:draft,revision})});
      if(response.status===401){window.location.reload();throw new Error("登录已失效，请重新登录。");}
      if(response.status===409)throw new Error("设置已在另一页面更新。请刷新页面读取最新版本后再修改。");
      if(!response.ok){const problem=await response.json().catch(()=>null) as {detail?:string}|null;throw new Error(problem?.detail??"画像未能保存，请重试。");}
      const stored=await response.json() as {profile:SubscriptionProfile;revision:number};
      setProfile(stored.profile);setRevision(stored.revision);setEditing(false);setLegacyProfile(null);setPage(1);setLane("feed");setQuery("");
      try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(OLD_PROFILE_KEY);}catch{}
      window.scrollTo({ top: 0, behavior: "auto" });
    } finally {setSaving(false);}
  }
  async function importLegacy() {
    if(!legacyProfile)return;
    try {await save(legacyProfile);}
    catch(e){setStorageNotice(e instanceof Error?`旧画像未能导入：${e.message}`:"旧画像未能导入，请重新填写。");}
  }
  async function reset() {
    if(saving)return;
    setSaving(true);setError("");
    try {
      const response=await fetch("/api/member/subscription-profile",{method:"DELETE",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({revision})});
      if(response.status===409)throw new Error("设置已在另一页面更新，请刷新后再清除。");
      if(!response.ok)throw new Error("画像未能清除，请重试。");
      try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(OLD_PROFILE_KEY);}catch{setStorageNotice("服务器画像已清除，但浏览器中的旧画像未能清除。");}
      setProfile(null);setRevision(0);setLegacyProfile(null);setEditing(true);setData(null);
    } catch(e){setError(e instanceof Error?e.message:"画像未能清除，请重试。");}
    finally{setSaving(false);}
  }
  return <div className="subscription-page pb-10">
    <h1 className="text-2xl font-semibold text-ink">我的订阅</h1>
    <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
    <p className="my-5 text-sm leading-6 text-ink-3">从你的身份与兴趣出发，展示最近 30 天与你相关的最新校园信息。标题、摘要不能说明的适用条件会标为待确认。</p>
    {storageNotice && <p role="status" className="mb-4 rounded-xl border border-line p-3 text-sm">{storageNotice}</p>}
    {editing ? <>
      {!profile && legacyProfile && <section className="mb-4 rounded-2xl border border-line bg-surface p-4 text-sm leading-6"><strong>发现此浏览器中保存的旧画像</strong><p className="mt-1 text-ink-3">旧画像不会自动上传。你可以明确选择导入到当前账号，或继续重新填写。</p><div className="mt-3 flex gap-2"><button className={primary} disabled={saving} onClick={()=>void importLegacy()}>导入旧画像</button><button className={button} onClick={()=>setLegacyProfile(null)}>暂不导入</button></div></section>}
      <OptimizedOnboarding initialProfile={profile} onComplete={save} onCancel={profile ? () => setEditing(false) : undefined} />
    </> : <>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm leading-7"><strong>{[profile?.degree,profile?.college].filter(Boolean).join(" · ")||"按兴趣浏览"}</strong><br/>兴趣：{profile?.interests.map(label).join("、")||"未选择"}<br/>关注机构：{profile?.publishers.map(label).join("、")||"未选择"}{!profile?.mode && <> · 类型：{profile?.types.map(label).join("、")||"不限"}</>}</p>
        {profile?.mode && <p className="mt-2 text-sm leading-7">接收范围：{profile.mode === "identity_all" ? "也接收兴趣之外的信息，仍核对身份条件" : "按兴趣或关注机构匹配"}<br/>整组兴趣：{profile.topicGroups?.map(id => OPTIMIZED_TOPIC_GROUPS.find(g => g.id === id)?.label ?? id).join("、") || "未选择"}<br/>本学院信息：{profile.followOwnCollege && profile.college ? `已关注${profile.college}` : "未关注"}<br/>不看的类型：{profile.excludedTypes?.map(label).join("、") || "未排除"} · 不看的线下校区：{profile.excludedLocations?.map(label).join("、") || "未排除"}（线上信息不受校区排除影响）</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={()=>{setEditing(true);}}>修改订阅</button><button className={button} onClick={()=>setRetry(value=>value+1)}>刷新订阅</button><button className={button} disabled={saving} onClick={()=>void reset()}>清除画像并重新填写</button></div>
      </section>
      <div role="tablist" aria-label="订阅结果" className="my-5 flex flex-wrap gap-2">{([["feed","订阅流"],["matched","条件明确"],["possible","可能相关 · 待确认"]] as const).map(([key,name])=><button key={key} role="tab" aria-selected={lane===key} className={lane===key?primary:button} onClick={()=>{setLane(key);setPage(1);setQuery("");}}>{name}{data?`（${key==="feed"?data.counts.matched+data.counts.possible:data.counts[key]}）`:""}</button>)}</div>
      <input aria-label="搜索当前结果" className={`${input} mb-4`} placeholder="在当前结果中搜索标题、摘要、来源或标签" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} />
      {error && <div role="alert" className="rounded-xl border border-line p-4">{error}<button className={`${button} ml-2`} onClick={()=>setRetry(retry+1)}>重试</button></div>}
      {loading && <p role="status" className="py-6 text-ink-3">正在核对订阅条件…</p>}
      {data && <>
        <p className="mb-4 text-xs leading-6 text-ink-3">已从最新公开信息中核对 {data.total} 条（{data.from}—{data.asOf}）。{data.quality.unknownAudience} 条对象未明确，{data.quality.noTopics} 条未识别主题。{data.truncated && "数据较多，仅核对最新 5000 条。"}</p>
        {!data.items.length && <div className="rounded-2xl border border-line p-8 text-center"><h2 className="font-medium">当前没有这一类消息</h2><p className="mt-2 text-sm text-ink-3">可查看“可能相关”，或修改兴趣和搜索词。没有结果不等于没有相关信息。</p></div>}
        <div className="space-y-4">{data.items.map(item=><SubscriptionCard key={item.id} item={item} />)}</div>
        <div className="mt-5 flex items-center justify-between"><button className={button} disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>上一页</button><span className="text-sm">{data.page} / {data.pageCount}</span><button className={button} disabled={data.page>=data.pageCount} onClick={()=>setPage(data.page+1)}>下一页</button></div>
      </>}
    </>}
  </div>;
}

function SubscriptionCard({item}:{item:SubscriptionItem}){
  const a=item.annotation;
  return <article className="rounded-2xl border border-line bg-surface p-5">
    <p className="mb-2 text-xs font-medium text-accent">{item.lane === "matched" ? "命中订阅 · 已识别的条件相符" : item.lane === "possible" ? "命中订阅 · 适用条件待确认" : "已过滤 · 可反馈漏推"}</p>
    <p className="text-xs text-ink-3">{item.source.replace(/（本地快照）$/,"")} · {new Date(item.publishedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}</p>
    <h2 className="mt-2 text-lg font-semibold leading-7"><Link to={`/items/${item.id}`} target="_blank" rel="noreferrer" className="hover:text-accent">{item.title}</Link></h2>
    <p className="mt-2 text-sm leading-7 text-ink-2">{item.summary||"暂无摘要，请查看原始信息。"}</p>
    <div className="mt-3 flex flex-wrap gap-2">{[...a.topics,...a.types].map(t=><span key={t} className="rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent-ink">{t}</span>)}</div>
    <div className="mt-3 text-sm leading-6">{item.reasons.map((r,i)=><p key={i}>· {r}</p>)}</div>
    <details className="mt-4 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium">查看匹配依据</summary>
      <p className="mt-3 leading-6">发布主体：{a.publishers.join("、")||"未识别"}<br/>适用对象：{[...a.audience.degrees,...a.audience.colleges,...a.audience.years.map(y=>`${y} 级`),...(a.audience.schoolwide?["全校"]:[]),...(a.audience.internationalOnly?["留学生"]:[]),...(a.audience.staffOnly?["教职工"]:[])].join("、")||"待确认"}<br/>参与动作：{a.actions.join("、")||"未识别"} · 地点：{a.locations.join("、")||"未识别"} · 形式：{a.formats.join("、")||"未识别"}<br/>截止日期：{a.deadline||"未明确提取，不代表没有截止时间"}</p>
      <ul className="my-3 space-y-2 text-xs text-ink-3">{a.evidence.map((e,i)=><li key={i}>【{e.tag}】{e.field}：“{e.quote}”</li>)}</ul>
    </details>
  </article>;
}
