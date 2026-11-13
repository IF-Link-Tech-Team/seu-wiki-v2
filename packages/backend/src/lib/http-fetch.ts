// Outbound HTTP for collectors, the image proxy and the paid APIs: SSRF guard, routing, limits.
import net from "node:net";
import { addAbortListener } from "node:events";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { config } from "../config.ts";
import { assertPublicUrl, guardedLookup } from "./url.ts";
import { createEgressProxy, createEgressResolver, OUTBOUND_HTTP_OPTIONS } from "./egress-proxy.ts";
import { SITE } from "@aihot/industry/site";

/**
 * Where a request leaves the host. "egress" (collection, bodies, images) goes through the egress
 * proxy when EGRESS_PROXY_URL is set (for example a rule-based proxy that connects .cn and .local
 * names and Chinese or private addresses directly and sends the rest abroad); the names and address
 * literals such a proxy would connect directly, plus PRIVATE_FEED_HOSTS entries, are connected here
 * instead, so the connect-time address check still applies. A name sent through the proxy is
 * resolved abroad through it too (egress-proxy.ts), and the tunnel goes to the checked address.
 * "direct" is for paid APIs called straight (SocialData, Dajiala) and the site's own addresses.
 */
export type EgressRoute = "egress" | "direct";

let proxyAgent: ProxyAgent | null = null;
let directAgent: Agent | null = null;
let privateFeedAgent: Agent | null = null;
let pinnedCurve: Agent | null = null;
let resolveEgress: ReturnType<typeof createEgressResolver> | null = null;

function egressResolver() {
  return resolveEgress ??= createEgressResolver(config.egressProxyUrl!);
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** PRIVATE_FEED_HOSTS names are self-hosted services: connected directly, never through the proxy. */
function privateFeedHosts(): string[] {
  return config.allowPrivateNetworkFetch ? [] : [...config.privateFeedHosts];
}

function proxied(url: URL, route: EgressRoute, privateHosts: readonly string[]): boolean {
  if (route !== "egress" || !config.egressProxyUrl) return false;
  const host = hostOf(url);
  return net.isIP(host) === 0 && !privateHosts.includes(host) && !host.endsWith(".cn") && !host.endsWith(".local");
}

function dispatcherFor(viaProxy: boolean, privateHost: boolean): Dispatcher | undefined {
  if (viaProxy) {
    proxyAgent ??= createEgressProxy(config.egressProxyUrl!, egressResolver());
    return proxyAgent;
  }
  if (config.allowPrivateNetworkFetch) return undefined;
  if (privateHost) {
    // The listed name may resolve to a private service; the address dialled is still checked.
    privateFeedAgent ??= new Agent({ ...OUTBOUND_HTTP_OPTIONS, connect: {
      lookup: ((hostname: string, options: never, callback: never) => guardedLookup(hostname, options, callback, privateFeedHosts())) as never,
    } });
    return privateFeedAgent;
  }
  // Direct connections resolve through the guarded lookup: the address actually dialled is checked.
  directAgent ??= new Agent({ ...OUTBOUND_HTTP_OPTIONS, connect: { lookup: guardedLookup as never } });
  return directAgent;
}

/**
 * Some government TLS stacks answer Node's preferred X25519 key share with a point OpenSSL refuses
 * (ERR_SSL_BAD_ECPOINT, e.g. mzt.hunan.gov.cn): the page loads in a browser and in curl, and with
 * the curve pinned to P-256. Node's "auto" curve list starts with X25519, so the same request is
 * retried once on an agent that offers only P-256. Every browser still negotiates P-256, so pinning
 * loses nothing.
 */
function pinnedCurveAgent(): Agent | undefined {
  // With the private-network allowance on, requests already use undici's default agents and no
  // address check runs; pinning a curve would silently re-introduce the check for those hosts.
  if (config.allowPrivateNetworkFetch) return undefined;
  pinnedCurve ??= new Agent({ ...OUTBOUND_HTTP_OPTIONS, connect: { lookup: guardedLookup as never, ecdhCurve: "prime256v1" } });
  return pinnedCurve;
}

/**
 * The refused key share, read off the cause chain undici wraps it in. It can only come from the key
 * exchange, before any request byte is sent, so the retry never replays a request a server has seen
 * (a paid API would bill it twice). EPROTO is not matched: it also follows a request already sent.
 */
function brokenHandshake(error: unknown): boolean {
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause; depth++) {
    const code = (cause as { code?: string }).code;
    if (code === "ERR_SSL_BAD_ECPOINT") return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

export interface GuardedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Follow redirects manually so every hop passes the SSRF guard. */
  maxRedirects?: number;
  /** "egress" by default; see EgressRoute. */
  route?: EgressRoute;
}

export interface GuardedResponse {
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
  text(): string;
}

/** How the collectors introduce themselves: the site's own crawler name and address (industry/site.ts). */
export const DEFAULT_UA = `Mozilla/5.0 (compatible; ${SITE.crawlerName}/1.0; +${config.siteUrl}/about)`;

export async function guardedFetch(input: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  // One budget includes DNS, every redirect and the body. Restarting it at each hop allowed a
  // nominal 20 s image request to occupy the API for minutes.
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const route = opts.route ?? "egress";
  const configuredHost = hostOf(new URL(input));
  // Only a PRIVATE_FEED_HOSTS name may reach a private service; redirects lose the exception.
  const privateHosts = privateFeedHosts().includes(configuredHost) ? [configuredHost] : [];
  const check = (target: string) => withinDeadline(
    assertPublicUrl(target, config.allowPrivateNetworkFetch,
      proxied(new URL(target), route, privateHosts) ? egressResolver() : undefined, privateHosts), signal,
  );
  let url = await check(input);
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  for (let hop = 0; ; hop++) {
    const viaProxy = proxied(url, route, privateHosts);
    const privateHost = privateHosts.includes(hostOf(url));
    const send = (dispatcher: Dispatcher | undefined) => undiciFetch(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": DEFAULT_UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: "manual",
      dispatcher,
      signal,
    });
    const res = await send(dispatcherFor(viaProxy, privateHost)).catch(async (error: unknown) => {
      // Only a direct connection has a curve of its own to change, and only while the budget lasts:
      // a retry on an aborted signal fails the same way and hides the original error.
      const pinned = viaProxy || privateHost || signal.aborted || !brokenHandshake(error) ? undefined : pinnedCurveAgent();
      if (!pinned) throw error;
      return send(pinned);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // Release the connection even when the next URL is refused or the redirect limit is reached.
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new Error(`Too many redirects for ${input}`);
      url = await check(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error(`Response too large from ${url.hostname}`);
        chunks.push(Buffer.from(chunk));
      }
    }
    const body = Buffer.concat(chunks);
    return {
      status: res.status,
      url: url.toString(),
      headers: res.headers as unknown as Headers,
      body,
      text: () => decodeBody(body, res.headers.get("content-type")),
    };
  }
}

/** DNS lookup cannot be cancelled, but a timed-out lookup must never continue into a fetch. */
async function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () => reject(signal.reason));
    })]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}

function decodeBody(body: Buffer, contentType: string | null): string {
  const m = /charset=([\w-]+)/i.exec(contentType ?? "");
  let charset = m?.[1]?.toLowerCase() ?? "utf-8";
  if (!m) {
    const head = body.subarray(0, 2048).toString("latin1");
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ?? /encoding=["']([\w-]+)/i.exec(head);
    if (meta) charset = meta[1]!.toLowerCase();
  }
  let text: string;
  try {
    text = new TextDecoder(charset === "gb2312" ? "gbk" : charset).decode(body);
  } catch {
    text = body.toString("utf8");
  }
  // A character lost on the way reads as one U+FFFD however many of its bytes were garbled (some
  // feeds send two or three for one character), so text cut to a length keeps the same cut.
  return text.replace(/\uFFFD+/g, "\uFFFD");
}
