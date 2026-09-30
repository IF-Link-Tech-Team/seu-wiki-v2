// 组织门户的客户端命令：同源 fetch /api/org/*，带会话的 CSRF token，成功后重跑页面 loader。
import { useCallback, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

export interface OrgMe {
  orgName: string;
  name: string;
  role: "owner" | "editor";
  csrf: string;
}

export interface OrgPost {
  id: number;
  title: string;
  eventAt: string | null;
  location: string | null;
  audience: string | null;
  fee: string | null;
  signup: string | null;
  body: string;
  posterUrl: string | null;
  suggestedTags: string[];
  status: "pending" | "published" | "rejected";
  reviewNote: string | null;
  articleId: string | null;
  pendingChange: { type: "update" | "reschedule" | "cancel"; patch?: Record<string, unknown>; reason?: string | null; requestedAt?: string } | null;
  ended: boolean;
  createdAt: string;
  updatedAt: string;
}

export class OrgError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function useOrgMe(): OrgMe {
  return (useRouteLoaderData("org-layout") as { me: OrgMe } | undefined)?.me ?? { orgName: "", name: "", role: "editor", csrf: "" };
}

export function useOrgAction() {
  const me = useOrgMe();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T = unknown>(method: "POST" | "PATCH", path: string, body?: unknown, opts: { revalidate?: boolean } = {}): Promise<T | null> => {
      setPending(path);
      setError(null);
      try {
        const res = await fetch(path, {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": me.csrf },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 401) {
          window.location.href = "/org/login";
          return null;
        }
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) throw new OrgError(res.status, json?.detail ?? `请求失败（${res.status}）`);
        if (opts.revalidate !== false) revalidator.revalidate();
        return json as T;
      } catch (e) {
        setError(e instanceof Error ? e.message : "请求失败");
        return null;
      } finally {
        setPending(null);
      }
    },
    [me.csrf, revalidator],
  );
  return { run, pending, error };
}
