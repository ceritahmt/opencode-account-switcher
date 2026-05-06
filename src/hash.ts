import { createHash } from "node:crypto";

export function sha256AuthHash(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
