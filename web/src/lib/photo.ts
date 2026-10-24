/** A photo from the camera or the library, made ready to upload: any format the browser can open (HEIC on iPhone too),
 *  at most 1600 px on its longest side, as JPEG. Phone photos are 3-12 MB; this keeps uploads quick and under bucket limits. */
export async function shrinkPhoto(file: Blob, max = 1600): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => { throw new Error("Couldn't open that photo. Try another one."); });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read the photo."))), "image/jpeg", 0.85));
}
