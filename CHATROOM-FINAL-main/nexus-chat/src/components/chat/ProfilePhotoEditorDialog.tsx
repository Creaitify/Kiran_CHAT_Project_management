import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/lib/chat-types";
import { initials } from "@/lib/chat-types";
import { prepareProfilePhoto, useUserProfilePhoto, type ProfilePhoto } from "@/lib/profile-photo";
import { useChat } from "@/lib/chat-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

export function ProfilePhotoEditorDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { currentUserId } = useChat();
  const { photo, setOwnPhoto } = useUserProfilePhoto(user.id);
  const [draft, setDraft] = useState<ProfilePhoto | null>(photo);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = currentUserId === user.id;

  useEffect(() => {
    if (open) setDraft(photo);
  }, [open, photo]);

  const update = (patch: Partial<ProfilePhoto>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Edit profile photo</DialogTitle>
          <DialogDescription>
            Upload, zoom, and reposition your photo inside the circular frame.
          </DialogDescription>
        </DialogHeader>

        {!canEdit ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            You can only edit your own profile photo.
          </p>
        ) : (
          <>
            <div className="mx-auto flex h-56 w-56 items-center justify-center overflow-hidden rounded-full border-4 border-primary/40 bg-primary text-5xl font-semibold text-primary-foreground shadow-lg">
              {draft ? (
                <img
                  src={draft.dataUrl}
                  alt="Profile crop preview"
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${draft.x}% ${draft.y}%`,
                    transform: `scale(${draft.zoom})`,
                  }}
                />
              ) : (
                initials(user.name)
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!file.type.startsWith("image/")) {
                  toast.error("Choose an image file.");
                  return;
                }
                setLoading(true);
                void prepareProfilePhoto(file)
                  .then((dataUrl) => setDraft({ dataUrl, zoom: 1, x: 50, y: 50 }))
                  .catch(() => toast.error("That image could not be opened."))
                  .finally(() => setLoading(false));
              }}
            />

            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="w-full gap-2"
            >
              <ImagePlus className="h-4 w-4" />{" "}
              {loading ? "Preparing photo..." : draft ? "Choose another photo" : "Upload photo"}
            </Button>

            {draft && (
              <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
                <Control
                  label="Zoom"
                  value={draft.zoom}
                  min={1}
                  max={3}
                  step={0.05}
                  onChange={(zoom) => update({ zoom })}
                />
                <Control
                  label="Horizontal position"
                  value={draft.x}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(x) => update({ x })}
                />
                <Control
                  label="Vertical position"
                  value={draft.y}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(y) => update({ y })}
                />
              </div>
            )}

            <div className="flex justify-between gap-2">
              {photo ? (
                <Button
                  variant="secondary"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (setOwnPhoto(currentUserId, null)) {
                      setDraft(null);
                      toast.success("Profile photo removed");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!draft || loading}
                  className="gap-2"
                  onClick={() => {
                    if (!draft) return;
                    if (setOwnPhoto(currentUserId, draft)) {
                      toast.success("Profile photo updated");
                      onOpenChange(false);
                    } else toast.error("You cannot edit this profile.");
                  }}
                >
                  <Camera className="h-4 w-4" /> Save photo
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Control({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {label === "Zoom" ? `${value.toFixed(2)}x` : `${Math.round(value)}%`}
        </span>
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
    </label>
  );
}
