// 东南大学校园信息聚合的分类体系：类别、标签词表、机构（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 */
export const CATEGORIES = [
  { key: "academic", label: "教务", section: "教务教学", guide: "选课、课表、考试安排、成绩、学籍、转专业、培养方案、SRTP、四六级、教材与教学运行" },
  { key: "aid", label: "奖助", section: "奖助与事务", guide: "奖助学金、勤工助学、助学贷款、评优评先、心理健康与学生事务性通知" },
  { key: "competition", label: "竞赛科研", section: "竞赛与科研", guide: "学科竞赛、科研项目招募、创新创业、学术训练与学术报告" },
  { key: "exchange", label: "交流升学", section: "交流与升学", guide: "国际交流、交换项目、海外访学、保研、考研、留学申请" },
  { key: "career", label: "实习就业", section: "实习与就业", guide: "宣讲会、招聘会、实习岗位、选调生、就业手续与生涯指导" },
  { key: "club", label: "社团活动", section: "社团与活动", guide: "社团招新与活动、学生会与研会、志愿服务、文体活动、讲座与演出" },
  { key: "life", label: "生活服务", section: "生活服务", guide: "食堂、宿舍、校园网、场馆预约、校医院、接驳车、缴费与后勤通知" },
  { key: "news", label: "校园新闻", section: "校园新闻", guide: "学校新闻、人物报道、科研成果报道与综合消息" },
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["notice", "opportunity", "event", "result", "news", "guide"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "教务通知", "奖助事务", "竞赛科研", "交流升学", "实习就业", "社团活动", "讲座预告", "生活服务",
  "结果公示", "校园新闻", "其他",
] as const;

/**
 * 可选的主题标签（词表受控但可生长：模型只能从这里选，覆盖不了的主题进候选池由运营审核后增补）。
 * 分组同时是 taxonomy_terms 表的 grp 字段（种子）；运行时词表以数据库为准（packages/backend/src/taxonomy/terms.ts），
 * 这里的 TOPIC_TAGS 是种子和数据库为空时的兜底。组的 key/label 上线后不要改。
 */
export const TOPIC_GROUPS = [
  { key: "study", label: "学业发展", terms: ["保研", "考研", "留学", "转专业", "辅修", "奖学金"] },
  { key: "research", label: "科研竞赛", terms: ["AI/机器学习", "机器人", "数学建模", "电子设计", "创新创业", "SRTP"] },
  { key: "career", label: "实习就业", terms: ["实习", "秋招春招", "选调", "国企央企", "互联网"] },
  { key: "campus", label: "校园生活", terms: ["社团", "音乐", "体育", "摄影", "志愿服务", "讲座", "演出"] },
  { key: "skills", label: "技能成长", terms: ["编程", "设计", "外语", "写作表达", "新媒体"] },
] as const;

export const TOPIC_TAGS = TOPIC_GROUPS.flatMap((g) => [...g.terms]);

/** 可选的实体标签（部门、学院、机构）。 */
export const ENTITY_TAGS = [
  "教务处", "学生处", "校团委", "研究生院", "就业指导中心", "总务处", "网络与信息中心", "图书馆", "校医院",
  "信息科学与工程学院", "电子科学与工程学院", "自动化学院", "生物科学与医学工程学院",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  教务: "教务通知", 选课: "教务通知", 考试: "教务通知", 学籍: "教务通知", 教学: "教务通知",
  奖助学金: "奖助事务", 助学金: "奖助事务", 勤工助学: "奖助事务", 评优: "奖助事务",
  竞赛: "竞赛科研", 科研: "竞赛科研", 大创: "竞赛科研",
  国际交流: "交流升学", 交换: "交流升学", 升学: "交流升学",
  就业: "实习就业", 招聘: "实习就业", 宣讲会: "实习就业",
  活动: "社团活动", 招新: "社团活动", 学生会: "社团活动",
  讲座预告: "讲座预告", 讲座通知: "讲座预告",
  后勤: "生活服务", 宿舍: "生活服务", 食堂: "生活服务",
  公示: "结果公示", 名单: "结果公示",
  新闻: "校园新闻", 报道: "校园新闻",
  大模型: "AI/机器学习", 人工智能: "AI/机器学习", 机器学习: "AI/机器学习", 深度学习: "AI/机器学习",
  秋招: "秋招春招", 春招: "秋招春招", 校招: "秋招春招",
  出国: "留学", 交换生: "留学",
  保研资格: "保研", 推免: "保研",
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  notice: "教务通知", opportunity: "竞赛科研", event: "社团活动",
  result: "结果公示", news: "校园新闻", guide: "生活服务",
};

// ── 机构与主体 ──────────────────────────────────────────────────────────────────────────

/** 机构主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  jwc: { name: "教务处", displayTag: "教务处", aliases: ["教务处", "教务部", "jwc"] },
  xsc: { name: "学生处（学工部）", displayTag: "学生处", aliases: ["学生处", "学工部", "学生工作部"] },
  tw: { name: "校团委", displayTag: "校团委", aliases: ["校团委", "团委", "共青团东南大学委员会"] },
  gs: { name: "研究生院", displayTag: "研究生院", aliases: ["研究生院", "研工部", "党委研工部"] },
  job: { name: "就业指导中心", displayTag: "就业指导中心", aliases: ["就业指导中心", "学生就业指导中心"] },
  zw: { name: "总务处", displayTag: "总务处", aliases: ["总务处", "后勤"] },
  nic: { name: "网络与信息中心", displayTag: "网络与信息中心", aliases: ["网络与信息中心", "信息中心", "东大信息化"] },
  lib: { name: "图书馆", displayTag: "图书馆", aliases: ["图书馆", "李文正图书馆"] },
  radio: { name: "信息科学与工程学院", displayTag: "信息科学与工程学院", aliases: ["信息科学与工程学院", "信息学院"] },
  electronic: { name: "电子科学与工程学院", displayTag: "电子科学与工程学院", aliases: ["电子科学与工程学院", "电子学院"] },
  automation: { name: "自动化学院", displayTag: "自动化学院", aliases: ["自动化学院"] },
  bme: { name: "生物科学与医学工程学院", displayTag: "生物科学与医学工程学院", aliases: ["生物科学与医学工程学院", "生医学院", "生医"] },
};

/**
 * 身份词典：摘要和标题里出现的机构，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "radio", name: "信息科学与工程学院", patterns: [/信息科学与工程学院|信息学院/] },
  { id: "electronic", name: "电子科学与工程学院", patterns: [/电子科学与工程学院|电子学院/] },
  { id: "automation", name: "自动化学院", patterns: [/自动化学院/] },
  { id: "bme", name: "生物科学与医学工程学院", patterns: [/生物科学与医学工程学院|生医学院/] },
  { id: "jwc", name: "教务处", patterns: [/教务处|教务部/] },
  { id: "xsc", name: "学生处", patterns: [/学生处|学工部|学生工作部/] },
  { id: "gs", name: "研究生院", patterns: [/研究生院|研工部/] },
];

/** 这些域名上的文章，发布方就是对应的机构（托管平台不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "jwc", domains: ["jwc.seu.edu.cn"] },
  { entityId: "xsc", domains: ["xsc.seu.edu.cn"] },
  { entityId: "gs", domains: ["seugs.seu.edu.cn"] },
  { entityId: "job", domains: ["seu.91job.org.cn"] },
  { entityId: "zw", domains: ["zwc.seu.edu.cn"] },
  { entityId: "nic", domains: ["nic.seu.edu.cn"] },
  { entityId: "lib", domains: ["www.lib.seu.edu.cn", "lib.seu.edu.cn"] },
  { entityId: "radio", domains: ["radio.seu.edu.cn"] },
  { entityId: "electronic", domains: ["electronic.seu.edu.cn"] },
  { entityId: "automation", domains: ["automation.seu.edu.cn"] },
  { entityId: "bme", domains: ["bme.seu.edu.cn"] },
];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
