/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import {
  Camera,
  Images,
  MessageCircle,
  Search,
  Settings,
  Share2,
  Trash2,
  VolumeX,
} from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useChat } from "../store/chat-store";
import type { User } from "../lib/chat-types";
import { GroupAvatar, UserAvatar } from "./UserAvatar";
import { UserProfileDialog } from "./UserProfileDialog";
import { SharedContentDialog } from "./SharedContentDialog";
import { GroupPhotoEditorDialog } from "./GroupPhotoEditorDialog";

export function GroupProfileDialog({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}) {
  const {
    activeRoom,
    currentUserId,
    isAdmin,
    messages,
    openDirect,
    removeMember,
    roomTitle,
    toggleUserMute,
    userById,
  } = useChat();
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const [query, setQuery] = useState("");
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [sharedContentOpen, setSharedContentOpen] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const admin = isAdmin(activeRoom, currentUserId);
  const members = useMemo(() => {
    const search = query.trim().toLowerCase();
    return activeRoom.participantIds
      .map(userById)
      .filter((user) => `${user.name} ${user.role}`.toLowerCase().includes(search));
  }, [activeRoom.participantIds, query, userById]);
  const sharedCount = messages
    .filter((message) => message.roomId === activeRoom.id && !message.deletedAt)
    .reduce(
      (count, message) =>
        count + (message.attachment ? 1 : 0) + (message.linkPreviews?.length ?? 0),
      0,
    );

  const shareGroup = async () => {
    const link = `${window.location.origin}/${slug}/chat?room=${encodeURIComponent(activeRoom.id)}`;
    await navigator.clipboard.writeText(link);
    toast.success("Conversation link copied");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-hidden rounded-xl">
          <DialogHeader className="items-center text-center">
            <button
              type="button"
              onClick={() => setPhotoEditorOpen(true)}
              className="group relative rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              aria-label={activeRoom.photo ? "Change group photo" : "Add group photo"}
              title={activeRoom.photo ? "Change group photo" : "Add group photo"}
            >
              <GroupAvatar
                name={roomTitle(activeRoom)}
                color={activeRoom.color}
                photo={activeRoom.photo}
                size={72}
              />
              <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-primary text-primary-foreground shadow-md transition-transform group-hover:scale-110">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <DialogTitle className="pt-2 text-xl">{roomTitle(activeRoom)}</DialogTitle>
            <DialogDescription>
              {activeRoom.topic || `${activeRoom.participantIds.length} members`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => void shareGroup()}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium hover:bg-secondary"
            >
              <Share2 className="h-4 w-4 text-primary" /> Share chat
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium hover:bg-secondary"
            >
              <MessageCircle className="h-4 w-4 text-primary" /> Group message
            </button>
            <button
              onClick={() => {
                onOpenChange(false);
                onOpenSettings();
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium hover:bg-secondary"
            >
              <Settings className="h-4 w-4 text-primary" /> Settings
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSharedContentOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 text-left transition-colors hover:bg-secondary"
          >
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Images className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Media, links and docs</span>
              <span className="text-[11px] text-muted-foreground">
                {sharedCount} shared {sharedCount === 1 ? "item" : "items"}
              </span>
            </span>
          </button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              className="h-9 bg-surface pl-9"
            />
          </div>

          <div className="min-h-0 max-h-[42vh] space-y-1 overflow-y-auto pr-1">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Members · {activeRoom.participantIds.length}
            </p>
            {members.map((member) => {
              const memberIsAdmin = activeRoom.adminIds.includes(member.id);
              const isSelf = member.id === currentUserId;
              const memberIsMuted = activeRoom.mutedUserIds.includes(member.id);
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-secondary"
                >
                  <button
                    type="button"
                    onClick={() => setProfileUser(member)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <UserAvatar user={member} size={40} showStatus />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 truncate text-sm font-semibold">
                        {member.name}
                        {memberIsAdmin && (
                          <span className="rounded-md bg-online/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-online">
                            Admin
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {member.role}
                      </span>
                    </span>
                  </button>
                  {!isSelf && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      aria-label={`Message ${member.name}`}
                      title={`Message ${member.name}`}
                      onClick={() => {
                        onOpenChange(false);
                        openDirect(member.id);
                      }}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  )}
                  {admin && !isSelf && (
                    <button
                      type="button"
                      onClick={() => toggleUserMute(activeRoom.id, member.id)}
                      aria-label={`${memberIsMuted ? "Unmute" : "Mute"} ${member.name}`}
                      title={memberIsMuted ? "Unmute member" : "Mute member"}
                      className={
                        memberIsMuted
                          ? "rounded-lg bg-destructive/10 p-2 text-destructive hover:bg-destructive/15"
                          : "rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }
                    >
                      <VolumeX className="h-4 w-4" />
                    </button>
                  )}
                  {admin && !isSelf && (
                    <button
                      type="button"
                      onClick={() => removeMember(activeRoom.id, member.id)}
                      aria-label={`Remove ${member.name} from group`}
                      title="Remove from group"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <UserProfileDialog
        user={profileUser ?? userById(currentUserId)}
        open={Boolean(profileUser)}
        onOpenChange={(next) => !next && setProfileUser(null)}
        {...(profileUser && admin && profileUser.id !== currentUserId
          ? {
              onRemoveFromGroup: () => {
                removeMember(activeRoom.id, profileUser.id);
                setProfileUser(null);
              },
            }
          : {})}
      />
      <SharedContentDialog
        open={sharedContentOpen}
        onOpenChange={setSharedContentOpen}
        roomId={activeRoom.id}
        conversationLabel={roomTitle(activeRoom)}
      />
      <GroupPhotoEditorDialog
        room={activeRoom}
        name={roomTitle(activeRoom)}
        open={photoEditorOpen}
        onOpenChange={setPhotoEditorOpen}
      />
    </>
  );
}
