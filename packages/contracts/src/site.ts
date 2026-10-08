// First-party site API (/api/site/*). Not a public API: it may evolve with the website,
// but it is served from the same public read layer as v1, RSS and MCP.
import type { CategoryKey, ChannelKey } from "./taxonomy.ts";

export type SourceKind = "rss" | "web_list" | "json_list" | "x_search" | "mp_account" | "external";

export interface SourceRef {
  id: string;
  name: string;
  kind: SourceKind;
  firstParty: boolean;
  iconUrl: string | null;
  iconSrcSet?: string;
}

export interface MediaView {
  kind: "image" | "video";
  url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  poster: string | null;
  srcSet?: string;
}

export interface XPostView {
  authorName: string;
  handle: string;
  avatarUrl: string | null;
  avatarSrcSet?: string;
  text: string;
  translation: string | null;
  /** translation: Chinese translation of the quoted post, when it is in another language. */
  quoted: { authorName: string; handle: string; text: string; url: string; translation: string | null } | null;
  media: MediaView[];
}

export interface StoryRef {
  publicId: string;
  title: string;
}

export interface ItemSummary {
  id: string;
  revision: number;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  reason: string | null;
  source: SourceRef;
  links: { aihot: string; original: string };
  publishedAt: string | null;
  discoveredAt: string;
  timelineAt: string;
  category: CategoryKey | null;
  tags: string[];
  score: number | null;
  selected: boolean;
  channel: "news" | "x";
  story: StoryRef | null;
  x: XPostView | null;
}

/** The fields rendered by a site feed card; full original text lives in the item detail. */
export interface FeedItemSummary extends Pick<ItemSummary, "id" | "title" | "summary" | "reason" | "publishedAt" | "timelineAt" | "category" | "tags" | "score" | "selected" | "channel"> {
  source: Pick<SourceRef, "name">;
  x: (Pick<XPostView, "authorName" | "handle" | "avatarUrl" | "avatarSrcSet" | "media"> & {
    quoted: Omit<NonNullable<XPostView["quoted"]>, "url"> | null;
  }) | null;
}

export interface GroupInfo {
  factId: string;
  story: StoryRef | null;
  /** Other public sources of the fact the card represents (same set as the expandable reports). */
  additionalSourceCount: number;
  /** Distinct public reports across the group's facts. */
  reportCount: number;
  /** Facts of the group (the card's own included) with at least one selected item under the current filters. */
  developmentCount: number;
  /** The newest development when it is not the card's own fact: why the card sits where it does. */
  latestDevelopment?: { factId: string; title: string; at: string } | null;
}

export interface TimelineCard {
  key: string;
  anchorAt: string;
  item: FeedItemSummary;
  group: GroupInfo | null;
}

export interface HotStripEntry {
  rank: number;
  title: string;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  storyPublicId: string | null;
  itemId: string | null;
  participants: HotParticipant[];
  participantCount: number;
}

export interface TimelineFilters {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
  topic?: string | null;
  /** 信源筛选（sources.id 列表）；空/null 为不筛选。应用到精选、分类、全部与搜索。 */
  sources?: string[] | null;
}

export interface TimelineResponse {
  filters: TimelineFilters;
  cards: TimelineCard[];
  nextCursor: string | null;
  /** Absolute time when a pending item in this scope becomes visible; the page re-checks then. */
  refreshAt: string | null;
  hot: HotStripEntry[] | null;
  dayCounts: Record<string, number>;
  generatedAt: string;
}

export type SearchTypeFilter = "all" | "feed" | "survival" | "experience";

export interface PoolResponse {
  filters: TimelineFilters & { q: string | null; tab: "time" | "relevance"; type: SearchTypeFilter };
  items: FeedItemSummary[];
  /** 手册/经验的命中（有检索词且 type 不是 feed 时），按相关度排，带章节锚点。 */
  docs: DocSearchHit[];
  page: number;
  pageCount: number;
  total: number;
  todayCount: number;
  freshness: string;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 信源筛选（/api/site/sources）
// ---------------------------------------------------------------------------

/** 信源筛选器的一个可选项：只暴露筛选器需要的字段。 */
export interface SourceOption {
  id: string;
  name: string;
  /** 来源分组（sources.tags 里的组别词），如 学院与书院 / 机关与职能部门；未分组为 null。 */
  group: string | null;
}

export interface SourceListResponse {
  sources: SourceOption[];
}

// ---------------------------------------------------------------------------
// 为你：画像与个性化信息流（只加权和标注，不剔除）
// ---------------------------------------------------------------------------

/** 条目的受众与校园语义（publications.campus / analyses.campus 的形状），全部可空。 */
export interface CampusAudience {
  /** 面向的学历身份，如 ["本科生", "硕士生"]。 */
  identities?: string[];
  /** 面向的学院全称；空数组或含「全校」是中性，不算命中任何学院。 */
  colleges?: string[];
  /** 面向的年级，如 ["大一", "大三"]。 */
  grades?: string[];
  /** 报名/办理截止（ISO 日期）；还在期限内时时效不衰减。 */
  deadline?: string | null;
  valueTier?: "action" | "opportunity" | "news";
  completeness?: string;
}

/** 读者画像（查询参数或 seuwiki_profile cookie）。未填的维度中性，不加不减。 */
export interface ForYouProfile {
  college?: string | null;
  /** 本科 | 硕士 | 博士。 */
  degree?: string | null;
  grade?: string | null;
  interests?: string[];
  orgs?: string[];
}

export interface ForYouItem extends FeedItemSummary {
  /** 命中的画像维度（如 ["信息科学与工程学院", "本科生"]）；空数组 = 未命中，正常排序。 */
  matchReasons: string[];
  /** 排序分 = 基础分 × 时效系数 + 匹配加成（封顶 40）。 */
  rankScore: number;
}

export interface ForYouResponse {
  profile: ForYouProfile;
  items: ForYouItem[];
  nextCursor: string | null;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 知识内容（手册 / 经验；Git 真源导入的派生数据）
// ---------------------------------------------------------------------------

export interface DocHeading {
  id: string;
  text: string;
  depth: number;
}

export interface DocSummary {
  slug: string;
  kind: "survival" | "experience";
  title: string;
  description: string | null;
  author: string | null;
  /** 经历/原文时间（原文写法，如 "2021-08"），不是导入时间。 */
  occurredAt: string | null;
  category: string | null;
  grade: string | null;
  college: string | null;
  part: string | null;
  position: number;
}

export interface DocDetail extends DocSummary {
  html: string;
  headings: DocHeading[];
  sourceUrl: string | null;
  prev: DocSummary | null;
  next: DocSummary | null;
  version: number;
  updatedAt: string;
}

export interface SurvivalPartView {
  key: string;
  label: string;
  groups: Array<{ key: string; items: DocSummary[] }>;
}

export interface ExperienceIndex {
  filters: Array<{ key: "category" | "grade" | "college"; label: string; values: string[] }>;
  items: DocSummary[];
}

/** 统一搜索里一条手册/经验结果：带类型标记与最匹配章节的锚点。 */
export interface DocSearchHit {
  slug: string;
  kind: "survival" | "experience";
  title: string;
  description: string | null;
  occurredAt: string | null;
  anchor: { id: string; text: string } | null;
}

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

export interface ItemDetail extends ItemSummary {
  readingMode: "full" | "summary-only";
  author: string | null;
  language: string | null;
  /** Chinese body (translation or Chinese original) and original body, whitelisted HTML. */
  body: { zh: string | null; original: string | null; zhKind: "translation" | "original" | null; complete: boolean } | null;
  outline: OutlineEntry[];
  relatedStories: StoryRef[];
  indexable: boolean;
  markdownAvailable: boolean;
  group: GroupInfo | null;
}

export interface GroupReport {
  id: string;
  title: string;
  summary: string | null;
  source: SourceRef;
  timelineAt: string;
  originalUrl: string;
  selected: boolean;
}

export interface GroupReportsResponse {
  factId: string;
  revision: string;
  reports: GroupReport[];
  nextCursor: string | null;
}

export interface Development {
  factId: string;
  title: string;
  occurredAt: string | null;
  representative: ItemSummary;
  reportCount: number;
}

export interface DevelopmentsResponse {
  story: StoryRef;
  revision: string;
  developments: Development[];
  nextCursor: string | null;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  retryAfter?: number;
}

// ---------------------------------------------------------------------------
// Hot ranking and stories
// ---------------------------------------------------------------------------

export interface HotParticipant {
  name: string;
  kind: "editorial" | "signal";
  /** The source's icon, or for an X account its latest collected avatar (proxied). */
  iconUrl: string | null;
  iconSrcSet?: string;
}


export interface HotEntryView {
  rank: number;
  story: StoryRef;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  trendPct: number | null;
  badges: Array<"surge" | "new" | "rising">;
  participantCount: number;
  sourceCount: number;
  signalCount: number;
  reportCount: number;
  sourceNames: string[];
  latestAt: string;
  firstReportAt: string;
  representative: { id: string; url: string; sourceName: string } | null;
  participants: HotParticipant[];
  /** Hourly heat over the 24 hours up to the ranking, oldest first; null where no comparable snapshot exists. */
  spark: Array<number | null>;
  /** The story's AI digest, else its fact statement. */
  summary: string | null;
  /** The latest development, one line. */
  latest: string | null;
  /** A picture from the story's public reports (the representative first), for the leading cards. */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null } | null;
}

export interface HotResponse {
  computedAt: string | null;
  ruleVersion: string | null;
  windowHours: number;
  entries: HotEntryView[];
}

export interface HeatPoint {
  hour: string;
  heat: number;
  participants: number;
}

export interface StoryReportView {
  id: string;
  title: string;
  summary: string | null;
  source: SourceRef;
  publishedAt: string;
  originalUrl: string;
  selected: boolean;
  factId: string;
}

export interface StoryFactView {
  factId: string;
  title: string;
  occurredAt: string | null;
  firstReportAt: string;
  reportCount: number;
  representative: StoryReportView;
}

export interface StoryDetail {
  publicId: string;
  title: string;
  status: "active" | "watching" | "settled";
  reportCount: number;
  sourceCount: number;
  firstReportAt: string | null;
  latestAt: string | null;
  digest: string | null;
  digestUpdatedAt: string | null;
  /** The story's own factual summary, when it has one. */
  summary: string | null;
  /** Without a digest or summary: the summary of the report the story started from. */
  excerpt: { text: string; sourceName: string } | null;
  latest: string | null;
  whyHot: {
    participants48h: number;
    newParticipants6h: number;
    recentReports24h: number;
    observationComplete: boolean;
    rank: number | null;
    heat: number | null;
  };
  developments: StoryFactView[];
  officialReports: StoryReportView[];
  timeline: StoryReportView[];
  heat: HeatPoint[];
  related: Array<StoryRef & { relation: "storyline" | "related"; latestAt: string | null }>;
}

// ---------------------------------------------------------------------------
// Reports (daily / weekly / monthly)
// ---------------------------------------------------------------------------

export type ReportKind = "daily" | "weekly" | "monthly";

export interface ReportCitation {
  itemId: string | null;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceId: string | null;
  sourceIconUrl: string | null;
  sourceIconSrcSet?: string;
  firstParty: boolean;
  role: string | null;
  storyPublicId: string | null;
  /** When the cited report was published, if it is still in the database. */
  publishedAt: string | null;
  /** False once the item was withdrawn; the citation then shows as removed. */
  available: boolean;
}

export interface ReportDetail {
  kind: ReportKind;
  key: string;
  title: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  revision: number;
  lead: { title: string; leadParagraph: string } | null;
  overview: string | null;
  highlights: ReportCitation[];
  /** As edited: daily categories, weekly and monthly themes. */
  sections: Array<{ label: string; summary: string | null; items: ReportCitation[] }>;
  /** Reading order: every section item once, labelled with its section. */
  stories: Array<ReportCitation & { label: string }>;
  flashes: ReportCitation[];
  /**
   * The front page's picture: from the lead item (a daily's lead, a weekly or monthly's first highlight),
   * else from another public report of that event. Captioned with the story when it is not the lead's own.
   */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null; caption: string | null } | null;
  metrics: Record<string, number>;
  readingMinutes: number;
  prev: string | null;
  next: string | null;
}

export interface ReportIndexEntry {
  key: string;
  title: string | null;
  generatedAt: string;
  count: number;
}

/** Figures and samples for the about page (site-only; not part of v1). */
export interface SiteStats {
  /** Sources collected from now. */
  sources: number;
  /** Enabled sources by kind: x_search, rss, web_list, mp_account, json_list. */
  sourceKinds: Record<string, number>;
  /** Of them, sources that only count toward heat (their items never reach 精选). */
  heatOnlySources: number;
  /** Everything collected and not withdrawn, heat-only sources included. */
  items: number;
  selected: number;
  dailies: number;
  /** The last 24 hours: items found (heat-only sources included), and items that made 精选 (by their place on the timeline). */
  day: { collected: number; selected: number };
  /** Enabled sources in a daily shuffle, for the about page's river: one line per source. */
  sampleSources: Array<{ name: string; kind: string; heatOnly: boolean }>;
  /** The latest 精选, newest first. */
  latest: Array<{ id: string; title: string; source: string }>;
}

/** A reading page transfers one language; the canonical item retains both for exports. */
export interface SiteItemDetail extends Omit<ItemDetail, "x"> {
  x: Omit<XPostView, "text" | "translation"> | null;
  hasTranslation: boolean;
  bodyLanguage: "zh" | "original";
}

export interface StoryFollowup {
  factId: string;
  representative: { id: string; title: string; source: { name: string }; timelineAt: string };
}
export interface StoryFollowupsResponse { items: StoryFollowup[]; more: boolean }

/** All issue keys keep numbering and calendars stable; closed daily months omit their titles. */
export interface ReportNavigationEntry { key: string; title?: string | null; count?: number }
