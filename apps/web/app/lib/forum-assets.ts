/** Resolve media references against the forum origin that owns them.
 *
 * The forum API may return either an absolute asset URL or a path such as
 * `/api/media/...`. A path is relative to the API's origin, not the page that
 * happens to render the post (the wiki site and forum are separate origins).
 */
export function resolveForumAssetUrl(assetUrl: string, forumBase: string): string {
  try {
    return new URL(assetUrl, `${forumBase.replace(/\/+$/, "")}/`).toString();
  } catch {
    // Keep the original value so one malformed asset cannot break the whole list.
    return assetUrl;
  }
}
