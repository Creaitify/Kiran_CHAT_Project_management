import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/lib/chat-store";
import type { Room } from "@/lib/chat-types";
import { initials } from "@/lib/chat-types";
import { prepareProfilePhoto } from "@/lib/profile-photo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

export function GroupPhotoEditorDialog({
  room,
  name,
  open,
  onOpenChange,
}: {
  room: Room;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { currentUserId, updateGroupPhoto } = useChat();
  const [draft, setDraft] = useState<Room["photo"] | null>(room.photo ?? null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canEdit = room.type !== "direct" && room.participantIds.includes(currentUserId);

  useEffect(() => {
    if (open) setDraft(room.photo ?? null);
  }, [open, room.photo]);

  const update = (patch: Partial<NonNullable<Room["photo"]>>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Change group photo</DialogTitle>
          <DialogDescription>
            Any member can update the photo for {name}. Everyone in the group will be notified.
          </DialogDescription>
        </DialogHeader>

        {!canEdit ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            Only current group members can change this photo.
          </p>
        ) : (
          <>
            <div className="mx-auto flex h-56 w-56 items-center justify-center overflow-hidden rounded-3xl border-4 border-primary/40 bg-primary text-5xl font-semibold text-primary-foreground shadow-lg">
              {draft ? (
                <img
                  src={draft.dataUrl}
                  alt="Group crop preview"
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${draft.x}% ${draft.y}%`,
                    transform: `scale(${draft.zoom})`,
                  }}
                />
              ) : (
                initials(name)
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
              <ImagePlus className="h-4 w-4" />
              {loading ? "Preparing photo..." : draft ? "Choose another photo" : "Add photo"}
            </Button>

            {draft && (
              <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
                <PhotoControl
                  label="Zoom"
                  value={draft.zoom}
                  min={1}
                  max={3}
                  step={0.05}
                  onChange={(zoom) => update({ zoom })}
                />
                <PhotoControl
                  label="Horizontal position"
                  value={draft.x}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(x) => update({ x })}
                />
                <PhotoControl
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
              {room.photo ? (
                <Button
                  variant="secondary"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (updateGroupPhoto(room.id, null)) {
                      setDraft(null);
                      onOpenChange(false);
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
                    if (draft && updateGroupPhoto(room.id, draft)) onOpenChange(false);
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

function PhotoControl({
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
