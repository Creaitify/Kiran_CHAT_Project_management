import { useState } from "react";
import { Copy, Download, Forward, Play } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@/lib/chat-types";
import { copyAttachmentToClipboard, mediaKind } from "@/lib/attachments";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function MediaAttachment({
  attachment,
  mine,
  onForward,
  display = "message",
}: {
  attachment: Attachment;
  mine: boolean;
  onForward: () => void;
  display?: "message" | "gallery";
}) {
  const [open, setOpen] = useState(false);
  const kind = mediaKind(attachment);
  if (!kind) return null;

  const copyMedia = async () => {
    try {
      const result = await copyAttachmentToClipboard(attachment);
      toast.success(
        result === "binary"
          ? `${kind === "video" ? "Video" : "Image"} copied`
          : `${kind === "video" ? "Video" : "Image"} copied for pasting in chat`,
      );
    } catch {
      toast.error(`Could not copy this ${kind}`);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${kind} ${attachment.name}`}
        className={cn(
          "group/media relative block overflow-hidden border text-left shadow-sm",
          display === "gallery" ? "aspect-square w-full rounded-lg" : "mt-2 max-w-sm rounded-xl",
          mine ? "border-primary-foreground/20 bg-black/15" : "border-border bg-black/5",
        )}
      >
        {kind === "image" ? (
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            className={cn(
              "w-full transition-transform duration-200 group-hover/media:scale-[1.01]",
              display === "gallery" ? "h-full object-cover" : "max-h-[420px] object-contain",
            )}
          />
        ) : (
          <>
            <video
              src={attachment.dataUrl}
              preload="metadata"
              muted
              playsInline
              className={cn(
                "pointer-events-none w-full bg-black",
                display === "gallery" ? "h-full object-cover" : "max-h-[420px] object-contain",
              )}
            />
            <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </span>
          </>
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover/media:opacity-100">
          {attachment.name}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[100dvh] w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none sm:rounded-none [&>button]:z-20 [&>button]:text-white">
          <DialogTitle className="sr-only">Viewing {attachment.name}</DialogTitle>
          <div className="absolute inset-x-0 top-0 z-10 flex h-16 items-center bg-gradient-to-b from-black/75 to-transparent px-4 pr-14">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.name}</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void copyMedia()}
                aria-label={`Copy ${kind}`}
                title={`Copy ${kind}`}
                className="rounded-full p-2.5 text-white transition-colors hover:bg-white/15"
              >
                <Copy className="h-5 w-5" />
              </button>
              <a
                href={attachment.dataUrl}
                download={attachment.name}
                aria-label="Download media"
                title="Download"
                className="rounded-full p-2.5 text-white transition-colors hover:bg-white/15"
              >
                <Download className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onForward();
                }}
                aria-label="Forward media"
                title="Forward"
                className="rounded-full p-2.5 text-white transition-colors hover:bg-white/15"
              >
                <Forward className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex h-full w-full items-center justify-center p-4 pt-16">
            {kind === "image" ? (
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="max-h-full max-w-full select-none object-contain"
              />
            ) : (
              <video
                src={attachment.dataUrl}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full object-contain"
              >
                Your browser does not support video playback.
              </video>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
