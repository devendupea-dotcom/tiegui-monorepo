import "server-only";

import { Buffer } from "node:buffer";

export async function fileToDataUrl(file: File): Promise<string> {
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type};base64,${base64}`;
}
