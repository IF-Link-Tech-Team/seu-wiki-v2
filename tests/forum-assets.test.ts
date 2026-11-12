import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveForumAssetUrl } from "../apps/web/app/lib/forum-assets.ts";

test("forum asset references resolve against the forum origin", () => {
  const forum = "https://forum.seu.wiki";
  assert.equal(
    resolveForumAssetUrl("/api/media/post-assets/example.jpg", forum),
    "https://forum.seu.wiki/api/media/post-assets/example.jpg",
  );
  assert.equal(
    resolveForumAssetUrl("https://cdn.example.test/image.jpg", forum),
    "https://cdn.example.test/image.jpg",
  );
  assert.equal(resolveForumAssetUrl("//cdn.example.test/image.jpg", forum), "https://cdn.example.test/image.jpg");
});
