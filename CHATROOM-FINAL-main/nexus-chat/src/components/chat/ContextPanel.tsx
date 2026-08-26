import { Clock, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupAvatar, UserAvatar } from "./UserAvatar";
import { useChat } from "@/lib/chat-store";
import { type UserId } from "@/lib/chat-types";
import { formatDate, localTimeFor } from "@/lib/time";
import { cn } from "@/lib/utils";

export function ContextPanel({
  onCreateGroup,
  onOpenSettings,
}: {
  onCreateGroup: (preselected: UserId[]) => void;
  onOpenSettings: (tab?: "about" | "members" | "invite" | "appearance") => void;
}) {
  const { activeRoom, roomTitle, userById, currentUserId, rooms } = useChat();

  /* ----------------------------- Direct message ---------------------------- */

  if (activeRoom.type === "direct") {
    const otherId = activeRoom.participantIds.find((id) => id !== currentUserId) ?? currentUserId;
    const other = userById(otherId);
    const mutual = rooms.filter(
      (room) =>
        room.type === "group" &&
        room.participantIds.includes(otherId) &&
        room.participantIds.includes(currentUserId),
    );

    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto bg-background p-4">
        <div className="glass flex flex-col items-center rounded-xl p-5 text-center">
          <UserAvatar user={other} size={64} showStatus />
          <h3 className="mt-3 text-lg font-semibold">{other.name}</h3>
          <p className="text-xs text-muted-foreground">{other.role}</p>
          <span
            className={cn(
              "mt-2 rounded-full px-2.5 py-0.5 text-[11px]",
              other.online ? "bg-online/15 text-online" : "bg-secondary text-muted-foreground",
            )}
          >
            {other.online ? "Online" : "Offline"}
          </span>
          <p
            suppressHydrationWarning
            className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <Clock className="h-3 w-3" /> {localTimeFor(other.timeZone)} local time
          </p>
        </div>

        <Section title="Actions">
          <Button
            variant="secondary"
            className="w-full justify-start rounded-lg"
            onClick={() => onCreateGroup([otherId])}
          >
            <Users className="mr-2 h-4 w-4" /> Create group with {other.name.split(" ")[0]}
          </Button>
          <Button
            variant="secondary"
            className="mt-2 w-full justify-start rounded-lg"
            onClick={() => onOpenSettings("about")}
          >
            <Settings className="mr-2 h-4 w-4" /> Conversation settings
          </Button>
        </Section>

        <Section title={`Mutual groups · ${mutual.length}`}>
          <div className="space-y-2">
            {mutual.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No shared groups yet.</p>
            )}
            {mutual.map((room) => (
              <div key={room.id} className="flex items-center gap-2 text-sm">
                <GroupAvatar
                  name={room.name ?? "G"}
                  color={room.color}
                  photo={room.photo}
                  size={30}
                />
                {room.name}
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  /* --------------------------- Group / group DM ---------------------------- */

  const participants = activeRoom.participantIds.map(userById);
  const onlineCount = participants.filter((user) => user.online).length;
  const isGroup = activeRoom.type === "group";

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-background p-4">
      <div className="glass flex flex-col items-center rounded-xl p-5 text-center">
        <GroupAvatar
          name={roomTitle(activeRoom)}
          color={activeRoom.color}
          photo={activeRoom.photo}
          size={64}
        />
        <h3 className="mt-3 text-lg font-semibold">{roomTitle(activeRoom)}</h3>
        {activeRoom.topic && <p className="mt-0.5 text-[11px] text-primary">{activeRoom.topic}</p>}
        {activeRoom.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {activeRoom.description}
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          {participants.length} members • {onlineCount} online
        </p>
        <p suppressHydrationWarning className="text-[11px] text-muted-foreground">
          {activeRoom.createdBy
            ? `Created by ${userById(activeRoom.createdBy).name.split(" ")[0]} · `
            : ""}
          {formatDate(activeRoom.createdAt)}
        </p>
        <Button
          variant="secondary"
          className="mt-3 w-full rounded-lg"
          onClick={() => onOpenSettings("about")}
        >
          <Settings className="mr-2 h-4 w-4" /> Settings
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-soft)]">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}
