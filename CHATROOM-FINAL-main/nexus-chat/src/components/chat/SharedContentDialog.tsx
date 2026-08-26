import { useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Images, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChat } from "@/lib/chat-store";
import { isMediaAttachment } from "@/lib/attachments";
import { isSafeHref } from "@/lib/link-preview";
import type { RoomId, SharedMessage } from "@/lib/chat-types";
import { MediaAttachment } from "./MediaAttachment";
import { ForwardDialog } from "./ForwardDialog";

export function SharedContentDialog({
  open,
  onOpenChange,
  roomId,
  conversationLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId?: RoomId | null;
  conversationLabel?: string;
}) {
  const { activeRoom, messages, rooms, roomTitle } = useChat();
  const [forwarding, setForwarding] = useState<SharedMessage | null>(null);
  const targetRoomId = roomId === undefined ? activeRoom.id : roomId;
  const targetRoom = rooms.find((room) => room.id === targetRoomId);
  const roomMessages = useMemo(
    () =>
      targetRoomId
        ? messages.filter((message) => message.roomId === targetRoomId && !message.deletedAt)
        : [],
    [messages, targetRoomId],
  );
  const media = roomMessages.filter(
    (message) => message.attachment && isMediaAttachment(message.attachment),
  );
  const docs = roomMessages.filter(
    (message) => message.attachment && !isMediaAttachment(message.attachment),
  );
  const links = roomMessages.flatMap((message) =>
    (message.linkPreviews ?? []).map((preview) => ({ message, preview })),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Images className="h-5 w-5" /> Media, links and docs
            </DialogTitle>
            <DialogDescription>
              Shared in {conversationLabel ?? (targetRoom ? roomTitle(targetRoom) : "this chat")}
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="media" className="min-h-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="media">Media ({media.length})</TabsTrigger>
              <TabsTrigger value="docs">Docs ({docs.length})</TabsTrigger>
              <TabsTrigger value="links">Links ({links.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="media" className="max-h-[64vh] overflow-y-auto pt-3">
              {media.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {media.map((message) => (
                    <MediaAttachment
                      key={message.id}
                      attachment={message.attachment!}
                      mine={false}
                      display="gallery"
                      onForward={() => setForwarding(message)}
                    />
                  ))}
                </div>
              ) : (
                <Empty label="No photos or videos shared yet." />
              )}
            </TabsContent>

            <TabsContent value="docs" className="max-h-[64vh] space-y-2 overflow-y-auto pt-3">
              {docs.length ? (
                docs.map((message) => (
                  <a
                    key={message.id}
                    href={message.attachment!.dataUrl}
                    download={message.attachment!.name}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:bg-secondary"
                  >
                    <span className="rounded-lg bg-primary/10 p-2 text-primary">
                      <FileText className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {message.attachment!.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {Math.max(1, Math.round(message.attachment!.size / 1024))} KB
                      </span>
                    </span>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))
              ) : (
                <Empty label="No documents shared yet." />
              )}
            </TabsContent>

            <TabsContent value="links" className="max-h-[64vh] space-y-2 overflow-y-auto pt-3">
              {links.length ? (
                links.map(({ message, preview }, index) =>
                  isSafeHref(preview.url) ? (
                    <a
                      key={`${message.id}-${index}`}
                      href={preview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:bg-secondary"
                    >
                      <span className="rounded-lg bg-primary/10 p-2 text-primary">
                        <Link2 className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{preview.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {preview.url}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  ) : null,
                )
              ) : (
                <Empty label="No links shared yet." />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
    </>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-16 text-center text-sm text-muted-foreground">{label}</p>;
}
