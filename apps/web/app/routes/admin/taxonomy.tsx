// 词表：运行时兴趣词表的管理——候选队列（模型/组织提议，≥3 次才出现）三操作（批准选分组 /
// 设为别名 / 拒绝），当前词表按分组展示，手动加词直接 active。
import { SITE } from "@aihot/industry/site";
import { TOPIC_GROUPS } from "@aihot/industry/taxonomy";
import { useState } from "react";
import type { Route } from "./+types/taxonomy";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Input, Select } from "../../features/admin/ui";
import { bj } from "../../features/admin/format";

interface Term {
  id: number;
  grp: string;
  name: string;
  aliases: string[];
  status: string;
  source: "seed" | "model" | "org" | "admin";
  count: number;
  examples: string[];
}

const SOURCE_LABEL: Record<string, string> = { seed: "种子", model: "模型", org: "组织", admin: "管理员" };

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<{ terms: Term[]; candidates: Term[]; guide: string }>(request, "/api/admin/taxonomy");
}

export const meta: Route.MetaFunction = () => [{ title: `词表 · ${SITE.name} 后台` }];

function CandidateCard({ t, terms }: { t: Term; terms: Term[] }) {
  const { run, pending } = useAdminAction();
  const [grp, setGrp] = useState<string>(TOPIC_GROUPS[0]!.label);
  const [target, setTarget] = useState("");
  const busy = !!pending;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-ink">{t.name}</span>
        <Badge tone="warn">{t.count} 次提议</Badge>
        <Badge tone="muted">{SOURCE_LABEL[t.source] ?? t.source}</Badge>
        {t.examples.filter((e) => e.startsWith("/items/")).map((e) => (
          <a key={e} href={e} className="text-[12.5px] text-accent hover:underline">示例内容</a>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Select aria-label="批准到分组" value={grp} onChange={(e) => setGrp(e.target.value)}>
          {TOPIC_GROUPS.map((g) => (
            <option key={g.key} value={g.label}>{g.label}</option>
          ))}
        </Select>
        <Button tone="primary" size="sm" busy={busy} onClick={() => run("POST", `/api/admin/taxonomy/${t.id}/approve`, { grp }, { label: `approve-${t.id}`, success: `「${t.name}」已进词表，回填任务已排` })}>
          批准
        </Button>
        <Select aria-label="设为别名的主词" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">设为别名到…</option>
          {terms.map((x) => (
            <option key={x.id} value={x.name}>{x.name}</option>
          ))}
        </Select>
        <Button size="sm" busy={busy} disabled={!target} onClick={() => run("POST", `/api/admin/taxonomy/${t.id}/alias`, { target }, { label: `alias-${t.id}`, success: `「${t.name}」已归到「${target}」` })}>
          设为别名
        </Button>
        <Button tone="danger" size="sm" busy={busy} onClick={() => run("POST", `/api/admin/taxonomy/${t.id}/reject`, {}, { label: `reject-${t.id}`, success: "已拒绝，同词不再进候选池" })}>
          拒绝
        </Button>
      </div>
    </Card>
  );
}

function AddTerm() {
  const { run, pending } = useAdminAction();
  const [name, setName] = useState("");
  const [grp, setGrp] = useState<string>(TOPIC_GROUPS[0]!.label);
  return (
    <Card title="手动加词">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="!h-8 w-48 text-[12.5px]" placeholder="主题词（如：嵌入式）" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={grp} onChange={(e) => setGrp(e.target.value)}>
          {TOPIC_GROUPS.map((g) => (
            <option key={g.key} value={g.label}>{g.label}</option>
          ))}
        </Select>
        <Button tone="primary" size="sm" busy={pending === "add-term"} disabled={name.trim().length < 2} onClick={async () => {
          const res = await run("POST", "/api/admin/taxonomy", { name, grp }, { label: "add-term", success: `「${name}」已加入词表` });
          if (res) setName("");
        }}>
          加入词表
        </Button>
      </div>
    </Card>
  );
}

export default function Taxonomy({ loaderData }: Route.ComponentProps) {
  const { terms, candidates, guide } = loaderData;
  const groups = TOPIC_GROUPS.map((g) => ({ ...g, terms: terms.filter((t) => t.grp === g.label) }));
  return (
    <AdminPage title="词表" subtitle={guide}>
      <div className="space-y-4">
        <Card title={`候选队列（同一词被提议满 3 次才出现在这里）`}>
          {candidates.length === 0 ? <Empty>没有待审核的候选词。</Empty> : <div className="space-y-3">{candidates.map((t) => <CandidateCard key={t.id} t={t} terms={terms} />)}</div>}
        </Card>
        <AddTerm />
        <Card title="当前词表">
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.key} className="flex items-start gap-3">
                <span className="mt-1 w-20 shrink-0 text-[12px] text-ink-4">{g.label}</span>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {g.terms.map((t) => (
                    <span key={t.id} className="inline-flex items-center rounded-full bg-bg-sunk px-2.5 py-1 text-[12.5px] text-ink-2 ring-1 ring-line">
                      {t.name}
                      {t.aliases.length > 0 && <span className="ml-1 text-ink-4">（别名：{t.aliases.join("、")}）</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AdminPage>
  );
}
