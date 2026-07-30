export async function resizePhoto(file: File): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not resize photo")), "image/jpeg", 0.84),
    );
    return { blob, width, height };
  } catch {
    return { blob: file };
  }
}
