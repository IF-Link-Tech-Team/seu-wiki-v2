import type { SubscriptionProfile } from "@aihot/contracts/subscription";
import { OPTIMIZED_TOPIC_GROUPS, OPTIMIZED_TOPIC_NAMES } from "@aihot/industry/subscription-onboarding";
import { SUBSCRIPTION_TAXONOMY as TAX } from "@aihot/industry/subscription-v2";
import { migrateLegacySubscription } from "../publication/subscription-rules.ts";
import { sql } from "../db.ts";

export interface StoredSubscriptionProfile {
  profile: SubscriptionProfile;
  taxonomyVersion: string;
  revision: number;
  updatedAt: string;
}

export class SubscriptionProfileConflict extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super("subscription profile revision conflict");
    this.currentRevision = currentRevision;
  }
}

export function subscriptionExperimentEnabled(): boolean {
  return process.env.SUBSCRIPTION_EXPERIMENT_ENABLED === "true";
}

const tags = TAX.tags as readonly { id: string; label: string; dimension: string; reserved: boolean }[];
const allowedByDimension = (dimension: string) => new Set(tags.filter((tag) => tag.dimension === dimension && !tag.reserved).map((tag) => tag.id));
const topicIds = new Set(tags.filter((tag) => tag.dimension === "topic" && (!tag.reserved || OPTIMIZED_TOPIC_NAMES.has(tag.label))).map((tag) => tag.id));
const publisherIds = allowedByDimension("publisher");
const typeIds = allowedByDimension("type");
const locationIds = allowedByDimension("location");
const collegeNames = new Set((TAX.groups.find((group) => group.id === "group:12")?.terms ?? []).map((id) => id.slice("publisher:".length)));
const topicGroupIds = new Set(OPTIMIZED_TOPIC_GROUPS.map((group) => group.id));

function text(value: unknown, field: string, allowed: Set<string>, maxLength = 80): string {
  if (typeof value !== "string" || value.length > maxLength || !allowed.has(value)) throw new Error(`${field}无效`);
  return value;
}

function selection(value: unknown, field: string, allowed: Set<string>, limit = 250): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some((item) => typeof item !== "string" || !allowed.has(item))) throw new Error(`${field}含有无效标签`);
  return [...new Set(value as string[])];
}

/** Strictly validates the complete server-stored profile; unknown taxonomy IDs are rejected. */
export function parseSubscriptionProfile(value: unknown): SubscriptionProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("画像必须是对象");
  const raw = value as Record<string, unknown>;
  const degree = text(raw.degree, "培养层次", new Set(["", "本科生", "硕士生", "博士生"]), 3);
  const college = text(raw.college, "学院", new Set(["", ...collegeNames]), 60);
  const enrollmentYear = text(raw.enrollmentYear, "入学年份", new Set(["", ...Array.from({ length: 30 }, (_, index) => String(2010 + index))]), 4);
  const international = text(raw.international, "留学生身份", new Set(["", "yes", "no"]), 3);
  if (typeof raw.identityNotices !== "boolean") throw new Error("事务通知偏好无效");
  if (raw.mode !== undefined && raw.mode !== "interest" && raw.mode !== "identity_all") throw new Error("订阅模式无效");
  if (raw.followOwnCollege !== undefined && typeof raw.followOwnCollege !== "boolean") throw new Error("学院关注偏好无效");
  return {
    degree,
    college,
    enrollmentYear,
    international,
    interests: selection(raw.interests, "兴趣", topicIds),
    publishers: selection(raw.publishers, "关注机构", publisherIds),
    types: selection(raw.types, "内容类型", typeIds),
    identityNotices: raw.identityNotices,
    ...(raw.mode === undefined ? {} : { mode: raw.mode }),
    ...(raw.followOwnCollege === undefined ? {} : { followOwnCollege: raw.followOwnCollege }),
    ...(raw.topicGroups === undefined ? {} : { topicGroups: selection(raw.topicGroups, "兴趣组", topicGroupIds, 20) }),
    ...(raw.excludedTypes === undefined ? {} : { excludedTypes: selection(raw.excludedTypes, "排除内容类型", typeIds) }),
    ...(raw.excludedLocations === undefined ? {} : { excludedLocations: selection(raw.excludedLocations, "排除校区", locationIds) }),
  };
}

export async function readSubscriptionProfile(memberId: string): Promise<StoredSubscriptionProfile | null> {
  const [row] = await sql<{ profile: SubscriptionProfile; taxonomy_version: string; revision: number; updated_at: Date }[]>`
    SELECT profile, taxonomy_version, revision, updated_at
    FROM member_subscription_profiles
    WHERE member_id = ${memberId}`;
  // 词表换代（2026-10-27-v3）后旧画像仍在库：读取时把细叶词归一到聚合词，下次保存落为新词形。
  return row ? { profile: migrateLegacySubscription(row.profile), taxonomyVersion: row.taxonomy_version, revision: row.revision, updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveSubscriptionProfile(memberId: string, profile: SubscriptionProfile, expectedRevision: number): Promise<StoredSubscriptionProfile> {
  const rows = expectedRevision === 0
    ? await sql<{ profile: SubscriptionProfile; taxonomy_version: string; revision: number; updated_at: Date }[]>`
        INSERT INTO member_subscription_profiles (member_id, profile, taxonomy_version)
        VALUES (${memberId}, ${sql.json(profile as never)}, ${TAX.version})
        ON CONFLICT (member_id) DO NOTHING
        RETURNING profile, taxonomy_version, revision, updated_at`
    : await sql<{ profile: SubscriptionProfile; taxonomy_version: string; revision: number; updated_at: Date }[]>`
        UPDATE member_subscription_profiles
        SET profile = ${sql.json(profile as never)}, taxonomy_version = ${TAX.version}, revision = revision + 1, updated_at = now()
        WHERE member_id = ${memberId} AND revision = ${expectedRevision}
        RETURNING profile, taxonomy_version, revision, updated_at`;
  const row = rows[0];
  if (!row) {
    const [current] = await sql<{ revision: number }[]>`SELECT revision FROM member_subscription_profiles WHERE member_id = ${memberId}`;
    throw new SubscriptionProfileConflict(current?.revision ?? 0);
  }
  return { profile: row.profile, taxonomyVersion: row.taxonomy_version, revision: row.revision, updatedAt: row.updated_at.toISOString() };
}

export async function deleteSubscriptionProfile(memberId: string, expectedRevision: number): Promise<void> {
  const rows = await sql<{ revision: number }[]>`
    DELETE FROM member_subscription_profiles
    WHERE member_id = ${memberId} AND revision = ${expectedRevision}
    RETURNING revision`;
  if (!rows.length) {
    const [current] = await sql<{ revision: number }[]>`SELECT revision FROM member_subscription_profiles WHERE member_id = ${memberId}`;
    if (current) throw new SubscriptionProfileConflict(current.revision);
    if (expectedRevision !== 0) throw new SubscriptionProfileConflict(0);
  }
}
