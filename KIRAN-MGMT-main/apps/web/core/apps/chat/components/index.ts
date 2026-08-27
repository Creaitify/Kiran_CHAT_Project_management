/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * One import site for the chat screens.
 *
 * `shell.tsx`, `workspace.tsx` and `join.tsx` reach for a dozen components
 * each; this barrel keeps that to a single line and gives the port one place
 * where the component surface is written down.
 *
 * Components themselves still import their siblings by path. A barrel used
 * from inside the directory would make every component depend on every other
 * one, which is a real cycle (MessageItem -> UserProfileDialog ->
 * SharedContentDialog -> MediaAttachment) rather than a stylistic preference.
 *
 * Type re-exports use `export type` because apps/web compiles with
 * `verbatimModuleSyntax` and `isolatedModules`, where a bare re-export of a
 * type is an error rather than a hint.
 */

export { MentionGroupsDialog } from "./MentionGroupsDialog";

export { CommandPalette } from "./CommandPalette";
export type { CommandPaletteProps } from "./CommandPalette";

export { Composer } from "./Composer";
export type { ComposerProps } from "./Composer";

export { ContextPanel } from "./ContextPanel";
export { ConversationSidebar } from "./ConversationSidebar";
export { CreateGroupDialog } from "./CreateGroupDialog";

export { EmojiPicker } from "./EmojiPicker";
export type { EmojiPickerProps } from "./EmojiPicker";

export { ForwardDialog } from "./ForwardDialog";
export type { ForwardDialogProps } from "./ForwardDialog";

export { GroupPhotoEditorDialog } from "./GroupPhotoEditorDialog";
export { GroupProfileDialog } from "./GroupProfileDialog";

export { MarkdownContent } from "./MarkdownContent";
export type { MarkdownContentProps } from "./MarkdownContent";

export { MediaAttachment } from "./MediaAttachment";

export { MessageItem } from "./MessageItem";
export type { MessageItemProps } from "./MessageItem";

export { MessageThread } from "./MessageThread";
export { PinnedMessageBanner } from "./PinnedMessageBanner";
export { ProfilePhotoEditorDialog } from "./ProfilePhotoEditorDialog";

export { RoomSettingsDialog } from "./RoomSettingsDialog";
export type { RoomSettingsDialogProps } from "./RoomSettingsDialog";

export { SavedPinnedDialog } from "./SavedPinnedDialog";
export type { SavedPinnedMode } from "./SavedPinnedDialog";

export { ScheduleDialog } from "./ScheduleDialog";
export type { ScheduleDialogProps } from "./ScheduleDialog";

export { ShareProfileDialog } from "./ShareProfileDialog";
export { SharedContentDialog } from "./SharedContentDialog";
export { ShortcutsDialog } from "./ShortcutsDialog";

export { ThreadPanel } from "./ThreadPanel";
export type { ThreadPanelProps } from "./ThreadPanel";

export { GroupAvatar, UserAvatar } from "./UserAvatar";
export { UserProfileDialog } from "./UserProfileDialog";
