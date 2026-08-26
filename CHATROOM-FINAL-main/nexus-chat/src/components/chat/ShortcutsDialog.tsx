import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: "Navigation",
    items: [
      ["Ctrl / ⌘ + K", "Open the command palette"],
      ["Ctrl / ⌘ + F", "Search in this conversation"],
      ["Alt + ↑ / ↓", "Previous / next conversation"],
      ["Esc", "Close the open panel or dialog"],
    ],
  },
  {
    group: "Composing",
    items: [
      ["Enter", "Send"],
      ["Shift + Enter", "New line"],
      ["@", "Mention someone, a group, @channel or @here"],
      ["/", "Run a slash command"],
      ["Esc", "Cancel a reply or an edit"],
    ],
  },
  {
    group: "Messages",
    items: [
      ["Tab / Shift + Tab", "Move between messages"],
      ["Ctrl / ⌘ + Shift + S", "Saved items"],
      ["Ctrl / ⌘ + Shift + P", "Pinned messages"],
      ["Ctrl / ⌘ + Shift + D", "Toggle light / dark theme"],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {SHORTCUTS.map((section) => (
            <section key={section.group}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.group}
              </h3>
              <dl className="space-y-1">
                {section.items.map(([keys, description]) => (
                  <div key={keys} className="flex items-center justify-between gap-4 text-xs">
                    <dt className="text-muted-foreground">{description}</dt>
                    <dd>
                      <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
