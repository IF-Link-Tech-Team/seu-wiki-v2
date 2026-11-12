// Import the verified Git objects without relying on Windows-incompatible source filenames.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-guide-2.ts <verified-object-directory>");
const root = path.resolve(import.meta.dirname, "..");
const entries = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8")) as Array<{ path: string; sha: string }>;
const objects = new Map<string, Buffer>();
for (const entry of entries) {
  const data = await readFile(path.join(source, entry.sha));
  const actual = createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
  if (actual !== entry.sha) throw new Error(`Hash mismatch: ${entry.path}`);
  objects.set(entry.path, data);
}
const index = JSON.parse(objects.get("articles_index.json")!.toString("utf8")) as Array<{ title: string; web_path: string; slug: string; path: string[] }>;
const articles = index.map((article) => {
  const body = objects.get(article.web_path);
  if (!body) throw new Error(`Missing article: ${article.web_path}`);
  return { ...article, markdown: body.toString("utf8") };
});
const imageSizes: Record<string, { width: number; height: number }> = {};
for (const entry of entries.filter((e) => e.path.startsWith("assets/uploads_projects/"))) {
  const existing = await readFile(path.join(root, "apps/web/public/knowledge-assets", path.basename(entry.path)));
  if (!existing.equals(objects.get(entry.path)!)) throw new Error(`Image differs: ${entry.path}`);
  const { width, height } = await sharp(existing).metadata();
  if (!width || !height) throw new Error(`Image dimensions unavailable: ${entry.path}`);
  imageSizes[path.basename(entry.path)] = { width, height };
}
const destination = path.join(root, "packages/backend/src/publication/guide-2.json");
await writeFile(destination, JSON.stringify(articles), { encoding: "utf8", flag: "wx" });
await writeFile(path.join(root, "packages/backend/src/publication/guide-2-images.json"), JSON.stringify(imageSizes), { encoding: "utf8", flag: "wx" });
console.log(`Imported ${articles.length} indexed articles; verified images.`);
