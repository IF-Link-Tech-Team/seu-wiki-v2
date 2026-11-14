// Topic groups from the user-supplied optimized onboarding, re-cut 2026-10-27 per 负责人反馈：
// 125 个细叶聚合为 42 个可选标签（9 组），细词收编为 TAG_SYNONYMS 的别名继续参与归一与匹配。
// 聚合原则：一个标签只住一个组，按读者订阅目的归类（上课办事归学业教务，动手做科研归科研竞赛）。
// subgroups 是展示层的细分（气泡展开后的分节），标签本身才是订阅节点；与 optimized-profile.html 的内嵌数据保持一致。
// These are UI subscription groups; they do not imply an identity or audience.
export const OPTIMIZED_TOPIC_GROUPS = [
  { id: "study", label: "学业教务", icon: "▤", subgroups: [
    { label: "教学与学籍", tags: ["选课与成绩", "学籍与辅修", "毕业与学位"] },
    { label: "研究生培养", tags: ["研究生培养"] },
  ]},
  { id: "further", label: "升学深造", icon: "↗", subgroups: [
    { label: "升学路径", tags: ["保研", "考研", "留学"] },
    { label: "交流培养", tags: ["交换与访学"] },
  ]},
  { id: "career", label: "求职就业", icon: "▣", subgroups: [
    { label: "招聘与服务", tags: ["校园招聘", "实习", "选调与公职", "就业服务"] },
    { label: "行业方向", tags: ["互联网与芯片", "国企与制造", "金融与地产"] },
  ]},
  { id: "research", label: "科研竞赛", icon: "✧", subgroups: [
    { label: "科研与学术", tags: ["SRTP", "大创", "实验室与科研助理", "项目申报与基金", "论文发表", "学术会议与报告"] },
    { label: "竞赛与AI", tags: ["学科竞赛", "AI/机器学习"] },
  ]},
  { id: "awards", label: "奖助评优", icon: "☆", subgroups: [
    { label: "奖助与评优", tags: ["奖学金", "助学补助", "评优评先"] },
  ]},
  { id: "community", label: "社团组织", icon: "♫", subgroups: [
    { label: "组织与活动", tags: ["学生组织", "社团活动", "演讲辩论"] },
    { label: "文体与公益", tags: ["文艺演出", "体育运动", "志愿公益"] },
  ]},
  { id: "campus", label: "校园生活", icon: "☀", subgroups: [
    { label: "服务与保障", tags: ["校园服务", "防诈骗与安全", "总务后勤"] },
    { label: "文化与讲座", tags: ["讲座与文化"] },
  ]},
  { id: "governance", label: "校务公告", icon: "▥", subgroups: [
    { label: "校务与组织", tags: ["规章制度", "入党与党团", "国防与征兵"] },
  ]},
  { id: "global", label: "国际与校友", icon: "◎", subgroups: [
    { label: "国际与校友", tags: ["来华留学", "港澳台交流", "国际组织与会议", "校友活动"] },
  ]},
] as const;
export const OPTIMIZED_TOPIC_NAMES = new Set<string>(OPTIMIZED_TOPIC_GROUPS.flatMap(g => g.subgroups.flatMap(s => [...s.tags])));

/**
 * 大类下的高频细分词（2026-11-14 依负责人反馈恢复第三层）：大类可整选（选大类即涵盖全部细分，
 * 细分词经 TAG_SYNONYMS 归一到大类参与别名召回），细分词也可单独订阅。
 * 只收最常用的词，且都必须是 TAG_SYNONYMS 里指向对应大类的键（或新增映射），保证单选细分时能靠文本命中。
 */
export const TOPIC_TAG_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  "选课与成绩": ["四六级", "期末考试"],
  "学籍与辅修": ["转专业", "辅修"],
  "研究生培养": ["考博", "硕博连读"],
  "毕业与学位": ["毕业设计"],
  "保研": ["推免", "夏令营"],
  "考研": [],
  "留学": ["留学申请"],
  "交换与访学": ["暑期学校", "交换生"],
  "校园招聘": ["秋招", "春招", "宣讲会", "招聘会"],
  "选调与公职": ["公务员", "事业单位"],
  "就业服务": ["职业规划", "创业"],
  "互联网与芯片": ["互联网", "芯片"],
  "大创": ["创新创业"],
  "实验室与科研助理": ["科研助理"],
  "项目申报与基金": ["国自然"],
  "论文发表": ["投稿"],
  "学科竞赛": ["数学建模", "电赛", "挑战杯"],
  "AI/机器学习": ["大模型", "深度学习"],
  "奖学金": ["国家奖学金", "国奖"],
  "助学补助": ["勤工助学", "助学贷款"],
  "评优评先": ["三好学生", "优秀毕业生"],
  "学生组织": ["学生会", "研究生会"],
  "社团活动": ["招新", "百团大战"],
  "文艺演出": ["迎新晚会", "音乐会"],
  "体育运动": ["运动会"],
  "志愿公益": ["社会实践", "支教"],
  "演讲辩论": ["辩论赛"],
  "校园服务": ["食堂", "宿舍", "校园网"],
  "讲座与文化": ["展览"],
  "入党与党团": ["党课", "青马工程"],
  "国防与征兵": ["军训", "入伍"],
  "国际组织与会议": ["国际会议"],
};

export const CHILD_TOPIC_NAMES = new Set<string>(Object.keys(TOPIC_TAG_CHILDREN).flatMap(parent => [...TOPIC_TAG_CHILDREN[parent]]));

/** 旧订阅画像里的组 id → 新组 id（alumni 并入国际与校友）。 */
export const LEGACY_TOPIC_GROUP_IDS: Record<string, string> = { alumni: "global" };
