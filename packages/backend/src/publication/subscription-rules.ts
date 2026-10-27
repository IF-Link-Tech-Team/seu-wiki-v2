import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import type { SubscriptionAnnotation, SubscriptionEvidence, SubscriptionProfile } from "@aihot/contracts/subscription";
import { OPTIMIZED_TOPIC_GROUPS, OPTIMIZED_TOPIC_NAMES } from "@aihot/industry/subscription-onboarding";

const tags = TAX.tags as readonly { id: string; label: string; dimension: string; reserved: boolean }[];
const groups = TAX.groups as readonly { id: string; label: string; dimension: string; terms: readonly string[] }[];
const topicNames = new Set(tags.filter(t => t.dimension === "topic").map(t => t.label));
const collegeNames = groups.find(g => g.id === "group:12")!.terms.map(id => id.slice(id.indexOf(":") + 1));
const aliases: Record<string, string[]> = {
  "AI/机器学习": ["人工智能", "机器学习", "深度学习", "AI"], "SRTP": ["大学生科研训练计划"],
  "大创": ["大学生创新创业训练计划"], "国家留学基金": ["国家留学基金委", "CSC"],
  "国自然": ["国家自然科学基金"], "社科基金": ["国家社会科学基金"],
  "秋招春招": ["秋季招聘", "春季招聘", "秋招", "春招"],
  "防诈骗": ["反诈", "防范电信诈骗"], "至善/校长奖学金": ["至善奖学金", "校长奖学金"],
  "困难补助": ["临时困难资助", "临时困难补助", "困难补助"],
  "丁家桥": ["丁家桥校区"], "学生处（党委学工部）": ["学生处", "党委学工部", "学生工作处"],
  "就业指导中心": ["就业中心", "学生就业指导中心"], "网络与信息中心": ["网络信息中心"],
  "经济管理学院": ["经管"], "外国语学院": ["外国语"], "计算机科学与工程学院": ["计算机"],
  "信息科学与工程学院": ["信息学院"], "电子科学与工程学院": ["电子学院"],
  "生物科学与医学工程学院": ["生医"], "仪器科学与工程学院": ["仪科学院"],
  "能源与环境学院": ["能环"], "化学化工学院": ["化工"], "网络空间安全学院": ["网安"],
};

/** Accept only dictionary IDs; groups expand to leaves, never to identity constraints. */
export function normalizeSubscriptionProfile(raw: unknown): SubscriptionProfile {
  const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const optimized = p.mode === "interest" || p.mode === "identity_all";
  const selectedGroups = optimized && Array.isArray(p.topicGroups) ? OPTIMIZED_TOPIC_GROUPS.filter(g => (p.topicGroups as unknown[]).includes(g.id)) : [];
  function list(key: string, dimension: string) {
    const input = Array.isArray(p[key]) ? p[key].filter(x => typeof x === "string").slice(0, 250) as string[] : [];
    if (key === "interests") input.push(...selectedGroups.flatMap(g => g.subgroups.flatMap(s => s.tags.map(t => `topic:${t}`))));
    const expanded = input.flatMap(id => groups.find(g => g.id === id && g.dimension === dimension)?.terms ?? (id === "topic:评优评先" ? [id, "topic:优秀毕业生", "topic:三好学生"] : [id]));
    return [...new Set(expanded)].filter(id => tags.some(t => t.id === id && t.dimension === dimension && (!t.reserved || (optimized && dimension === "topic" && OPTIMIZED_TOPIC_NAMES.has(t.label)))));
  }
  return {
    degree: ["本科生", "硕士生", "博士生"].includes(String(p.degree)) ? String(p.degree) : "",
    college: collegeNames.includes(String(p.college)) ? String(p.college) : "",
    enrollmentYear: /^20\d{2}$/.test(String(p.enrollmentYear)) ? String(p.enrollmentYear) : "",
    international: ["yes", "no"].includes(String(p.international)) ? String(p.international) : "",
    interests: list("interests", "topic"), publishers: list("publishers", "publisher"), types: list("types", "type"),
    identityNotices: p.identityNotices === true,
    ...(optimized ? { mode: p.mode as "interest" | "identity_all", followOwnCollege: p.followOwnCollege === true,
      topicGroups: selectedGroups.map(g => g.id), excludedTypes: list("excludedTypes", "type"), excludedLocations: list("excludedLocations", "location") } : {}),
  };
}

function contains(text: string, word: string) {
  if (/^[A-Za-z0-9/+]+$/.test(word)) return new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i").test(text);
  return text.includes(word);
}
function snippet(text: string, word: string) {
  const i = Math.max(0, text.toLowerCase().indexOf(word.toLowerCase()));
  return text.slice(Math.max(0, i - 18), i + word.length + 35);
}

/** Deterministic local baseline: evidence only from public title/summary and source name.
 * This is not the model annotator and does not claim complete audience/deadline extraction. */
export function annotateSubscription(input: { title: string; summary: string | null; source: string }, optimized = false): SubscriptionAnnotation {
  const title = input.title;
  const summary = input.summary ?? "";
  const text = `${title}。${summary}`;
  const evidence: SubscriptionEvidence[] = [];
  const warnings: string[] = [];
  const source = input.source.replace(/（本地快照）$/, "");
  const hit = (label: string, words = [label, ...(aliases[label] ?? [])], sourceOnly = false) => {
    const fields = sourceOnly ? [["来源", source]] : [["标题", title], ["摘要", summary]];
    for (const [field, value] of fields) for (const word of words) if (contains(label === "AI/机器学习" ? value.replace(/人工智能学院/g, "") : value, word)) {
      evidence.push({ tag: label, field, quote: snippet(value, word) }); return true;
    }
    return false;
  };
  // Category names are never a fallback for topics; every hit retains its text evidence.
  const topics = tags.filter(t => t.dimension === "topic" && (!t.reserved || (optimized && OPTIMIZED_TOPIC_NAMES.has(t.label))) && hit(t.label)).map(t => t.label);
  const publishers = tags.filter(t => t.dimension === "publisher" && hit(t.label, undefined, true)).map(t => t.label);
  const locations = tags.filter(t => t.dimension === "location" && hit(t.label)).map(t => t.label);
  const formats = hit("线上", ["线上", "腾讯会议", "在线参加"]) ? ["线上"] : [];
  const actions = ([ ["截止提醒", ["截止", "截至"]], ["报名", ["报名"]], ["变更延期", ["延期", "变更", "更正"]], ["招新", ["招新"]] ] as [string, string[]][]).filter(([l,w]) => hit(l,w)).map(([l]) => l);
  // Types are inferred from title only, with result/report taking precedence over notification.
  const typeRules: [string, RegExp][] = [
    ["结果公示", /公示|获奖名单|评选结果|结果公布/],
    ["新闻报道", /成功举办|顺利举行|圆满|获批|荣获|来访|回顾|纪实|签约|^(?!.*(?:通知|预告|报名|关于|将|拟|即将|困难资助|困难补助)).*(?:举办|举行|召开|启动|组织参加|开展|莅临|座谈)/],
    ["指南说明", /指南|操作说明|办事流程|常见问题|攻略/],
    ["活动预告", /预告|讲座|讲堂|学术报告|宣讲会|双选会|活动报名|关于召开|关于举办/],
    ["机会招募", /招募|招新|招聘|申报|申请|报名|招生|选拔/],
    ["事务通知", /通知|提醒|安排|办理|注册|选课|停水|停电|困难资助|困难补助/],
  ];
  const typeHit = typeRules.find(([,re]) => re.test(title));
  const types = typeHit ? [typeHit[0]] : [];
  if (typeHit) evidence.push({ tag: typeHit[0], field: "标题类型规则", quote: title });

  // Capture only a contiguous explicit audience clause. Mentions elsewhere, publishers and
  // historical news about students never become eligibility constraints.
  const clauses = [...text.matchAll(/(?<!不|非)(?:仅限|面向|(?:适用|参加|申报|申请|报名|资助)对象(?:\s*[：:]\s*|为|是|包括)?)([^。；;，,\n]{1,100})/g)].map(m => m[1]);
  const degrees: string[] = [], colleges: string[] = [], years: string[] = [];
  let schoolwide = false, internationalOnly = false, staffOnly = false;
  for (const clause of clauses) {
    // Ambiguous negation / alternatives require review rather than exclusion.
    if (/不含|除|不限|或.*条件|非.*生|20\d{2}[至—-]/.test(clause) || /学院.*本科.*学院.*硕士|学院.*硕士.*学院.*本科/.test(clause)) { warnings.push("受众条件含例外或组合，请核对原文"); continue; }
    let found = false;
    if (/(?:任课老师|任课教师|教职工|辅导员|各位教师)/.test(clause) && !/学生|同学|师生/.test(clause.replace(/研究生/g,""))) {
      staffOnly = true; evidence.push({ tag: "教职工对象", field: "明确对象句", quote: clause }); continue;
    }
    for (const degree of ["本科生", "硕士生", "博士生"]) if (clause.includes(degree) || clause.includes(degree.replace("生", "研究生"))) { degrees.push(degree); found = true; }
    if (clause.includes("研究生") && !/硕士|博士/.test(clause)) { degrees.push("硕士生", "博士生"); found = true; }
    for (const college of collegeNames) if (clause.includes(college)) { colleges.push(college); found = true; }
    for (const m of clause.matchAll(/(20\d{2})级/g)) { years.push(m[1]); found = true; }
    if (/(?:^|\D)\d{2}级/.test(clause)) warnings.push("入学年份使用简称，需人工核对");
    if (/全校(?:师生|学生|同学)?|全体学生/.test(clause)) { schoolwide = true; found = true; }
    if (/留学生/.test(clause)) { internationalOnly = true; found = true; }
    if (found) evidence.push({ tag: "适用对象", field: "标题/摘要明确对象句", quote: clause });
    if (/已进入|全日制|非全日制|定向|应届|毕业生|贫困|困难|资格|符合条件|体系/.test(clause)) warnings.push("有画像尚未覆盖的附加资格条件");
    if (/(?:本院|学院)(?:在籍|全体|全日制|学生|同学|本科|研究生)/.test(clause) && !colleges.length) {
      const named = collegeNames.filter(c => publishers.includes(c) || title.includes(c));
      if (named.length === 1) { colleges.push(named[0]); evidence.push({ tag: "适用学院", field: "对象句指代 + 来源/标题", quote: `${clause}；${named[0]}` }); }
      else warnings.push("对象句中的学院指代待核对");
    }
  }
  if (clauses.length && !schoolwide && !colleges.length && publishers.some(p => collegeNames.includes(p))) warnings.push("学院发布的对象句未明确是否跨院开放");
  if (schoolwide && publishers.includes("成贤学院")) warnings.push("全校的学校范围需核对（成贤学院信源）");
  if (/具体.*资格|符合条件者|资格.*附件/.test(text)) warnings.push("具体资格仍需核对附件或原文");
  // Full date immediately linked to deadline only; never infer from publication/event dates.
  let deadline: string | null = null;
  const dates = [...text.matchAll(/(?:报名|申请|申报|提交|办理)?(?:截止(?:时间|日期)?|截至)[为至到：:\s]*(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/g)];
  const candidates = [...new Set(dates.map(m => `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`))];
  if (candidates.length === 1 && Number.isFinite(Date.parse(candidates[0])) && new Date(candidates[0]).toISOString().slice(0,10) === candidates[0]) {
    deadline = candidates[0]; evidence.push({ tag: "截止日期", field: "标题/摘要明确日期", quote: dates[0][0] });
  } else if (actions.includes("截止提醒")) warnings.push("截止时间未能可靠提取，请核对原文");
  if (!deadline && /须[于在]|申请时间|报名时间|提交[^。]{0,15}前/.test(text)) warnings.push("办理或报名时段未完整提取，请核对原文");
  if (actions.includes("变更延期")) { deadline = null; warnings.push("含变更或延期，最新截止时间需核对原文"); }
  if (!summary || /暂未获取|未获取到|暂无摘要/.test(summary)) warnings.push("摘要缺失或不可用");
  if (!topics.length) warnings.push("尚未识别主题，需人工标注");
  if (!degrees.length && !colleges.length && !years.length && !schoolwide && !internationalOnly && !staffOnly) warnings.push("适用对象未明确");
  if (!types.length) warnings.push("内容类型待确认");
  return { version: TAX.version, topics: [...new Set(topics)], publishers, types, actions, locations, formats,
    audience: { degrees: [...new Set(degrees)], colleges: [...new Set(colleges)], years: [...new Set(years)], schoolwide, internationalOnly, staffOnly },
    deadline, evidence, warnings: [...new Set(warnings)] };
}

export function matchSubscription(a: SubscriptionAnnotation, p: SubscriptionProfile, asOf: string): { lane: "matched" | "possible" | "excluded"; reasons: string[] } {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const uncertain: string[] = [];
  const audience = a.audience;
  if (audience.staffOnly) conflicts.push("明确面向教职工，本订阅面向在校学生");
  for (const [label, allowed, value] of [["培养层次", audience.degrees, p.degree], ["适用学院", audience.colleges, p.college], ["入学年份", audience.years, p.enrollmentYear]] as const) {
    if (!allowed.length) continue;
    if (!value) uncertain.push(`${label}未填写，无法核对`);
    else if (!allowed.includes(value)) conflicts.push(`${label}不符合（要求：${allowed.join("、")}）`);
  }
  if (audience.internationalOnly && p.international !== "yes") {
    if (p.international === "no") conflicts.push("仅面向留学生"); else uncertain.push("留学生身份未填写");
  }
  const interestHits = a.topics.filter(t => p.interests.includes(`topic:${t}`));
  const sourceHits = a.publishers.filter(t => p.publishers.includes(`publisher:${t}`) || (p.followOwnCollege && p.college === t));
  if (interestHits.length) reasons.push(`兴趣：${interestHits.join("、")}`);
  if (sourceHits.length) reasons.push(`关注机构：${sourceHits.join("、")}`);
  const identityHit = (audience.schoolwide || (p.degree && audience.degrees.includes(p.degree)) || (p.college && audience.colleges.includes(p.college)) || (p.enrollmentYear && audience.years.includes(p.enrollmentYear)) || (audience.internationalOnly && p.international === "yes"));
  const identityNotice = p.identityNotices && identityHit && conflicts.length === 0 && a.types.includes("事务通知");
  if (identityNotice) reasons.push("明确面向你的事务通知");
  if (p.mode === "identity_all") reasons.push("已开启接收兴趣之外的信息，仍核对身份与排除条件");
  if (!reasons.length) conflicts.push("未命中兴趣、关注机构或身份事务通知");
  if (p.excludedTypes?.length) {
    const excluded = a.types.filter(t => p.excludedTypes!.includes(`type:${t}`));
    if (excluded.length) conflicts.push(`已排除内容类型：${excluded.join("、")}`);
    if (!a.types.length) uncertain.push("内容类型待确认，暂不能核对类型排除条件");
  }
  if (p.excludedLocations?.length && !a.formats.includes("线上")) {
    const excluded = a.locations.filter(t => p.excludedLocations!.includes(`location:${t}`));
    const allowed = a.locations.filter(t => !p.excludedLocations!.includes(`location:${t}`));
    if (excluded.length && !allowed.length) conflicts.push(`已排除线下校区：${excluded.join("、")}`);
    else if (excluded.length) uncertain.push("消息涉及多个校区，部分在排除范围内，请核对参与地点");
    else if (!a.locations.length) uncertain.push("校区未明确，暂不能核对线下校区排除条件");
  }
  if (p.types.length && a.types.length && !a.types.some(t => p.types.includes(`type:${t}`))) conflicts.push("不属于所选内容类型");
  if (p.types.length && !a.types.length) uncertain.push("内容类型待确认");
  if (a.deadline && a.deadline < asOf && a.types.some(t => ["机会招募", "事务通知", "活动预告"].includes(t))) conflicts.push(`办理或报名已截止（${a.deadline}）`);
  if (conflicts.length) return { lane: "excluded", reasons: [...conflicts, ...reasons] };
  if (!audience.schoolwide && !audience.degrees.length && !audience.colleges.length && !audience.years.length && !audience.internationalOnly) uncertain.push("适用对象未明确");
  uncertain.push(...a.warnings);
  return { lane: uncertain.length ? "possible" : "matched", reasons: [...reasons, ...new Set(uncertain)] };
}

export const subscriptionCollegeNames = collegeNames;
export const subscriptionTopicNames = topicNames;
