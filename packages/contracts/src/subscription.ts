export interface SubscriptionProfile {
  degree: string;
  college: string;
  enrollmentYear: string;
  international: string;
  interests: string[];
  publishers: string[];
  types: string[];
  identityNotices: boolean;
  mode?: "interest" | "identity_all";
  followOwnCollege?: boolean;
  topicGroups?: string[];
  excludedTypes?: string[];
  excludedLocations?: string[];
}

export interface SubscriptionEvidence { tag: string; field: string; quote: string }
export interface SubscriptionAnnotation {
  version: string;
  topics: string[];
  publishers: string[];
  types: string[];
  actions: string[];
  locations: string[];
  formats: string[];
  audience: { degrees: string[]; colleges: string[]; years: string[]; internationalOnly: boolean; schoolwide: boolean; staffOnly: boolean };
  deadline: string | null;
  evidence: SubscriptionEvidence[];
  warnings: string[];
}
export interface SubscriptionItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: string;
  annotation: SubscriptionAnnotation;
  lane: "matched" | "possible" | "excluded";
  reasons: string[];
}
export interface SubscriptionResponse {
  version: string;
  profile: SubscriptionProfile;
  asOf: string;
  from: string;
  total: number;
  truncated: boolean;
  counts: Record<SubscriptionItem["lane"], number>;
  items: SubscriptionItem[];
  page: number;
  pageCount: number;
  quality: { noTopics: number; unknownAudience: number; missingSummary: number };
}
