import { useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useRevalidator, useLocation, useNavigate } from "react-router";
import { apiGet, ApiError } from "../lib/api.server";
import { EmptyState } from "../components/ui/Page";
import type { SubscriptionItem, SubscriptionProfile, SubscriptionResponse } from "@aihot/contracts/subscription";
import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import { OptimizedOnboarding } from "../features/subscription/OptimizedOnboarding";
import { ProfileDialog } from "../features/subscription/ProfileDialog";
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
    if (!data.profile && new URL(request.url).pathname === "/subscription") return redirect("/welcome");
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
  const location = useLocation();
  const welcome = location.pathname === "/welcome";
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
      {!configured && <span className="mt-3 block">账号登录尚未启用，请稍后再试。</span>}
      {unavailable && <span role="alert" className="mt-3 block">暂时无法确认登录状态，请稍后刷新重试。</span>}
    </EmptyState>
  </div>;
  return <SubscriptionTrial key={`${memberId}:${welcome}`} memberId={memberId} initialProfile={profile} initialRevision={revision} csrf={csrf} welcome={welcome} />;
}

function SubscriptionTrial({ memberId, initialProfile, initialRevision, csrf, welcome }: { memberId: string; initialProfile: SubscriptionProfile | null; initialRevision: number; csrf: string; welcome: boolean }) {
  const navigate = useNavigate();
  const PROFILE_KEY = `seuwiki.subscription.v2.profile:${memberId}`;
  const OLD_PROFILE_KEY = "seuwiki.subscription.v2.profile";
  const [profile,setProfile] = useState<SubscriptionProfile|null>(initialProfile);
  const [revision,setRevision] = useState(initialRevision);
  const [editing,setEditing] = useState(welcome || !initialProfile);
  const [preferencesOpen,setPreferencesOpen] = useState(false);
  const preferencesPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const collapse = () => {
      if (preferencesPanel.current) preferencesPanel.current.open = false;
      setPreferencesOpen(false);
    };
    collapse();
    window.addEventListener("pageshow", collapse);
    return () => window.removeEventListener("pageshow", collapse);
  }, []);
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

  useEffect(() => {
    if (!profile || editing) return;
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, [profile, editing]);

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
      setPreferencesOpen(false);
      try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(OLD_PROFILE_KEY);}catch{}
      window.scrollTo({ top: 0, behavior: "auto" });
      if (welcome) await navigate("/subscription", { replace: true });
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
  const cancelEditing = profile && !welcome ? () => setEditing(false) : undefined;
  return <div className="subscription-page pb-10">
    {welcome ? <div className="flex min-h-[65vh] flex-col items-center justify-center text-center"><p className="text-sm font-medium text-accent">SEU Wiki</p><h1 className="mt-3 text-3xl font-semibold">欢迎回来</h1><p className="mt-3 text-ink-3">完成订阅设置，开启你的校园信息流。</p></div> : <>
      <h1 className="browse-title pt-5 lg:pt-0">我的订阅</h1>
      <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
      <p className="my-5 text-sm text-ink-3">你关心的校园消息，都在这里。</p>
    </>}
    {editing && <ProfileDialog onCancel={cancelEditing}>
      {storageNotice && <p role="status" className="px-5 py-3 text-sm">{storageNotice}</p>}
      {!profile && legacyProfile && <div className="border-b border-line px-5 py-3 text-sm"><p>发现浏览器中的旧偏好，可选择导入到当前账号。</p><button className={button} disabled={saving} onClick={()=>void importLegacy()}>导入旧偏好</button><button className={button} onClick={()=>setLegacyProfile(null)}>重新填写</button></div>}
      <OptimizedOnboarding initialProfile={profile} onComplete={save} />
    </ProfileDialog>}
    {!welcome && profile && <>
      <div className="mb-5 flex items-start gap-3">
        <details ref={preferencesPanel} open={preferencesOpen} onToggle={event=>setPreferencesOpen(event.currentTarget.open)} className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">我的订阅偏好 <span className="ml-2 font-normal text-ink-3">{profile.interests.length} 个兴趣 · {profile.college || profile.degree || "按兴趣订阅"}</span></summary>
          <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm leading-7">
            <p>{[profile.degree,profile.college].filter(Boolean).join(" · ") || "尚未填写身份"}</p>
            <p>感兴趣：{profile.interests.map(label).join("、") || "尚未选择"}</p>
            {!!profile.publishers.length && <p>关注机构：{profile.publishers.map(label).join("、")}</p>}
            {!!profile.followColleges?.length && <p>关注学院：{profile.followColleges.join("、")}</p>}
            {!!profile.topicGroups?.length && <p>关注方向：{profile.topicGroups.map(id=>OPTIMIZED_TOPIC_GROUPS.find(g=>g.id===id)?.label??id).join("、")}</p>}
            <div className="flex flex-wrap gap-2"><button className={primary} onClick={()=>setEditing(true)}>修改偏好</button><button className={button} disabled={saving} onClick={()=>void reset()}>清除偏好</button></div>
          </div>
        </details>
        <button className={button} disabled={loading} onClick={()=>{setPage(1);setRetry(value=>value+1);}}>刷新</button>
      </div>
      <input aria-label="搜索订阅消息" className={input + " mb-5"} placeholder="搜索订阅消息" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} />
      {error && <div role="alert" className="rounded-xl border border-line p-4">{error}<button className={button + " ml-2"} onClick={()=>setRetry(value=>value+1)}>重试</button></div>}
      {loading && <p role="status" className="py-6 text-ink-3">正在加载消息…</p>}
      {data && <>
        <p className="mb-4 text-xs text-ink-3">消息范围：全部日期{data.from && data.to && ` · ${data.from} 至 ${data.to}`}</p>
        {!data.items.length && <div className="rounded-2xl border border-line p-8 text-center"><h2 className="font-medium">暂时没有相关消息</h2><p className="mt-2 text-sm text-ink-3">试试其他搜索词，或在订阅偏好中添加更多兴趣。</p></div>}
        <div className="space-y-4">{data.items.map(item=><SubscriptionCard key={item.id} item={item} />)}</div>
        <div className="mt-5 flex items-center justify-between"><button className={button} disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>上一页</button><span className="text-sm">{data.page} / {data.pageCount}</span><button className={button} disabled={data.page>=data.pageCount} onClick={()=>setPage(data.page+1)}>下一页</button></div>
      </>}
    </>}
  </div>;
}

function SubscriptionCard({item}:{item:SubscriptionItem}){
  return <article className="rounded-2xl border border-line bg-surface p-5">
    <p className="text-xs text-ink-3">{item.source.replace(/（本地快照）$/,"")} · {new Date(item.publishedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}</p>
    <h2 className="mt-2 text-lg font-semibold leading-7"><Link to={"/items/"+item.id} target="_blank" rel="noreferrer" className="hover:text-accent">{item.title}</Link></h2>
    <p className="mt-2 text-sm leading-7 text-ink-2">{item.summary||"暂无摘要，请查看原始信息。"}</p>
    {!!item.reasons.length && <p className="mt-2 text-xs leading-6 text-ink-3">命中：{item.reasons.slice(0,3).join("；")}</p>}
    <div className="mt-3 flex flex-wrap gap-2">{item.annotation.topics.slice(0,5).map(t=><span key={t} className="rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent-ink">{t}</span>)}</div>
  </article>;
}
