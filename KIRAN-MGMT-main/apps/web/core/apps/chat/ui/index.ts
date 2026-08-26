/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/*
 * shadcn primitives, kept alongside @plane/propel rather than instead of it.
 * Propel covers the same ground, but the ~5000 lines of chat components were
 * written against shadcn's API and class vocabulary, so moving them onto propel
 * would be a rewrite wearing a port's clothes. These ten exist only for this
 * app: they are not exported past `core/apps/chat/`, and `tokens.css` confines
 * their styling to `.kiran-chat-app`. Anything new in apps/web uses propel.
 */

export { Button, buttonVariants, type ButtonProps } from "./button";
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "./command";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./dialog";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./dropdown-menu";
export { Input } from "./input";
export { Slider } from "./slider";
export { Toaster } from "./sonner";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { Textarea } from "./textarea";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";
