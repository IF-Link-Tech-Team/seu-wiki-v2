import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBSCRIPTION_TAXONOMY as tax } from "@aihot/industry/subscription-v2";
import { annotateSubscription as annotate, matchSubscription as match, normalizeSubscriptionProfile as profile } from "@aihot/backend/publication/subscription-rules";

const day="2026-10-25";
const p=profile({degree:"本科生",college:"计算机科学与工程学院",enrollmentYear:"2023",international:"no",interests:["topic:AI/机器学习"],identityNotices:true});
const item=(summary:string|null,title="人工智能讲座预告",source="自动化学院")=>annotate({title,summary,source});
test("v2 dictionary preserves leaves, deduplicates shared terms, separates navigation and format",()=>{
  const ids=tax.tags.map(t=>t.id);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,227);
  assert.ok(ids.includes("location:丁家桥"));assert.ok(ids.includes("location:江北校区"));assert.ok(ids.includes("topic:入党"));
  assert.ok(ids.includes("format:线上"));assert.equal(ids.filter(id=>id==="topic:创新创业").length,1);
});
test("navigation selection expands without inferring undergraduate eligibility",()=>{
  const q=profile({interests:["group:1.1 本科教学"]});assert.ok(q.interests.includes("topic:选课"));assert.equal(q.degree,"");
  assert.ok(profile({interests:["topic:评优评先"]}).interests.includes("topic:优秀毕业生"));
});
test("reject unknown IDs, wrong dimensions, reserved terms and duplicate selections",()=>{
  const q=profile({degree:"教授",interests:["unknown","publisher:教务处","topic:社团招新","topic:保研","topic:保研"]});
  assert.deepEqual(q.interests,["topic:保研"]);assert.equal(q.degree,"");assert.deepEqual(profile(null).interests,[]);
});
test("schoolwide AI lecture matches any college; publisher is not audience",()=>{
  const a=item("面向全校学生。欢迎参与。");assert.deepEqual(a.publishers,["自动化学院"]);assert.deepEqual(a.audience.colleges,[]);
  assert.equal(match(a,p,day).lane,"matched");
});
test("interest is OR and content type is an additional AND",()=>{
  const a=item("面向全校学生。欢迎参加。");
  assert.equal(match(a,profile({...p,interests:["topic:保研","topic:AI/机器学习"]}),day).lane,"matched");
  assert.equal(match(a,profile({...p,types:["type:机会招募"]}),day).lane,"excluded");
});
test("publisher follow can match independently of interest",()=>{
  const a=item("面向全校学生。欢迎参加。","学术报告预告");
  assert.equal(match(a,profile({...p,interests:[],publishers:["publisher:自动化学院"]}),day).lane,"matched");
});
test("explicit incompatible degree overrides even matching interest and publisher",()=>{
  const a=item("仅限硕士研究生。欢迎报名。");
  const r=match(a,profile({...p,publishers:["publisher:自动化学院"]}),day);assert.equal(r.lane,"excluded");assert.match(r.reasons.join(" "),/培养层次/);
});
test("explicit college and intake restrictions are conjunctive; multi degrees are OR",()=>{
  const a=item("面向自动化学院2024级本科生及硕士生。欢迎参与。");
  assert.equal(match(a,p,day).lane,"excluded");
  assert.equal(match(a,profile({...p,college:"自动化学院",degree:"硕士生",enrollmentYear:"2024"}),day).lane,"matched");
});
test("unknown audience and missing profile do not masquerade as confirmed",()=>{
  assert.equal(match(item("欢迎报名参加。"),p,day).lane,"possible");
  assert.equal(match(item("面向硕士生。欢迎参与。"),profile({...p,degree:""}),day).lane,"possible");
});
test("identity notification opt-in works without interest; news does not auto-enter",()=>{
  const a=item("面向本科生。请按时操作。","选课通知","教务处");
  assert.equal(match(a,profile({...p,interests:[]}),day).lane,"matched");
  assert.equal(match(a,profile({...p,interests:[],identityNotices:false}),day).lane,"excluded");
  assert.equal(match(item("面向本科生。已顺利结束。","选课工作圆满完成"),profile({...p,interests:[]}),day).lane,"excluded");
});
test("student mentions in news never become audience constraints",()=>{
  assert.deepEqual(item("博士生王同学作报告。","人工智能研讨会成功举办").audience.degrees,[]);
});
test("explicit deadline expires after local date ends, not at its beginning",()=>{
  const a=item("面向全校学生。报名截止2026年10月25日。","人工智能项目报名");
  assert.equal(a.deadline,day);assert.equal(match(a,p,day).lane,"matched");assert.equal(match(a,p,"2026-10-26").lane,"excluded");
});
test("event dates, invalid dates and extension ambiguity never trigger false expiry",()=>{
  assert.equal(item("面向全校学生。活动在2026年10月20日举行。").deadline,null);
  assert.equal(item("面向全校学生。截止2026年2月30日。").deadline,null);
  const a=item("面向全校学生。原报名截止2026年10月1日，现延期。","人工智能报名延期通知");
  assert.equal(a.deadline,null);assert.equal(match(a,p,day).lane,"possible");
});
test("exceptions, mixed eligibility and year ranges require manual verification",()=>{
  for(const text of ["面向除本科生以外的全体学生。", "面向2023至2025级本科生。", "面向计算机科学与工程学院本科生或自动化学院硕士生。"]){
    const a=item(text);assert.ok(a.warnings.length);assert.equal(match(a,p,day).lane,"possible");
  }
});
test("international eligibility is distinct from degree",()=>{
  const a=item("仅限留学生。欢迎报名。","人工智能讲座预告","国际合作处");assert.equal(match(a,p,day).lane,"excluded");
  assert.equal(match(a,profile({...p,international:"yes"}),day).lane,"matched");
});
test("empty preferences never subscribe to everything",()=>{
  assert.equal(match(item("面向全校学生。欢迎参与。"),profile({}),day).lane,"excluded");
});
test("missing summary and unknown type remain uncertain, and sources are independent",()=>{
  const a=item(null);assert.equal(match(a,p,day).lane,"possible");assert.ok(a.warnings.includes("摘要缺失或不可用"));
  assert.deepEqual(item("欢迎关注。","学院风采","人工智能学院").topics,[]);
});
test("topic evidence records exact source text and English abbreviations respect boundaries",()=>{
  const a=item("面向全校学生。介绍深度学习方法。");assert.ok(a.evidence.some(e=>e.tag==="AI/机器学习"&&e.quote.includes("人工智能")));
  assert.ok(!item("介绍 XSRTPX。","技术分享").topics.includes("SRTP"));
});
test("real snapshot regression: course teachers are not the graduate students they teach",()=>{
  const a=item("艺术学院面向研究生任课老师发布提醒，公共课即将开课。","研究生课表开课提醒","艺术学院");
  assert.ok(a.audience.staffOnly);assert.equal(match(a,profile({...p,degree:"硕士生",publishers:["publisher:艺术学院"]}),day).lane,"excluded");
});
test("real snapshot regression: programme qualification cannot be satisfied by intake year alone",()=>{
  const a=item("东南大学面向2025级已进入硕博贯通培养体系的学生开展考核。","博士资格考核通知","研究生招生网");
  assert.equal(match(a,profile({...p,enrollmentYear:"2025"}),day).lane,"possible");
});
test("real snapshot regression: explicit college pronoun resolves to named college, not all undergraduates",()=>{
  const a=item("面向学院在籍全日制本科生申报。","经济管理学院奖助学金评审通知","经管·学生通知");
  assert.deepEqual(a.audience.colleges,["经济管理学院"]);assert.equal(match(a,p,day).lane,"excluded");
  assert.ok(!match(a,p,day).reasons.includes("明确面向你的事务通知"));
});
test("real snapshot regression: abbreviated intake and unparsed application window require review",()=>{
  const a=item("原则上仅限25级、24级、23级、22级本科生申请。系统申请时间为2026年10月16日-10月18日24:00。","建筑学院奖助学金评审通知","建筑学院");
  assert.equal(match(a,p,day).lane,"possible");assert.ok(a.warnings.some(w=>w.includes("时段")));
});
test("real snapshot regression: recruitment event reports are not future opportunities",()=>{
  assert.deepEqual(item("活动已举行。","东南大学举办2027届秋季大型综合双选会").types,["新闻报道"]);
  assert.deepEqual(item("请及时参加。","关于召开人工智能项目评审会的通知").types,["活动预告"]);
  assert.ok(!item("计算机与人工智能学院参加交流。","校际合作共建活动").topics.includes("AI/机器学习"));
});
test("user feedback: English AI maps to machine learning without matching unrelated English words",()=>{
  const a=item("AI与类器官、器官芯片结合将塑造药物研发新模式。","科技日报：AI+器官芯片加速创新药研发","东大新闻网·媒体东大");
  assert.ok(a.topics.includes("AI/机器学习"));assert.notEqual(match(a,p,day).lane,"excluded");
  assert.ok(!item("RAILWAY TRAINING CHAIR。","技术交流").topics.includes("AI/机器学习"));
});
test("user feedback: subsidy eligibility statement recognizes graduate students and preserves undergraduate exclusion",()=>{
  const a=item("资助对象为受地震影响导致家庭经济出现暂时困难的全日制研究生。","东南大学研究生院开展西藏那曲地震受灾家庭研究生临时困难资助","研究生院·公告");
  assert.deepEqual(a.audience.degrees,["硕士生","博士生"]);assert.ok(a.topics.includes("困难补助"));assert.deepEqual(a.types,["事务通知"]);
  const r=match(a,profile({...p,interests:["topic:困难补助"]}),day);assert.equal(r.lane,"excluded");assert.ok(r.reasons.some(x=>x.includes("培养层次不符合")));
  assert.equal(match(a,profile({...p,degree:"硕士生",interests:["topic:困难补助"]}),day).lane,"possible");
});
