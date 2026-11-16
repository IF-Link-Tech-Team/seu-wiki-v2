import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import { OPTIMIZED_TOPIC_GROUPS, OPTIMIZED_TOPIC_NAMES } from "@aihot/industry/subscription-onboarding";
import type { SubscriptionProfile } from "./subscription.ts";

export interface OptimizedProfile {
  userIdentity: { degree: string; college: string; enrollmentYear: string };
  subscriptionPreferences: {
    mode: "interest" | "identity_all";
    followOwnCollege: boolean;
    followedColleges: string[];
    topicGroups: string[];
    topics: string[];
    publishers: string[];
    excludedContentTypes: string[];
    excludedLocations: string[];
  };
}

const tags = TAX.tags as readonly { id: string; label: string; dimension: string }[];
const colleges = new Set((TAX.groups.find(g => g.id === "group:12")!.terms as readonly string[]).map(id => id.slice("publisher:".length)));
const names = (dimension: string) => new Set(tags.filter(t => t.dimension === dimension).map(t => t.label));
const groupIds = new Set<string>(OPTIMIZED_TOPIC_GROUPS.map(g => g.id));
export const ONBOARDING_LOCATIONS: Record<string, string> = { "九龙湖校区": "location:九龙湖", "四牌楼校区": "location:四牌楼", "丁家桥校区": "location:丁家桥" };

/** Converts the HTML's labels into the existing API dictionary IDs. Rejects lost selections. */
export function fromOptimizedProfile(raw: unknown, previous?: SubscriptionProfile | null): SubscriptionProfile {
  const value = raw as Partial<OptimizedProfile> | null;
  const identity = value?.userIdentity;
  const preferences = value?.subscriptionPreferences;
  if (!identity || !preferences || !["本科生", "硕士生", "博士生"].includes(identity.degree)) throw Error("请先选择有效的培养层次。");
  if (typeof identity.college !== "string" || (identity.college && !colleges.has(identity.college))) throw Error("请从列表选择学院，或清空学院后继续。");
  if (typeof identity.enrollmentYear !== "string" || (identity.enrollmentYear && !/^20\d{2}$/.test(identity.enrollmentYear))) throw Error("请重新选择入学年份。");
  if (!["interest", "identity_all"].includes(preferences.mode) || typeof preferences.followOwnCollege !== "boolean") throw Error("订阅模式无效，请重新确认设置。");
  function selected(rawList: unknown, allowed: Set<string>, field: string) {
    if (!Array.isArray(rawList) || rawList.length > 250 || rawList.some(v => typeof v !== "string" || !allowed.has(v))) throw Error(`${field}含有无法识别的选择，请重新确认。`);
    return [...new Set(rawList)] as string[];
  }
  return {
    degree: identity.degree, college: identity.college, enrollmentYear: identity.enrollmentYear,
    international: previous?.international ?? "", identityNotices: false, types: [],
    interests: selected(preferences.topics, names("topic"), "兴趣").map(v => `topic:${v}`),
    publishers: selected(preferences.publishers, names("publisher"), "关注机构").map(v => `publisher:${v}`),
    mode: preferences.mode, followOwnCollege: preferences.followOwnCollege,
    followColleges: selected(preferences.followedColleges, colleges, "关注学院").filter(c => c !== identity.college),
    topicGroups: selected(preferences.topicGroups, groupIds, "整组订阅"),
    excludedTypes: selected(preferences.excludedContentTypes, names("type"), "内容类型").map(v => `type:${v}`),
    excludedLocations: selected(preferences.excludedLocations, new Set(Object.keys(ONBOARDING_LOCATIONS)), "校区").map(v => ONBOARDING_LOCATIONS[v]),
  };
}

export function toOptimizedProfile(profile?: SubscriptionProfile | null): OptimizedProfile {
  const removePrefix = (id: string) => id.slice(id.indexOf(":") + 1);
  const knownGroups = (profile?.topicGroups ?? []).filter(id => groupIds.has(id));
  const topics = (profile?.interests ?? []).map(removePrefix).filter(name => names("topic").has(name));
  return {
    userIdentity: { degree: profile?.degree ?? "", college: profile?.college ?? "", enrollmentYear: profile?.enrollmentYear ?? "" },
    subscriptionPreferences: {
      mode: profile?.mode ?? "interest", followOwnCollege: profile?.followOwnCollege ?? true,
      followedColleges: (profile?.followColleges ?? []).filter(name => colleges.has(name)),
      topicGroups: knownGroups, topics, publishers: (profile?.publishers ?? []).map(removePrefix),
      excludedContentTypes: profile?.excludedTypes?.map(removePrefix) ?? (profile?.types.length ? tags.filter(t => t.dimension === "type" && !profile.types.includes(t.id)).map(t => t.label) : []),
      excludedLocations: Object.keys(ONBOARDING_LOCATIONS).filter(label => profile?.excludedLocations?.includes(ONBOARDING_LOCATIONS[label])),
    },
  };
}

export function legacyTopicExtras(profile: OptimizedProfile) {
  return OPTIMIZED_TOPIC_GROUPS.map((group, index) => ({
    groupId: group.id,
    tags: profile.subscriptionPreferences.topics.filter(name => !OPTIMIZED_TOPIC_NAMES.has(name) && (TAX.groups.find(g => g.id === `group:${index + 1}`)!.terms as readonly string[]).includes(`topic:${name}`)),
  })).filter(group => group.tags.length);
}
