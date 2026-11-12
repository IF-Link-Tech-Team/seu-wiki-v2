import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { test } from "node:test";
import * as cheerio from "cheerio";
import { guide2Article, guide2Full, guide2Index } from "../packages/backend/src/publication/guide-2.ts";

test("2.0 preserves the indexed articles, deep groups, images and navigation", () => {
  const index = guide2Index();
  assert.equal(index.length, 65);
  assert.equal(new Set(index.map((item) => item.slug)).size, 65);
  assert.ok(index.some((item) => item.groups.length >= 4));
  let imageCount = 0;
  for (const [position, entry] of index.entries()) {
    const article = guide2Article(entry.slug);
    assert.ok(article);
    assert.ok(article.html.length > 0);
    assert.equal(article.previous?.slug ?? null, index[position - 1]?.slug ?? null);
    assert.equal(article.next?.slug ?? null, index[position + 1]?.slug ?? null);
    for (const match of article.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
      assert.match(match[1]!, /^\/knowledge-assets\//);
      assert.ok(existsSync(new URL(`../apps/web/public${match[1]}`, import.meta.url)), match[1]);
      imageCount++;
    }
  }
  assert.ok(imageCount > 30);
  assert.match(guide2Article("ol2iwr")!.html, /<h3>初心<\/h3>/);
  assert.equal(guide2Article("unknown"), null);
});

test("continuous guide namespaces article anchors and defers images", () => {
  const articles = guide2Full();
  assert.equal(articles.length, 65);
  const preface = articles.find((article) => article.slug === "ol2iwr")!;
  assert.doesNotMatch(preface.html, /href="#guide-ol2iwr-/);
  assert.match(preface.html, /<h3>初心<\/h3>/);
  assert.match(preface.html, /<img\b[^>]*loading="lazy"/);
  for (const article of articles) {
    for (const match of article.html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(match[0], /\bwidth="\d+"/);
      assert.match(match[0], /\bheight="\d+"/);
    }
  }
});

test("guide removes only leading navigation and repairs original emphasis", () => {
  for (const entry of guide2Index()) {
    const article = guide2Article(entry.slug)!;
    const $ = cheerio.load(article.html, null, false);
    assert.equal($("a[href^='#']").length, 0, entry.title);
    $("p,h1,h2,h3,h4,h5,li,td").each((_, element) => {
      $(element).contents().each((_, node) => {
        if (node.type === "text") assert.doesNotMatch(node.data, /\*{2,}/, entry.title);
      });
    });
  }
  const preface = guide2Article("ol2iwr")!.html;
  assert.match(preface, /<strong>观者自见，自己定义就好。<\/strong>/);
  assert.match(preface, /策划 \| SEU·生存指南运营团队/);
  assert.match(guide2Article("gqnp48")!.html, /<strong>一、3月-7\/8月 <\/strong>/);
  assert.match(guide2Article("tqdand")!.html, /目录框架 \( by 王绍勇\)/);
});
