import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatUntil } from "@/lib/time";
import { cn } from "@/lib/utils";

const HOUR = 3_600_000;

export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sendAt: number) => void;
  timeZone: string;
}

/** Converts a `datetime-local` value to epoch ms, or null when unparseable. */
function parseLocalInput(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleDialog({ open, onOpenChange, onConfirm, timeZone }: ScheduleDialogProps) {
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const presets = useMemo(() => {
    const now = Date.now();
    const tomorrowMorning = new Date(now + 24 * HOUR);
    tomorrowMorning.setHours(9, 0, 0, 0);
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
    nextMonday.setHours(9, 0, 0, 0);
    return [
      { label: "In 1 hour", value: now + HOUR },
      { label: "In 3 hours", value: now + 3 * HOUR },
      { label: "Tomorrow, 9:00 AM", value: tomorrowMorning.getTime() },
      { label: "Monday, 9:00 AM", value: nextMonday.getTime() },
    ];
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(presets[0]?.value ?? null);
      setCustom(toLocalInput(Date.now() + HOUR));
    }
  }, [open, presets]);

  const customValue = parseLocalInput(custom);
  const effective = selected ?? customValue;
  const isPast = effective !== null && effective <= Date.now();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Schedule message
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setSelected(preset.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  selected === preset.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface hover:bg-secondary",
                )}
              >
                <span className="block font-medium">{preset.label}</span>
                <span suppressHydrationWarning className="block text-[10px] text-muted-foreground">
                  {formatDateTime(preset.value, { timeZone })}
                </span>
              </button>
            ))}
          </div>

          <div>
            <label
              htmlFor="schedule-custom"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Or pick a time
            </label>
            <Input
              id="schedule-custom"
              type="datetime-local"
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                setSelected(null);
              }}
              className="mt-1 h-9 bg-surface text-sm"
            />
          </div>

          {effective !== null && (
            <p
              suppressHydrationWarning
              className={cn("text-[11px]", isPast ? "text-destructive" : "text-muted-foreground")}
            >
              {isPast
                ? "Pick a time in the future."
                : `Will send ${formatUntil(effective)} · ${formatDateTime(effective, { timeZone })}`}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={effective === null || isPast}
            onClick={() => effective !== null && onConfirm(effective)}
          >
            Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
