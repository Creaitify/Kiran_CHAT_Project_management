/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Search, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { UserAvatar } from "./UserAvatar";
import { useChat } from "../store/chat-store";
import { cn } from "../lib/cn";
import type { UserId } from "../lib/chat-types";

export function CreateGroupDialog({
  open,
  onOpenChange,
  preselected = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preselected?: UserId[];
}) {
  const { users, currentUserId, createGroup } = useChat();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<UserId[]>(preselected);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelected(preselected.filter((id) => id !== currentUserId));
      setQuery("");
      setName("");
      setDescription("");
      setCreating(false);
    }
  }, [open, preselected, currentUserId]);

  const candidates = useMemo(
    () =>
      users.filter(
        (u) => u.id !== currentUserId && u.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [users, currentUserId, query],
  );

  const toggle = (id: UserId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-w-lg gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </span>
            {step === 1 ? "Create New Group" : "Group Information"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="px-6 pb-6 pt-4">
            {selected.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {selected.map((id) => {
                  const u = users.find((x) => x.id === id);
                  if (!u) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className="flex animate-msg-in items-center gap-2 rounded-full border border-border bg-secondary py-1 pl-1 pr-3 text-xs transition-colors hover:bg-accent"
                    >
                      <UserAvatar user={u} size={22} />
                      {u.name.split(" ")[0]}
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search participants..."
                className="border-border bg-surface-2 pl-9 shadow-none"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {candidates.map((u) => {
                const isSel = selected.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      isSel
                        ? "border-primary/20 bg-primary/10"
                        : "border-transparent hover:bg-secondary",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-md border transition-colors",
                        isSel ? "border-primary bg-primary" : "border-input bg-surface",
                      )}
                    >
                      {isSel && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                    </span>
                    <UserAvatar user={u} size={36} showStatus />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{u.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {u.online ? "Online" : "Offline"} • {u.role}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              className="mt-5 w-full rounded-lg"
              disabled={selected.length === 0}
              onClick={() => setStep(2)}
            >
              Next • {selected.length} selected
            </Button>
          </div>
        ) : (
          <div className="space-y-4 px-6 pb-6 pt-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Group Name
              </label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sales Strategy Discussion"
                className="border-border bg-surface-2 shadow-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Description (optional)
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Internal discussion for the sales team"
                className="min-h-20 rounded-lg border-border bg-surface-2 shadow-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex -space-x-2">
                {selected.slice(0, 5).map((id) => {
                  const u = users.find((x) => x.id === id);
                  return u ? <UserAvatar key={id} user={u} size={28} /> : null;
                })}
              </div>
              <span className="text-xs text-muted-foreground">
                {selected.length + 1} members including you (Admin)
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="rounded-lg" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                className="flex-1 rounded-lg"
                disabled={!name.trim() || creating}
                onClick={() => {
                  void (async () => {
                    setCreating(true);
                    const roomId = await createGroup({
                      name: name.trim(),
                      description,
                      participantIds: selected,
                    });
                    setCreating(false);
                    if (roomId) onOpenChange(false);
                  })();
                }}
              >
                {creating ? "Creating…" : "Create Group"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
