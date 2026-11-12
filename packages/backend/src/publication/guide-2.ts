// SEU 生存指南 2.0：原稿按上游索引顺序保存，阅读时转换为安全 HTML。
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { convertDoc, repairStrongMarkers } from "../knowledge/markdown.ts";

interface GuideArticle {
  title: string;
  web_path: string;
  slug: string;
  path: string[];
  markdown: string;
}

const articles = JSON.parse(readFileSync(new URL("./guide-2.json", import.meta.url), "utf8")) as GuideArticle[];
const imageSizes = JSON.parse(readFileSync(new URL("./guide-2-images.json", import.meta.url), "utf8")) as Record<string, { width: number; height: number }>;

export function guide2Index() {
  return articles.map(({ title, web_path, slug, path: originalPath }) => ({
    title,
    slug,
    // 上游索引的 path 省略了篇名，文件路径保留该层。
    groups: web_path.includes("/") ? [web_path.split("/")[0]!, ...originalPath.slice(0, -1)] : [],
  }));
}

export function guide2Full() {
  return articles.map(({ slug }) => {
    const { title, html } = guide2Article(slug)!;
    const $ = cheerio.load(html, null, false);
    $("[id]").each((_, element) => { $(element).attr("id", `guide-${slug}-${$(element).attr("id")}`); });
    $("a[href^='#']").each((_, element) => {
      const href = $(element).attr("href")!;
      if (href.length > 1) $(element).attr("href", `#guide-${slug}-${href.slice(1)}`);
    });
    $("img").each((_, element) => {
      const img = $(element);
      const size = imageSizes[path.posix.basename(img.attr("src") ?? "")];
      if (size) img.attr({ width: String(size.width), height: String(size.height), loading: "lazy" });
    });
    return { title, slug, html: $.html() };
  });
}

export function guide2Article(slug: string) {
  const position = articles.findIndex((article) => article.slug === slug);
  if (position < 0) return null;
  const article = articles[position]!;
  // 上游每篇开头的纯锚点列表是重复目录；正文内的链接和标题保留。
  const lines = article.markdown.split("\n");
  let start = 0;
  while (start < lines.length && (/^\s*$/.test(lines[start]!) || /^\s*(?:[-*+]\s+)?(?:\[[^\]]*\]\(#[\w-]+\)\s*)+$/.test(lines[start]!))) start++;
  const markdown = lines.slice(start).map((line) => {
    // 上游个别段落的斜体与加粗定界符相互交错，先消除多余定界符。
    line = line.replace("*_【考研报名】", "【考研报名】").replace("并到*报考点现场确认*网报信息和采集本人图像等相关电子信息，同时按规定缴纳报考费。_", "并到报考点现场确认网报信息和采集本人图像等相关电子信息，同时按规定缴纳报考费。");
    line = line.replace("*“我的时间管理不敢说很好", "“我的时间管理不敢说很好").replace("没课的时候如果作业还没写完就接着写。***", "没课的时候如果作业还没写完就接着写。**");
    line = line.replace("***应届本科毕业生**", "**应届本科毕业生**").replace("办理网上报名和现场确认手续。*", "办理网上报名和现场确认手续。");
    return line.includes("**") ? repairStrongMarkers(line) : line;
  }).join("\n");
  const converted = convertDoc(markdown, {
    resolveImage: (src) => {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(article.web_path), src));
      return /^assets\/uploads_projects\/[a-f0-9]+\.(?:png|jpe?g)$/i.test(resolved)
        ? `/knowledge-assets/${path.posix.basename(resolved)}` : null;
    },
  });
  // 上游索引链接使用随机锚点，但 Markdown 标题没有锚点；按链接文字恢复目标。
  const $ = cheerio.load(converted.html, null, false);
  const normalize = (text: string) => text.replace(/\s+/g, "").trim();
  const targets = $("h1, h2, h3, h4, h5, h6, p").toArray();
  $("a[href^='#']").each((_, link) => {
    const id = $(link).attr("href")!.slice(1);
    const text = normalize($(link).text());
    if (!id || !text || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const target = targets.find((element) => normalize($(element).text()) === text);
    if (target && !$(target).attr("id")) $(target).attr("id", id);
  });
  const html = $.html();
  const summary = (item: GuideArticle | undefined) => item ? { title: item.title, slug: item.slug } : null;
  return { title: article.title, slug, html, sourcePath: article.web_path, previous: summary(articles[position - 1]), next: summary(articles[position + 1]) };
}
