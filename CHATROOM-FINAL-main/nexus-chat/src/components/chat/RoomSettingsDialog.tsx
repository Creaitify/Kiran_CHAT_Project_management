import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  Link2,
  LogOut,
  ImagePlus,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "./UserAvatar";
import { useChat } from "@/lib/chat-store";
import { formatDateTime, formatUntil } from "@/lib/time";
import { cn } from "@/lib/utils";
import { prepareWallpaper, useChatWallpaper } from "@/lib/chat-wallpaper";

const EXPIRY_OPTIONS = [
  { label: "24 hours", value: 86_400_000 },
  { label: "7 days", value: 7 * 86_400_000 },
  { label: "30 days", value: 30 * 86_400_000 },
  { label: "Never", value: null },
];

const USES_OPTIONS = [
  { label: "1 use", value: 1 },
  { label: "10 uses", value: 10 },
  { label: "50 uses", value: 50 },
  { label: "Unlimited", value: null },
];

export interface RoomSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which tab to land on — the /invite command deep-links here. */
  initialTab?: "about" | "members" | "invite" | "appearance";
}

export function RoomSettingsDialog({
  open,
  onOpenChange,
  initialTab = "about",
}: RoomSettingsDialogProps) {
  const {
    activeRoom,
    roomTitle,
    users,
    userById,
    currentUserId,
    isAdmin,
    renameRoom,
    setRoomTopic,
    setRoomDescription,
    addMembers,
    removeMember,
    toggleAdmin,
    leaveRoom,
    setArchived,
    createInvite,
    revokeInvite,
    inviteStatus,
    currentUser,
  } = useChat();

  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState(activeRoom.name ?? "");
  const [topic, setTopic] = useState(activeRoom.topic ?? "");
  const [description, setDescription] = useState(activeRoom.description ?? "");
  const [pendingMembers, setPendingMembers] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<number | null>(7 * 86_400_000);
  const [maxUses, setMaxUses] = useState<number | null>(50);
  const [importingWallpaper, setImportingWallpaper] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const admin = isAdmin(activeRoom, currentUserId);
  const isGroup = activeRoom.type === "group";
  const { wallpaper, setWallpaper } = useChatWallpaper(currentUserId, activeRoom.id);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setName(activeRoom.name ?? "");
    setTopic(activeRoom.topic ?? "");
    setDescription(activeRoom.description ?? "");
    setPendingMembers([]);
  }, [open, initialTab, activeRoom]);

  const invitable = useMemo(
    () => users.filter((user) => !activeRoom.participantIds.includes(user.id)),
    [users, activeRoom.participantIds],
  );

  const invite = activeRoom.invite;
  const status = inviteStatus(invite);
  const inviteUrl =
    invite && typeof window !== "undefined"
      ? `${window.location.origin}/join/${invite.code}`
      : invite
        ? `/join/${invite.code}`
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle>{roomTitle(activeRoom)} · settings</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="about">About</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="invite" disabled={!isGroup}>
              Invite
            </TabsTrigger>
            <TabsTrigger value="appearance">Wallpaper</TabsTrigger>
          </TabsList>

          {/* ------------------------------ About ------------------------------ */}
          <TabsContent value="about" className="space-y-3 pt-3">
            {isGroup && (
              <>
                <Field label="Name">
                  <Input
                    value={name}
                    disabled={!admin}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() =>
                      name.trim() && name !== activeRoom.name && renameRoom(activeRoom.id, name)
                    }
                    className="h-9 bg-surface text-sm"
                  />
                </Field>
                <Field label="Topic" hint="Shown next to the conversation name">
                  <Input
                    value={topic}
                    disabled={!admin}
                    onChange={(event) => setTopic(event.target.value)}
                    onBlur={() =>
                      topic !== (activeRoom.topic ?? "") && setRoomTopic(activeRoom.id, topic)
                    }
                    className="h-9 bg-surface text-sm"
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    value={description}
                    disabled={!admin}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() =>
                      description !== (activeRoom.description ?? "") &&
                      setRoomDescription(activeRoom.id, description)
                    }
                    rows={3}
                    className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-sm outline-none disabled:opacity-60"
                  />
                </Field>
              </>
            )}

            <p suppressHydrationWarning className="text-[11px] text-muted-foreground">
              Created {formatDateTime(activeRoom.createdAt, { timeZone: currentUser.timeZone })}
              {activeRoom.createdBy ? ` by ${userById(activeRoom.createdBy).name}` : ""}
            </p>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                variant="secondary"
                onClick={() => setArchived(activeRoom.id, !activeRoom.archived)}
                className="gap-2"
              >
                {activeRoom.archived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4" /> Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" /> Archive conversation
                  </>
                )}
              </Button>
              {isGroup && (
                <Button
                  variant="secondary"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    leaveRoom(activeRoom.id);
                    onOpenChange(false);
                  }}
                >
                  <LogOut className="h-4 w-4" /> Leave
                </Button>
              )}
            </div>
          </TabsContent>

          {/* --------------------------- Appearance --------------------------- */}
          <TabsContent value="appearance" className="space-y-4 pt-3">
            <div
              className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border bg-background bg-cover bg-center"
              style={
                wallpaper ? { backgroundImage: `url(${JSON.stringify(wallpaper)})` } : undefined
              }
            >
              {!wallpaper && (
                <div className="text-center text-muted-foreground">
                  <ImagePlus className="mx-auto h-8 w-8" />
                  <p className="mt-2 text-xs">Default conversation background</p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              This wallpaper is private to <b className="text-foreground">{currentUser.name}</b> in
              this conversation. It will not change what any other member sees.
            </div>

            <input
              ref={wallpaperInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!file.type.startsWith("image/")) {
                  toast.error("Choose an image file for the wallpaper.");
                  return;
                }
                setImportingWallpaper(true);
                void prepareWallpaper(file)
                  .then((value) => {
                    if (setWallpaper(value)) toast.success("Chat wallpaper updated");
                    else toast.error("The wallpaper could not be saved on this device.");
                  })
                  .catch(() => toast.error("That image could not be used as a wallpaper."))
                  .finally(() => setImportingWallpaper(false));
              }}
            />

            <div className="flex gap-2">
              <Button
                className="flex-1 gap-2"
                disabled={importingWallpaper}
                onClick={() => wallpaperInputRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                {importingWallpaper
                  ? "Preparing image..."
                  : wallpaper
                    ? "Change photo"
                    : "Import photo"}
              </Button>
              {wallpaper && (
                <Button
                  variant="secondary"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    setWallpaper(null);
                    toast.success("Default background restored");
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </TabsContent>

          {/* ----------------------------- Members ----------------------------- */}
          <TabsContent value="members" className="space-y-3 pt-3">
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {activeRoom.participantIds.map((id) => {
                const user = userById(id);
                const memberIsAdmin = activeRoom.adminIds.includes(id);
                return (
                  <div
                    key={id}
                    className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-secondary"
                  >
                    <UserAvatar user={user} size={30} showStatus />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {user.name}
                        {memberIsAdmin && (
                          <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
                            Admin
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {user.role}
                      </span>
                    </span>
                    {admin && isGroup && id !== currentUserId && (
                      <>
                        <button
                          onClick={() => toggleAdmin(activeRoom.id, id)}
                          aria-label={memberIsAdmin ? "Remove admin" : "Make admin"}
                          title={memberIsAdmin ? "Remove admin" : "Make admin"}
                          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          {memberIsAdmin ? (
                            <ShieldOff className="h-3.5 w-3.5" />
                          ) : (
                            <Shield className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => removeMember(activeRoom.id, id)}
                          aria-label={`Remove ${user.name}`}
                          title="Remove from conversation"
                          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {isGroup && admin && invitable.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Add people
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {invitable.map((user) => {
                    const picked = pendingMembers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        aria-pressed={picked}
                        onClick={() =>
                          setPendingMembers((current) =>
                            current.includes(user.id)
                              ? current.filter((id) => id !== user.id)
                              : [...current, user.id],
                          )
                        }
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors",
                          picked
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-secondary",
                        )}
                      >
                        <UserAvatar user={user} size={28} />
                        <span className="flex-1 truncate text-sm">{user.name}</span>
                        {picked && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="mt-2 w-full gap-2"
                  disabled={pendingMembers.length === 0}
                  onClick={() => {
                    addMembers(activeRoom.id, pendingMembers);
                    setPendingMembers([]);
                  }}
                >
                  <UserPlus className="h-4 w-4" /> Add {pendingMembers.length || ""}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ------------------------------ Invite ----------------------------- */}
          <TabsContent value="invite" className="space-y-3 pt-3">
            {invite && inviteUrl ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span suppressHydrationWarning className="truncate text-muted-foreground">
                    {inviteUrl}
                  </span>
                </div>

                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-[11px]",
                    status === "active"
                      ? "bg-online/10 text-online"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {status === "active" && (
                    <span suppressHydrationWarning>
                      Active ·{" "}
                      {invite.expiresAt
                        ? `expires ${formatUntil(invite.expiresAt)}`
                        : "never expires"}{" "}
                      ·{" "}
                      {invite.maxUses ? `${invite.uses}/${invite.maxUses} uses` : "unlimited uses"}
                    </span>
                  )}
                  {status === "expired" && "This link has expired and no longer works."}
                  {status === "exhausted" && "This link has reached its usage limit."}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1 gap-2"
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteUrl);
                      toast.success("Invite link copied");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy link
                  </Button>
                  {admin && (
                    <Button
                      variant="secondary"
                      onClick={() => revokeInvite(activeRoom.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted-foreground">
                No invite link is active for this conversation.
              </p>
            )}

            {admin && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Generate a new link
                </p>
                <ChoiceRow
                  label="Expires after"
                  options={EXPIRY_OPTIONS}
                  value={expiry}
                  onChange={setExpiry}
                />
                <ChoiceRow
                  label="Usage limit"
                  options={USES_OPTIONS}
                  value={maxUses}
                  onChange={setMaxUses}
                />
                <Button
                  className="w-full gap-2"
                  onClick={() => createInvite(activeRoom.id, { expiresInMs: expiry, maxUses })}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Generate link
                </Button>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Generating a new link immediately invalidates the previous one.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {hint && <span className="ml-1.5 text-[10px] text-muted-foreground/70">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function ChoiceRow<T extends number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.label}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
              option.value === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface hover:bg-secondary",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
