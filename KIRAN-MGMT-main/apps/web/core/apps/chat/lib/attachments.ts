/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Attachment classification and clipboard handling.
 *
 * MIME type is checked first and the file extension is only a fallback, because
 * a browser will happily hand over an `application/octet-stream` for a `.mov`
 * dragged in from some file managers.
 */

import type { Attachment } from "./chat-types";

export function mediaKind(attachment: Attachment): "image" | "video" | null {
  if (attachment.type.startsWith("image/")) return "image";
  if (attachment.type.startsWith("video/")) return "video";
  const extension = attachment.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"].includes(extension ?? "")) {
    return "image";
  }
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(extension ?? "")) return "video";
  return null;
}

export function isMediaAttachment(attachment: Attachment) {
  return mediaKind(attachment) !== null;
}

export async function copyAttachmentToClipboard(
  attachment: Attachment
): Promise<"binary" | "reference"> {
  const blob = await fetch(attachment.dataUrl).then((response) => response.blob());

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return "binary";
    } catch {
      // Chromium currently limits the binary MIME types accepted by the
      // clipboard. Keep videos pasteable inside the app via their data URL.
    }
  }

  await navigator.clipboard.writeText(attachment.dataUrl);
  return "reference";
}
