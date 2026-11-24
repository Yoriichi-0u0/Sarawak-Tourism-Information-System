// The STIS media library: every image shown in the app, with its subject, source, author and licence.
import { mediaLibrary } from "./mediaLibrary.ts";

export type MediaAsset = {
  id: string;
  /** What the image actually shows. */
  subject: string;
  alt: string;
  /** Records this image depicts exactly. On any other record it is shown as a representative image. */
  recordIds: string[];
  /** CSS object-position used when the image is cropped. */
  focus: string;
  width: number;
  height: number;
  widths: number[];
  kind: "photo" | "illustration";
  author: string;
  licence: string;
  licenceUrl: string;
  source: string;
  sourceUrl: string;
  title: string;
  changes: string;
  originalSize: number[];
};

const byId = new Map(mediaLibrary.map((asset) => [asset.id, asset]));

export const mediaAsset = (id: string | undefined): MediaAsset | undefined => (id ? byId.get(id) : undefined);
export const mediaIds: ReadonlySet<string> = new Set(byId.keys());
export { mediaLibrary };

/** How an image relates to the record it is shown on, so captions never overstate what a picture proves. */
export function mediaRole(asset: MediaAsset, recordId?: string): "exact" | "representative" | "illustration" {
  if (asset.kind === "illustration") return "illustration";
  return recordId && asset.recordIds.includes(recordId) ? "exact" : "representative";
}

export function mediaCredit(asset: MediaAsset): string {
  return asset.kind === "illustration" ? "AI-generated illustration" : `${asset.author} · ${asset.licence} · ${asset.source}`;
}

export function srcSet(asset: MediaAsset, format: "avif" | "webp") {
  return asset.widths.map((width) => `/media/${asset.id}-${width}.${format} ${width}w`).join(", ");
}
