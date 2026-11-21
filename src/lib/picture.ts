import { c } from "@/lib/core";

// Any image in, a small square JPEG out. Re-encoding through a canvas also drops EXIF and location data.
export async function compressPicture(file: File): Promise<{ b64: string; size: number; bytes: number }> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  for (const size of [144, 128, 112, 96, 80, 64, 48]) {
    const cv = document.createElement("canvas"); cv.width = cv.height = size;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
      const url = cv.toDataURL("image/jpeg", q);
      const b64 = url.slice(url.indexOf(",") + 1);
      if (b64.length <= c.PFP_MAX_B64) return { b64, size, bytes: c.b64Decode(b64).length };
    }
  }
  throw new Error("This picture would not fit in one signed message. Try a simpler image.");
}
