import { useState } from "react";
import {
  BriefcaseBusiness,
  Camera,
  ChevronRight,
  Globe2,
  Images,
  MapPin,
  MessageCircle,
  Share2,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { User } from "@/lib/chat-types";
import { useChat } from "@/lib/chat-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "./UserAvatar";
import { ShareProfileDialog } from "./ShareProfileDialog";
import { SharedContentDialog } from "./SharedContentDialog";
import { ProfilePhotoEditorDialog } from "./ProfilePhotoEditorDialog";

export function UserProfileDialog({
  user,
  open,
  onOpenChange,
  onRemoveFromGroup,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveFromGroup?: () => void;
}) {
  const { activeRoom, addMembers, createGroupDm, currentUserId, messages, openDirect, rooms } =
    useChat();
  const [shareUser, setShareUser] = useState<User | null>(null);
  const [sharedContentOpen, setSharedContentOpen] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const isCurrentUser = user.id === currentUserId;
  const canAddToCurrentGroup =
    activeRoom.type !== "direct" && !activeRoom.participantIds.includes(user.id);
  const directRoom = isCurrentUser
    ? undefined
    : rooms.find(
        (room) =>
          room.type === "direct" &&
          room.participantIds.length === 2 &&
          room.participantIds.includes(currentUserId) &&
          room.participantIds.includes(user.id),
      );
  const sharedItemCount = messages
    .filter((message) => message.roomId === directRoom?.id && !message.deletedAt)
    .reduce(
      (count, message) =>
        count + (message.attachment ? 1 : 0) + (message.linkPreviews?.length ?? 0),
      0,
    );
  const closeAnd = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md gap-5 p-0 overflow-hidden">
          <div className="h-24 bg-gradient-to-br from-primary/85 via-sky-500/70 to-violet-500/65" />
          <div className="-mt-14 px-6 pb-6">
            <div className="flex items-end justify-between gap-4">
              <div className="relative">
                <UserAvatar
                  user={user}
                  size={92}
                  showStatus
                  className="ring-4 ring-background rounded-full"
                />
                {isCurrentUser && (
                  <button
                    type="button"
                    onClick={() => setPhotoEditorOpen(true)}
                    aria-label="Edit my profile photo"
                    title="Edit profile photo"
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                )}
              </div>
              <span className="mb-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {user.online ? "Online now" : "Offline"}
              </span>
            </div>
            <DialogHeader className="mt-4 text-left">
              <DialogTitle className="text-xl">{user.name}</DialogTitle>
              <DialogDescription>{user.role}</DialogDescription>
            </DialogHeader>

            <div className="mt-5 grid gap-2 rounded-xl border border-border bg-surface-2 p-3 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <BriefcaseBusiness className="h-4 w-4 text-primary" /> Product & collaboration
                workspace
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <Globe2 className="h-4 w-4 text-primary" /> {user.timeZone}
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 text-primary" /> Available for conversations
              </p>
            </div>

            {!isCurrentUser && (
              <div className="mt-5 grid grid-cols-3 gap-2">
                <button
                  onClick={() => closeAnd(() => openDirect(user.id))}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium transition-colors hover:bg-secondary"
                >
                  <MessageCircle className="h-4 w-4 text-primary" /> Message
                </button>
                <button
                  onClick={() =>
                    closeAnd(() =>
                      canAddToCurrentGroup
                        ? addMembers(activeRoom.id, [user.id])
                        : createGroupDm([user.id]),
                    )
                  }
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium transition-colors hover:bg-secondary"
                >
                  <UserPlus className="h-4 w-4 text-primary" />{" "}
                  {canAddToCurrentGroup ? "Add to group" : "Start group"}
                </button>
                <button
                  onClick={() => {
                    setShareUser(user);
                    onOpenChange(false);
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium transition-colors hover:bg-secondary"
                >
                  <Share2 className="h-4 w-4 text-primary" /> Share profile
                </button>
              </div>
            )}

            {onRemoveFromGroup && (
              <button
                type="button"
                onClick={onRemoveFromGroup}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" /> Remove from group
              </button>
            )}

            <button
              type="button"
              onClick={() => setSharedContentOpen(true)}
              className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 text-left transition-colors hover:bg-secondary"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <Images className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Media, links and docs</span>
                <span className="block text-[11px] text-muted-foreground">
                  {sharedItemCount} shared {sharedItemCount === 1 ? "item" : "items"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ShareProfileDialog
        user={shareUser ?? user}
        open={Boolean(shareUser)}
        onOpenChange={(next) => !next && setShareUser(null)}
      />
      <SharedContentDialog
        open={sharedContentOpen}
        onOpenChange={setSharedContentOpen}
        roomId={directRoom?.id ?? null}
        conversationLabel={`your personal chat with ${user.name}`}
      />
      <ProfilePhotoEditorDialog
        user={user}
        open={photoEditorOpen}
        onOpenChange={setPhotoEditorOpen}
      />
    </>
  );
}
