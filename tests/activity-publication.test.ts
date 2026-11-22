import assert from "node:assert/strict";
import { test } from "node:test";
import { projectActivitySchedule, resolveActivitySchedule } from "@aihot/backend/publication/activity";
import type { TimelineCard } from "@aihot/contracts/site";

const time = (evidence: string, value: string | null = null, precision: "day" | "minute" | null = null) => ({ evidence, value, precision });
const activity = (name = "读书会", activityStart = time("11月24日19:00", "2026-11-24T19:00+08:00", "minute")) => ({ name, activityStart });
const editorial = (activities: unknown[] = [activity()]) => ({ kind: "activity_registration", evidence: "读书会开放报名", decision: "candidate", activities });

test("公开时间投影保留四端点、日期精度与不同场次，去除内部判断", () => {
  const raw = editorial([
    { ...activity(), registrationStart: time("即日起", "2026-11-20", "day"), registrationEnd: time("11月22日18:00", "2026-11-22T18:00+08:00", "minute"), activityEnd: time("21:00", "2026-11-24T21:00+08:00", "minute") },
    activity("工作坊", time("11月25日", "2026-11-25", "day")),
  ]);
  const schedule = projectActivitySchedule(raw);
  assert.deepEqual(schedule?.activities[0], {
    name: "读书会", registrationStart: { text: "即日起", value: "2026-11-20", precision: "day" },
    registrationEnd: { text: "11月22日18:00", value: "2026-11-22T18:00+08:00", precision: "minute" },
    activityStart: { text: "11月24日19:00", value: "2026-11-24T19:00+08:00", precision: "minute" },
    activityEnd: { text: "21:00", value: "2026-11-24T21:00+08:00", precision: "minute" },
  });
  assert.equal(schedule?.activities[1]?.name, "工作坊");
  assert.equal(schedule?.activities[1]?.activityEnd, undefined);
  assert.ok(!JSON.stringify(schedule).includes("candidate"));
});

test("回顾、公示、缺失与不合法存量结果不生成活动模块", () => {
  for (const raw of [undefined, null, {}, "bad", { ...editorial(), kind: "activity_summary", decision: "excluded" }, { ...editorial(), kind: "result", decision: "excluded" }, { ...editorial(), evidence: null }]) {
    assert.equal(projectActivitySchedule(raw), null);
  }
});

test("缺时刻不补钟点，报满即止与明确无需报名保留原文", () => {
  const schedule = projectActivitySchedule(editorial([{ ...activity(), registrationEnd: time("报满即止") }]));
  assert.deepEqual(schedule?.activities[0]?.registrationEnd, { text: "报满即止", value: null, precision: null });
  assert.equal(projectActivitySchedule(editorial([{ ...activity(), participation: "无需报名，直接到场" }]))?.activities[0]?.registrationNote, "无需报名");
  assert.equal(projectActivitySchedule(editorial())?.activities[0]?.registrationNote, undefined);
  assert.equal(projectActivitySchedule(editorial([{ ...activity(), registrationStart: time("即日起", "2026-11-20", "day"), participation: "扫码报名，报满即止" }]))?.activities[0]?.registrationNote, "报满即止");
  assert.equal(projectActivitySchedule(editorial([{ ...activity(), participation: "并非无需报名" }]))?.activities[0]?.registrationNote, undefined);
  assert.deepEqual(projectActivitySchedule(editorial([{ ...activity(), registrationEnd: time("11月22日", "2026-11-22", "day"), participation: "无需报名，直接到场" }])), { activities: [], notice: "时间待核实" });
});

test("变更按发布时间判定，明确恢复报名可解除更早取消且不拼端点", () => {
  const base = editorial();
  const cancelled = { kind: "activity_update", evidence: "读书会取消", decision: "review", update: "cancelled", activities: [{ name: "读书会" }] };
  const rescheduled = { ...cancelled, update: "rescheduled", evidence: "读书会延期" };
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: rescheduled, at: 3 }, { editorial: cancelled, at: 2 }], 1), { activities: [], notice: "时间待核实" });
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: cancelled, at: 2 }, { editorial: rescheduled, at: 3 }], 1), { activities: [], notice: "时间待核实" });
  const reopened = { ...editorial([activity("读书会", time("11月26日19:00", "2026-11-26T19:00+08:00", "minute"))]), evidence: "读书会恢复报名" };
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: cancelled, at: 2 }, { editorial: reopened, at: 3 }], 1), projectActivitySchedule(reopened));
  assert.deepEqual(resolveActivitySchedule(cancelled, [{ editorial: reopened, at: 3 }], 2), projectActivitySchedule(reopened), "代表稿本身为取消稿时亦能恢复");
});

test("同一发布时间无法确定变更先后时待核实，重复场次不能冒充全部取消", () => {
  const base = editorial();
  const cancelled = { kind: "activity_update", evidence: "读书会取消", decision: "review", update: "cancelled", activities: [{ name: "读书会" }] };
  const reopened = { ...editorial(), evidence: "读书会恢复报名" };
  const pending = { activities: [], notice: "时间待核实" };
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: cancelled, at: 1 }], 1), pending, "同日只有日期精度的取消不能被忽略");
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: cancelled, at: 2 }, { editorial: reopened, at: 2 }], 1), pending);
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: reopened, at: 2 }, { editorial: cancelled, at: 2 }], 1), pending);
  const duplicate = { ...cancelled, activities: [{ name: "读书会" }, { name: "读书会" }] };
  assert.deepEqual(resolveActivitySchedule(editorial([activity(), activity("工作坊")]), [{ editorial: duplicate, at: 2 }], 1), pending);
});

test("待核验及反向、不合法日期只能提示核实，不公开伪造时间", () => {
  assert.deepEqual(projectActivitySchedule({ ...editorial(), decision: "review" }), { activities: [], notice: "时间待核实" });
  const invalid = editorial([activity("读书会", time("2月30日", "2026-02-30", "day"))]);
  assert.deepEqual(projectActivitySchedule(invalid), { activities: [], notice: "时间待核实" });
  const reversed = editorial([{ ...activity(), activityEnd: time("18:00", "2026-11-24T18:00+08:00", "minute") }]);
  assert.deepEqual(projectActivitySchedule(reversed), { activities: [], notice: "时间待核实" });
});

test("同组同名较新取消/延期使旧时间失效，其他活动或旧通知不影响", () => {
  const base = editorial();
  const update = { kind: "activity_update", evidence: "读书会取消", decision: "review", update: "cancelled", activities: [{ name: "读书会" }] };
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: update, at: 2 }], 1), { activities: [], notice: "活动已取消" });
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: { ...update, update: "rescheduled" }, at: 2 }], 1), { activities: [], notice: "时间待核实" });
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: { ...update, activities: [{ name: "工作坊" }] }, at: 2 }], 1), projectActivitySchedule(base));
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: update, at: 0 }], 1), projectActivitySchedule(base));
});

test("同名不同安排不跨文章拼端点，部分场次取消不宣布整篇取消", () => {
  const base = editorial();
  const newer = editorial([activity("读书会", time("11月25日19:00", "2026-11-25T19:00+08:00", "minute"))]);
  assert.deepEqual(resolveActivitySchedule(base, [{ editorial: newer, at: 2 }], 1), { activities: [], notice: "时间待核实" });
  const cancelled = { kind: "activity_update", evidence: "读书会取消", decision: "review", update: "cancelled", activities: [{ name: "读书会" }] };
  assert.deepEqual(resolveActivitySchedule(editorial([activity(), activity("工作坊")]), [{ editorial: cancelled, at: 2 }], 1), { activities: [], notice: "时间待核实" });
});

test("精选读取只使用已发布且当前版本的分析，撤回、未放行和非精选均不泄漏时间", {
  skip: !/_(?:test|ci)$/.test(new URL(process.env.DATABASE_URL ?? "postgres://unset/unset").pathname.slice(1)),
}, async (t) => {
  const { tag } = await import("./setup.ts");
  const { sql, closeDb } = await import("@aihot/backend/db");
  const { stopBoss } = await import("@aihot/backend/jobs/queue");
  const { upsertMaterial } = await import("@aihot/backend/content/materials");
  const { publishArticle } = await import("@aihot/backend/publication/publish");
  const { loadTimeline } = await import("@aihot/backend/publication/timeline");
  const { loadActivitySchedules } = await import("@aihot/backend/publication/activity");
  const { buildApp } = await import("../apps/api/src/app.ts");
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBoss(); await closeDb(); });
  const source = `activity-publication-${tag()}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${source}, '活动时间测试', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const now = new Date();
  const { articleId: id } = await upsertMaterial({
    sourceId: source, url: `https://example.invalid/${source}`, title: "读书会开放报名", bodyText: "读书会开放报名，活动11月24日19:00开始。",
    bodyStatus: "ok", via: "fetch", publishedAt: new Date(now.getTime() - 60_000),
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, selected, output)
    VALUES (${id}, 1, 'rule', 'pass', '读书会开放报名', true, ${sql.json({ editorial: editorial() } as never)})`;
  await publishArticle(id, { now, releasedAt: new Date(now.getTime() - 30_000) });
  const filters = { channel: "all" as const, category: null, tag: null, sources: [source] };
  const first = await loadTimeline({ ...filters, now });
  const card = first.cards[0]!;
  assert.equal(card.item.id, id);
  assert.equal(card.item.activitySchedule?.activities[0]?.activityStart?.value, "2026-11-24T19:00+08:00");
  const response = await app.inject({ method: "GET", url: `/api/site/timeline?sources=${source}` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().cards[0]?.item.activitySchedule?.activities[0]?.activityStart?.value, "2026-11-24T19:00+08:00");
  const read = (cards: TimelineCard[] = [card]) => loadActivitySchedules(cards, filters, now);

  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
    VALUES (${id}, 1, 'rule', 'pass', true, ${sql.json({ editorial: { ...editorial(), kind: "activity_update", update: "cancelled", decision: "review" } } as never)})`;
  assert.deepEqual((await read()).get(id), card.item.activitySchedule, "未发布的新判断不能改变公开时间");
  await sql`UPDATE publications SET selected = false WHERE article_id = ${id}`;
  assert.equal((await read()).has(id), false);
  await sql`UPDATE publications SET selected = true, visibility = 'withdrawn' WHERE article_id = ${id}`;
  assert.equal((await read()).has(id), false);
  await sql`UPDATE publications SET visibility = 'public', visible_after = ${new Date(now.getTime() + 60_000)} WHERE article_id = ${id}`;
  assert.equal((await read()).has(id), false);
  await sql`UPDATE publications SET visible_after = ${new Date(now.getTime() - 30_000)} WHERE article_id = ${id}`;
  await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${id}`;
  assert.equal((await read()).has(id), false, "正文更新、分析未重做时不显示旧时间");

  await sql`UPDATE articles SET revision = 1 WHERE id = ${id}`;
  const publicId = crypto.randomUUID();
  const [story] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at)
    VALUES (${publicId}, '读书会时间调整测试', ${new Date(now.getTime() - 60_000)}, ${now}) RETURNING id`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title)
    VALUES (${`activity-${publicId}`}, ${story!.id}, '读书会开放报名') RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
  await sql`UPDATE publications SET story_id = ${story!.id}, fact_id = ${fact!.id} WHERE article_id = ${id}`;
  const { articleId: updateId } = await upsertMaterial({
    sourceId: source, url: `https://example.invalid/${source}/cancelled`, title: "读书会取消", bodyText: "读书会取消。",
    bodyStatus: "ok", via: "fetch", publishedAt: new Date(now.getTime() - 1_000),
  });
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${updateId}, 'report')`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, selected, output)
    VALUES (${updateId}, 1, 'rule', 'pass', '读书会取消', false, ${sql.json({ editorial: { kind: "activity_update", evidence: "读书会取消", decision: "review", update: "cancelled", activities: [{ name: "读书会" }] } })})`;
  await publishArticle(updateId, { now, releasedAt: new Date(now.getTime() - 1_000) });
  assert.deepEqual((await loadTimeline({ ...filters, now })).cards[0]?.item.activitySchedule, { activities: [], notice: "活动已取消" }, "公开同组取消使代表稿旧安排失效");
  await sql`UPDATE publications SET selected = true, visible_after = ${new Date(now.getTime() + 60_000)} WHERE article_id = ${updateId}`;
  assert.deepEqual((await loadTimeline({ ...filters, now })).cards[0]?.item.activitySchedule, card.item.activitySchedule, "未放行变更不泄漏");
  await sql`UPDATE publications SET selected = false, visibility = 'withdrawn' WHERE article_id = ${updateId}`;
  assert.deepEqual((await loadTimeline({ ...filters, now })).cards[0]?.item.activitySchedule, card.item.activitySchedule, "已撤回变更不影响公开安排");

  for (let i = 0; i < 101; i++) {
    const { articleId: relatedId } = await upsertMaterial({
      sourceId: source, url: `https://example.invalid/${source}/related-${i}`, title: `同组活动${i}报名`, bodyText: "时间安排见原文。",
      bodyStatus: "ok", via: "fetch", publishedAt: new Date(now.getTime() - 500),
    });
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${relatedId}, 'report')`;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, selected, output)
      VALUES (${relatedId}, 1, 'rule', 'pass', ${`同组活动${i}报名`}, false, ${sql.json({ editorial: editorial([activity(`另一活动${i}`)]) } as never)})`;
    await publishArticle(relatedId, { now, releasedAt: new Date(now.getTime() - 500) });
  }
  assert.deepEqual((await loadTimeline({ ...filters, now })).cards[0]?.item.activitySchedule, { activities: [], notice: "时间待核实" }, "组内相关活动超过受控数量时不能把截断证据视为完整安排");
});
