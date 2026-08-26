import { useMemo, useState } from "react";
import { Check, Search, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GroupAvatar, UserAvatar } from "./UserAvatar";
import { useChat } from "@/lib/chat-store";
import { previewText, type SharedMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

export interface ForwardDialogProps {
  message: SharedMessage | null;
  onClose: () => void;
}

export function ForwardDialog({ message, onClose }: ForwardDialogProps) {
  const { visibleRooms, roomTitle, userById, currentUserId, forwardMessage, plainText } = useChat();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const candidates = useMemo(
    () =>
      visibleRooms.filter(
        (room) =>
          room.id !== message?.roomId &&
          roomTitle(room).toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [visibleRooms, roomTitle, query, message?.roomId],
  );

  const close = () => {
    setSelected([]);
    setQuery("");
    onClose();
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" /> Forward message
          </DialogTitle>
        </DialogHeader>

        {message && (
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{userById(message.senderId).name}:</span>{" "}
            <span className="line-clamp-2">{plainText(previewText(message))}</span>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations to forward to"
            className="h-9 bg-surface pl-9 text-sm"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No conversations found.
            </p>
          )}
          {candidates.map((room) => {
            const otherId = room.participantIds.find((id) => id !== currentUserId);
            const active = selected.includes(room.id);
            return (
              <button
                key={room.id}
                aria-pressed={active}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(room.id)
                      ? current.filter((id) => id !== room.id)
                      : [...current, room.id],
                  )
                }
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  active ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary",
                )}
              >
                {room.type === "direct" ? (
                  <UserAvatar user={userById(otherId ?? currentUserId)} size={32} />
                ) : (
                  <GroupAvatar
                    name={roomTitle(room)}
                    color={room.color}
                    photo={room.photo}
                    size={32}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {roomTitle(room)}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              if (message) forwardMessage(message.id, selected);
              close();
            }}
          >
            Forward{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
