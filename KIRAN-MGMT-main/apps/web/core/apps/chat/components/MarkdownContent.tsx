/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Message body renderer.
 *
 * Security note: `react-markdown` compiles to React elements and does **not**
 * pass raw HTML through unless `rehype-raw` is added — which it deliberately is
 * not here. That means there is no `dangerouslySetInnerHTML` sink anywhere in
 * this path, so a message containing `<img onerror=…>` renders as literal text
 * rather than needing to be sanitized after the fact. The remaining injection
 * surface is the anchor `href`, which is validated against an http(s) allowlist
 * below, and image sources, which are disabled entirely.
 */

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { isSafeHref } from "../lib/link-preview";
import { isBroadcast, SPECIAL_TOKEN, USER_TOKEN } from "../lib/mentions";
import type { User, UserGroup, UserId } from "../lib/chat-types";
import { cn } from "../lib/cn";
// apps
import { entityLabel, parseEntityRef } from "../../links";
import { useAppContext } from "../../use-app-context";

/* -------------------------------------------------------------------------- */
/* remark plugin: turn stored mention tokens into styled spans                 */
/* -------------------------------------------------------------------------- */

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const COMBINED = new RegExp(`${USER_TOKEN.source}|${SPECIAL_TOKEN.source}`, "g");

function mentionPlugin(resolve: (raw: string) => { label: string; self: boolean } | null) {
  return () => (tree: MdastNode) => {
    const visit = (node: MdastNode) => {
      if (!node.children) return;
      const next: MdastNode[] = [];
      for (const child of node.children) {
        // Only plain text is rewritten: `code` and `inlineCode` carry their
        // content on `value` with a different node type, so a mention inside a
        // code block is left exactly as the author typed it.
        if (child.type !== "text" || !child.value) {
          visit(child);
          next.push(child);
          continue;
        }
        const text = child.value;
        let lastIndex = 0;
        let matched = false;
        COMBINED.lastIndex = 0;
        for (const match of text.matchAll(COMBINED)) {
          const resolved = resolve(match[0]);
          if (!resolved) continue;
          matched = true;
          const start = match.index ?? 0;
          if (start > lastIndex) next.push({ type: "text", value: text.slice(lastIndex, start) });
          next.push({
            type: "mention",
            data: {
              hName: "span",
              hProperties: {
                className: ["nx-mention", resolved.self ? "nx-mention-self" : ""].filter(Boolean),
              },
            },
            children: [{ type: "text", value: resolved.label }],
          });
          lastIndex = start + match[0].length;
        }
        if (!matched) {
          next.push(child);
          continue;
        }
        if (lastIndex < text.length) next.push({ type: "text", value: text.slice(lastIndex) });
      }
      node.children = next;
    };
    visit(tree);
  };
}

/* -------------------------------------------------------------------------- */

export interface MarkdownContentProps {
  content: string;
  users: User[];
  groups: UserGroup[];
  currentUserId: UserId;
  /** Own-message bubbles use a coloured background and need inverted code styling. */
  onPrimary?: boolean;
  className?: string;
}

function MarkdownContentImpl({
  content,
  users,
  groups,
  currentUserId,
  onPrimary = false,
  className,
}: MarkdownContentProps) {
  // Only for resolving cross-app links: a work-item URL is only *this*
  // workspace's work item, and a link to another one must stay a plain link.
  const { workspaceSlug } = useAppContext();

  const plugins = useMemo(() => {
    const resolve = (raw: string) => {
      const user = /^<@/.test(raw) ? raw.slice(2, -1) : null;
      if (user) {
        const found = users.find((u) => u.id === user);
        if (!found) return { label: "@unknown", self: false };
        return { label: `@${found.name}`, self: found.id === currentUserId };
      }
      const handle = raw.slice(2, -1);
      // A broadcast is aimed at everyone, so it always renders as "for you".
      if (isBroadcast(handle)) return { label: `@${handle}`, self: true };
      const group = groups.find((g) => g.handle === handle);
      if (!group) return null;
      return { label: `@${group.handle}`, self: group.memberIds.includes(currentUserId) };
    };
    return [remarkGfm, mentionPlugin(resolve)];
  }, [users, groups, currentUserId]);

  return (
    <div className={cn("md-body", onPrimary && "md-on-primary", className)}>
      <ReactMarkdown
        remarkPlugins={plugins}
        // `as never` because apps/web resolves two copies of `unified`:
        // rehype-highlight is typed against one `Plugin`, react-markdown against
        // the other, and the two are structurally identical but nominally
        // distinct. No local type reconciles them -- only deduplicating the
        // dependency would, and that is a lockfile change, not a component
        // change. `detect` and `ignoreMissing` are both real options and the
        // plugin runs correctly.
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]] as never}
        // Images are not rendered: an <img> with a remote src is a silent
        // read receipt / IP leak for whoever posted the link.
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          a({ href, children, node, ...rest }) {
            void node;
            if (!href || !isSafeHref(href)) return <span {...rest}>{children}</span>;

            // A link to something inside KIRAN renders as a chip rather than a
            // URL. Chat has no idea what it is: it hands the href to the app
            // registry, and whichever app claims it supplies the label. Nothing
            // claims it -> ordinary link, which is also what happens on the
            // server, where there is no origin to compare against.
            const entity = parseEntityRef(href, workspaceSlug);
            const entityText = entityLabel(entity);
            if (entity && entityText) {
              return (
                <a
                  {...rest}
                  href={href}
                  // Styled inline the way mentions are, and reading `onPrimary`
                  // the same way: on the sender's own gradient bubble a tinted
                  // chip disappears, so it goes translucent-white instead.
                  className={cn(
                    "rounded px-1 py-px font-medium no-underline",
                    onPrimary ? "bg-white/20 text-inherit" : "bg-primary/12 text-primary"
                  )}
                  // Same-origin, so it stays in the tab -- opening your own
                  // product in a new window is a small rudeness.
                  rel="noopener"
                >
                  {entityText}
                </a>
              );
            }

            return (
              <a
                {...rest}
                href={href}
                target="_blank"
                // noopener/noreferrer: without it the opened page gets a live
                // window.opener handle back into this origin.
                rel="noopener noreferrer nofollow ugc"
              >
                {children}
              </a>
            );
          },
          span({ className: spanClass, children, node, ...rest }) {
            void node;
            const classes = String(spanClass ?? "");
            if (!classes.includes("nx-mention")) {
              return (
                <span className={spanClass} {...rest}>
                  {children}
                </span>
              );
            }
            const self = classes.includes("nx-mention-self");
            return (
              <span
                {...rest}
                className={cn(
                  "rounded px-1 py-px font-medium",
                  self
                    ? "bg-amber-400/25 text-amber-900 dark:text-amber-200"
                    : onPrimary
                      ? "bg-white/20"
                      : "bg-primary/12 text-primary",
                )}
              >
                {children}
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentImpl);
