// 临时探针：验证东大各站（WebPlus 站群）列表页与正文的解析。
// 用法：ALLOW_PRIVATE_NETWORK_FETCH=1 node --env-file=.env scripts/probe-seu.ts
import { fetchWebList } from "../packages/backend/src/sources/web-list.ts";
import { extractFromUrl } from "../packages/backend/src/content/extract.ts";
import { guardedFetch } from "../packages/backend/src/lib/http-fetch.ts";

const SITES = [
  ["教务处·信息通知", "https://jwc.seu.edu.cn/xxtz/list.htm"],
  ["教务处·学籍管理", "https://jwc.seu.edu.cn/xjgl/list.htm"],
  ["教务处·实践教学", "https://jwc.seu.edu.cn/sjjx/list.htm"],
  ["学生处", "https://xsc.seu.edu.cn/",
  ],
  ["信息学院", "https://radio.seu.edu.cn/"],
  ["电子学院", "https://electronic.seu.edu.cn/"],
  ["自动化学院", "https://automation.seu.edu.cn/"],
  ["生医学院", "https://bme.seu.edu.cn/"],
] as const;

async function firstListPage(home: string): Promise<string | null> {
  if (home.endsWith("list.htm")) return home;
  const res = await guardedFetch(home, { timeoutMs: 20_000 });
  const m = res.text().match(/href="((?:https?:\/\/[^"]+)?\/[^"]*(?:tzgg|xxgk|xwtz|xyxw|tz|news|notice)[^"]*list\.htm)"/i)
    ?? res.text().match(/href="((?:https?:\/\/[^"]+)?\/[^"]+list\.htm)"/i);
  if (!m) return null;
  return new URL(m[1]!, home).toString();
}

for (const [name, home] of SITES) {
  try {
    const listUrl = await firstListPage(home);
    if (!listUrl) { console.log(`${name}: 首页没找到列表页`); continue; }
    const host = new URL(listUrl).origin;
    const source = { id: "probe", kind: "web_list", config: {
      url: listUrl, itemSelector: "tr", linkSelector: "a[title]",
      publishedAtSelector: 'div[align="right"]',
      allowUrlPrefixes: [`${host}/2`],
    } } as never;
    const items = await fetchWebList(source).catch(() => null);
    if (!items || items.length === 0) {
      // 退一步用宽松解析
      const loose = await fetchWebList({ id: "probe", kind: "web_list", config: { url: listUrl, allowUrlPrefixes: [`${host}/2`] } } as never).catch((e) => String(e));
      console.log(`${name}: 严格解析 0 条（${listUrl}），宽松解析:`, Array.isArray(loose) ? `${loose.length} 条，例: ${loose[0]?.title}` : loose);
      continue;
    }
    const first = items.find((c) => c.url.includes("/page.htm")) ?? items[0]!;
    const body = await extractFromUrl(first.url, { allowJina: false, subject: "probe" }).catch(() => null);
    console.log(`${name}: ${items.length} 条（${listUrl}）| 例: ${first.title?.slice(0, 24)} | 正文: ${body ? `${body.text.length}字(${body.via})` : "提取失败"}`);
  } catch (e) {
    console.log(`${name}: 抓取失败 ${String(e).slice(0, 80)}`);
  }
}
