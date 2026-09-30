// 组织入驻：创建组织（生成 owner 令牌，只显示一次）、核验标记、加成员/换届移交。
import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import type { Route } from "./+types/orgs";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Input, Textarea } from "../../features/admin/ui";
import { bj } from "../../features/admin/format";

interface Org {
  id: number;
  name: string;
  intro: string | null;
  contact: string | null;
  verified: boolean;
  source_id: string | null;
  created_at: string;
  posts: number;
  members: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<{ items: Org[] }>(request, "/api/admin/orgs");
}

export const meta: Route.MetaFunction = () => [{ title: `组织 · ${SITE.name} 后台` }];

function TokenReveal({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-control border border-amber/30 bg-amber/10 p-3">
      <p className="text-[12.5px] font-medium text-amber">令牌只显示这一次，请立即发给组织负责人并妥善保存：</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded bg-surface px-2 py-1.5 text-[12px] text-ink">{token}</code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(token).then(() => setCopied(true));
          }}
        >
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
    </div>
  );
}

function CreateOrg() {
  const { run, pending } = useAdminAction();
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [contact, setContact] = useState("");
  const [token, setToken] = useState<string | null>(null);
  return (
    <Card title="创建组织">
      <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr]">
        <Input placeholder="组织名称（如：机器人俱乐部）" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="联系方式（负责人微信/邮箱）" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      <Textarea className="mt-2.5 min-h-[56px]" placeholder="组织简介（可选）" value={intro} onChange={(e) => setIntro(e.target.value)} />
      <div className="mt-3">
        <Button
          tone="primary"
          busy={pending === "create-org"}
          disabled={!name.trim()}
          onClick={async () => {
            const res = await run<{ ownerToken: string }>("POST", "/api/admin/orgs", { name, intro, contact }, { label: "create-org", success: "组织已创建" });
            if (res?.ownerToken) {
              setToken(res.ownerToken);
              setName("");
              setIntro("");
              setContact("");
            }
          }}
        >
          创建并生成 owner 令牌
        </Button>
      </div>
      {token && <TokenReveal token={token} />}
    </Card>
  );
}

function OrgCard({ o }: { o: Org }) {
  const { run, pending } = useAdminAction();
  const [memberName, setMemberName] = useState("");
  const [asOwner, setAsOwner] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {o.name}
          {o.verified ? <Badge tone="ok">经平台核验</Badge> : <Badge tone="warn">未核验</Badge>}
        </span>
      }
      right={
        <span className="num">
          {o.members} 名成员 · {o.posts} 条投稿 · 创建于 {bj(o.created_at, true)}
        </span>
      }
    >
      {o.intro && <p className="text-[13px] leading-relaxed text-ink-3">{o.intro}</p>}
      {o.contact && <p className="mt-1 text-[12.5px] text-ink-4">联系方式：{o.contact}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button
          size="sm"
          tone={o.verified ? "secondary" : "primary"}
          busy={!!pending}
          onClick={() => run("POST", `/api/admin/orgs/${o.id}/verify`, { verified: !o.verified }, { label: `verify-${o.id}`, success: o.verified ? "已取消核验" : "已核验" })}
        >
          {o.verified ? "取消核验" : "核验通过"}
        </Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Input className="!h-8 w-36 text-[12.5px]" placeholder="成员称呼" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
        <label className="flex items-center gap-1 text-[12.5px] text-ink-3">
          <input type="checkbox" checked={asOwner} onChange={(e) => setAsOwner(e.target.checked)} />
          设为 owner（换届移交）
        </label>
        <Button
          size="sm"
          busy={pending === `member-${o.id}`}
          onClick={async () => {
            const res = await run<{ token: string }>("POST", `/api/admin/orgs/${o.id}/members`, { name: memberName, role: asOwner ? "owner" : "editor" }, { label: `member-${o.id}`, success: "成员已添加" });
            if (res?.token) {
              setToken(res.token);
              setMemberName("");
              setAsOwner(false);
            }
          }}
        >
          加成员
        </Button>
      </div>
      {token && <TokenReveal token={token} />}
    </Card>
  );
}

export default function Orgs({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  return (
    <AdminPage title="组织" subtitle="组织入驻与核验。创建组织时生成 owner 令牌（只显示一次）；核验通过后组织才能投稿。">
      <div className="space-y-4">
        <CreateOrg />
        {items.length === 0 ? <Empty>还没有组织入驻。</Empty> : items.map((o) => <OrgCard key={o.id} o={o} />)}
      </div>
    </AdminPage>
  );
}
