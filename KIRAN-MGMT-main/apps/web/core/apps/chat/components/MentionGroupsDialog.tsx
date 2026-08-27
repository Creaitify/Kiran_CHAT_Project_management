/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Managing mention groups -- `@engineering`, `@on-call`.
 *
 * Two panes rather than a list of dialogs: the list, and the editor for one
 * group. Creating and editing are the same form because they are the same
 * decision, and a group is small enough that its whole membership fits on one
 * screen.
 *
 * Server-side errors are rendered against the field they belong to rather than
 * as a toast. The handle is the field that can actually be rejected -- reserved
 * words, characters the mention tokeniser cannot read back, a handle already
 * taken in this workspace -- and "that name is taken" is useless three inches
 * away from the input it is about.
 */

import { useEffect, useMemo, useState } from "react";
import { AtSign, Check, ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { UserAvatar } from "./UserAvatar";
import { useChat } from "../store/chat-store";
import { cn } from "../lib/cn";
import type { UserGroup, UserId } from "../lib/chat-types";

/** Field errors as DRF returns them: `{field: ["message", ...]}`. */
type FieldErrors = Record<string, string[]>;

function firstError(errors: FieldErrors, field: string): string | null {
  const messages = errors[field];
  return Array.isArray(messages) && messages.length ? (messages[0] ?? null) : null;
}

/**
 * Suggests a handle from a name the way the server will accept one: lower case,
 * spaces to hyphens, everything the tokeniser cannot read dropped.
 *
 * Only ever a suggestion. It stops as soon as the handle has been touched, so
 * renaming a group never silently moves the handle that people have already
 * typed into messages.
 */
function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

export function MentionGroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const {
    users,
    userGroups,
    canManageUserGroups,
    createUserGroup,
    updateUserGroup,
    deleteUserGroup,
  } = useChat();

  /** null = the list. A group = editing it. "new" = creating one. */
  const [editing, setEditing] = useState<UserGroup | "new" | null>(null);
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<UserId[]>([]);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setQuery("");
    setErrors({});
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (editing === null) return;
    const group = editing === "new" ? null : editing;
    setHandle(group?.handle ?? "");
    setName(group?.name ?? "");
    setSelected(group?.memberIds ?? []);
    // An existing handle is already typed into people's messages, so it counts
    // as touched: nothing may rewrite it but the person editing it.
    setHandleTouched(group !== null);
    setErrors({});
    setQuery("");
  }, [editing]);

  const candidates = useMemo(
    () => users.filter((user) => user.name.toLowerCase().includes(query.toLowerCase())),
    [users, query],
  );

  const effectiveHandle = handleTouched ? handle : suggestHandle(name);

  const toggle = (id: UserId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const save = () => {
    void (async () => {
      setSaving(true);
      setErrors({});
      const payload = {
        handle: effectiveHandle.trim(),
        name: name.trim(),
        member_ids: selected,
      };
      try {
        if (editing === "new") await createUserGroup(payload);
        else if (editing) await updateUserGroup(editing.id, payload);
        setEditing(null);
      } catch (error) {
        // The store re-throws whatever the API returned so this can land it on
        // the right field. Anything unrecognised becomes a form-level message
        // rather than disappearing.
        const body = error as FieldErrors | { error?: string } | undefined;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const detail = (body as { error?: string }).error;
          setErrors(detail ? { __form: [detail] } : (body as FieldErrors));
        } else {
          setErrors({ __form: ["Could not save the group."] });
        }
      } finally {
        setSaving(false);
      }
    })();
  };

  const remove = (group: UserGroup) => {
    void (async () => {
      try {
        await deleteUserGroup(group.id);
      } catch {
        setErrors({ __form: [`Could not delete @${group.handle}.`] });
      }
    })();
  };

  const editorValid = effectiveHandle.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-w-lg gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            {editing !== null && (
              <button
                onClick={() => setEditing(null)}
                aria-label="Back to all groups"
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-secondary"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {editing === null && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <AtSign className="h-4 w-4" />
              </span>
            )}
            {editing === null
              ? "Mention Groups"
              : editing === "new"
                ? "New Mention Group"
                : `Edit @${editing.handle}`}
          </DialogTitle>
        </DialogHeader>

        {firstError(errors, "__form") && (
          <p className="border-b border-destructive/20 bg-destructive/10 px-6 py-3 text-xs text-destructive">
            {firstError(errors, "__form")}
          </p>
        )}

        {editing === null ? (
          <div className="px-6 pb-6 pt-4">
            <p className="mb-4 text-xs text-muted-foreground">
              A mention group lets one handle stand for a set of people. Typing{" "}
              <span className="font-medium text-foreground">@engineering</span> in any conversation
              notifies everyone in the group who is also in that conversation.
            </p>

            {userGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No mention groups yet.
              </p>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {userGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-secondary"
                  >
                    <button
                      onClick={() => canManageUserGroups && setEditing(group)}
                      disabled={!canManageUserGroups}
                      className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
                        <AtSign className="h-4 w-4" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">@{group.handle}</span>
                        <span className="block text-xs text-muted-foreground">
                          {group.name} • {group.memberIds.length}{" "}
                          {group.memberIds.length === 1 ? "person" : "people"}
                        </span>
                      </span>
                    </button>
                    {canManageUserGroups && (
                      <button
                        onClick={() => remove(group)}
                        aria-label={`Delete @${group.handle}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canManageUserGroups ? (
              <Button className="mt-5 w-full rounded-lg" onClick={() => setEditing("new")}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New group
              </Button>
            ) : (
              <p className="mt-5 text-center text-xs text-muted-foreground">
                Only workspace admins can change mention groups.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 px-6 pb-6 pt-5">
            <div>
              <label
                htmlFor="mention-group-name"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="mention-group-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Engineering"
                className="border-border bg-surface-2 shadow-none"
              />
              {firstError(errors, "name") && (
                <p className="mt-1.5 text-xs text-destructive">{firstError(errors, "name")}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="mention-group-handle"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Handle
              </label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="mention-group-handle"
                  value={effectiveHandle}
                  onChange={(event) => {
                    setHandleTouched(true);
                    setHandle(event.target.value);
                  }}
                  placeholder="engineering"
                  className="border-border bg-surface-2 pl-8 shadow-none"
                />
              </div>
              {firstError(errors, "handle") ? (
                <p className="mt-1.5 text-xs text-destructive">{firstError(errors, "handle")}</p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Letters, numbers, hyphens and underscores. This is what people type.
                </p>
              )}
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selected.map((id) => {
                  const user = users.find((candidate) => candidate.id === id);
                  if (!user) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className="flex items-center gap-2 rounded-full border border-border bg-secondary py-1 pl-1 pr-3 text-xs transition-colors hover:bg-accent"
                    >
                      <UserAvatar user={user} size={22} />
                      {user.name.split(" ")[0]}
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}

            <div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people..."
                  className="border-border bg-surface-2 pl-9 shadow-none"
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {candidates.map((user) => {
                  const isSelected = selected.includes(user.id);
                  return (
                    <button
                      key={user.id}
                      onClick={() => toggle(user.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "border-primary/20 bg-primary/10"
                          : "border-transparent hover:bg-secondary",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-md border transition-colors",
                          isSelected ? "border-primary bg-primary" : "border-input bg-surface",
                        )}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                      </span>
                      <UserAvatar user={user} size={32} />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{user.name}</span>
                        <span className="block text-xs text-muted-foreground">{user.role}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" className="rounded-lg" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 rounded-lg"
                disabled={!editorValid || saving}
                onClick={save}
              >
                {saving ? "Saving…" : editing === "new" ? "Create group" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
