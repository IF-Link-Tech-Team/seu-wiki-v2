import { fileTypeFromBuffer } from "file-type";

const RASTER_TYPES = new Set([
  "image/png", "image/apng", "image/jpeg", "image/webp", "image/gif",
  "image/avif", "image/heic", "image/heif", "image/tiff",
]);

// Check binary signatures before invoking native decoders; HTTP MIME types are untrusted.
export async function rasterImageType(data: Buffer): Promise<string | null> {
  const detected = await fileTypeFromBuffer(data.subarray(0, 4100)).catch(() => undefined);
  return detected && RASTER_TYPES.has(detected.mime) ? detected.mime : null;
}
