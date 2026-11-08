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
    { label: "交流培养", tags: ["访学与交流"] },
  ]},
  { id: "career", label: "求职就业", icon: "▣", subgroups: [
    { label: "招聘与服务", tags: ["校园招聘", "实习", "选调与公职", "就业服务"] },
    { label: "行业方向", tags: ["互联网与芯片", "国企与制造", "金融与地产"] },
  ]},
  { id: "research", label: "科研竞赛", icon: "✧", subgroups: [
    { label: "科研与学术", tags: ["科研训练与大创", "实验室与科研助理", "项目申报与基金", "论文与成果转化", "学术会议与报告"] },
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
    { label: "校务与组织", tags: ["规章制度", "党团学习", "国防与征兵"] },
  ]},
  { id: "global", label: "国际与校友", icon: "◎", subgroups: [
    { label: "国际与校友", tags: ["来华留学", "港澳台交流", "国际组织与会议", "校友活动"] },
  ]},
] as const;
export const OPTIMIZED_TOPIC_NAMES = new Set<string>(OPTIMIZED_TOPIC_GROUPS.flatMap(g => g.subgroups.flatMap(s => [...s.tags])));

/** 旧订阅画像里的组 id → 新组 id（alumni 并入国际与校友）。 */
export const LEGACY_TOPIC_GROUP_IDS: Record<string, string> = { alumni: "global" };
