import { useMemo, useState } from "react";
import { Check, Search, Send } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/lib/chat-types";
import { useChat } from "@/lib/chat-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GroupAvatar, UserAvatar } from "./UserAvatar";

export function ShareProfileDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { currentUserId, roomTitle, sendMessage, userById, visibleRooms } = useChat();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const candidates = useMemo(() => {
    const search = query.trim().toLowerCase();
    return visibleRooms.filter((room) => {
      const memberNames = room.participantIds.map((id) => userById(id).name).join(" ");
      return `${roomTitle(room)} ${memberNames}`.toLowerCase().includes(search);
    });
  }, [query, roomTitle, userById, visibleRooms]);

  const close = () => {
    setQuery("");
    setSelected([]);
    onOpenChange(false);
  };

  const share = () => {
    for (const roomId of selected) {
      sendMessage(roomId, `Shared ${user.name}'s contact`, {
        sharedProfileUserId: user.id,
      });
    }
    toast.success(
      selected.length === 1
        ? "Contact shared"
        : `Contact shared to ${selected.length} conversations`,
    );
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Share contact in KIRANOS
          </DialogTitle>
          <DialogDescription>
            Select internal conversations. Nothing is shared outside this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
          <UserAvatar user={user} size={42} showStatus />
          <div>
            <p className="font-semibold">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.role}</p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats or members"
            aria-label="Search internal conversations"
            className="h-9 bg-surface pl-9 text-sm"
          />
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {candidates.map((room) => {
            const otherId = room.participantIds.find((id) => id !== currentUserId);
            const active = selected.includes(room.id);
            return (
              <button
                key={room.id}
                aria-pressed={active}
                onClick={() =>
                  setSelected((current) =>
                    active ? current.filter((id) => id !== room.id) : [...current, room.id],
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
          {candidates.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No internal conversations found.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={selected.length === 0} onClick={share}>
            Share{selected.length ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
