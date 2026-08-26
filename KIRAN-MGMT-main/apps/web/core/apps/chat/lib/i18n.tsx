/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Chat's 22 strings.
 *
 * KIRAN has a real i18n stack -- `@plane/i18n`, react-i18next, ICU plurals,
 * nineteen locales -- and the right long-term answer is for these keys to live
 * there under a `chat.` namespace. They do not yet, for one concrete reason:
 * `packages/i18n` has a `sync:check` that fails when locales disagree, so
 * adding 22 English keys means adding 22 keys to eighteen other languages or
 * breaking the check. That is a translation task, not a port task.
 *
 * So the catalogue stays here and the components keep calling `useI18n()`
 * unchanged. What DID change is where the language comes from: the provider no
 * longer keeps its own `localStorage["nexus-locale"]` and no longer writes
 * `document.documentElement.lang`. It reads the shell's current locale, so the
 * language control in KIRAN's own settings moves chat too and there is one
 * language switch in the product rather than two that disagree.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "@plane/i18n";

export const en = {
  "composer.placeholder": "Type a message, or @agent for private AI…",
  "composer.agentPlaceholder": "Ask anything — only you will see the reply…",
  "composer.hint":
    "Enter to send · Shift+Enter for a new line · Paste text, photos or videos · / for commands",
  "composer.agentHint": "✦ This reply is private to you.",
  "composer.editing": "Editing message",
  "composer.draftSaved": "Draft saved",
  "message.edited": "edited",
  "message.deleted": "This message was deleted",
  "message.failed": "Not delivered",
  "message.retry": "Retry",
  "message.reply": "Reply in thread",
  "message.pinned": "Pinned",
  "thread.title": "Thread",
  "thread.replies": "{count, plural, one {# reply} other {# replies}}",
  "thread.follow": "Follow thread",
  "thread.unfollow": "Following",
  "thread.empty": "No replies yet. Start the conversation.",
  "unread.divider": "{count, plural, one {# new message} other {# new messages}}",
  "room.archived": "This conversation is archived. Unarchive it to send messages.",
  "room.leave": "Leave conversation",
  "search.placeholder": "Search messages, people and channels",
  "palette.placeholder": "Type a command or search…",
  "saved.empty": "Nothing saved yet.",
  "pinned.empty": "No pinned messages in this conversation.",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;

/**
 * A second catalog kept intentionally partial, to prove the fallback path:
 * missing keys resolve to English rather than rendering the raw key.
 */
const hi: Partial<Catalog> = {
  "composer.placeholder": "संदेश लिखें, या निजी AI के लिए @agent…",
  "message.edited": "संपादित",
  "message.deleted": "यह संदेश हटा दिया गया",
  "thread.title": "थ्रेड",
  "search.placeholder": "संदेश, लोग और चैनल खोजें",
};

export const LOCALES = {
  en: { label: "English", catalog: en, dir: "ltr" as const },
  hi: { label: "हिन्दी", catalog: { ...en, ...hi }, dir: "ltr" as const },
} satisfies Record<string, { label: string; catalog: Catalog; dir: "ltr" | "rtl" }>;

export type LocaleCode = keyof typeof LOCALES;

type Values = Record<string, string | number>;

const PLURAL_OPEN = /\{(\w+),\s*plural,\s*/g;

/**
 * Finds the index of the `}` matching the `{` at `start`. A regex cannot do
 * this — plural bodies contain nested braces — so the block is scanned by hand.
 */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function selectPlural(body: string, count: number, locale: string): string {
  const category = new Intl.PluralRules(locale).select(count);
  const branches = new Map<string, string>();
  const pattern = /(=?\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const open = pattern.lastIndex - 1;
    const close = matchingBrace(body, open);
    if (close === -1) break;
    branches.set(match[1]!.replace(/^=/, ""), body.slice(open + 1, close));
    pattern.lastIndex = close + 1;
  }
  return branches.get(String(count)) ?? branches.get(category) ?? branches.get("other") ?? "";
}

/** Minimal ICU subset: `{name}` interpolation and `{n, plural, one {…} other {…}}`. */
export function formatMessage(template: string, values: Values = {}, locale = "en"): string {
  let out = "";
  let cursor = 0;
  PLURAL_OPEN.lastIndex = 0;

  let opener: RegExpExecArray | null;
  while ((opener = PLURAL_OPEN.exec(template)) !== null) {
    const blockStart = opener.index;
    const blockEnd = matchingBrace(template, blockStart);
    if (blockEnd === -1) break;

    const count = Number(values[opener[1]!] ?? 0);
    const body = template.slice(PLURAL_OPEN.lastIndex, blockEnd);
    out += template.slice(cursor, blockStart);
    out += selectPlural(body, count, locale).replace(
      /#/g,
      new Intl.NumberFormat(locale).format(count),
    );

    cursor = blockEnd + 1;
    PLURAL_OPEN.lastIndex = cursor;
  }
  out += template.slice(cursor);

  return out.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

interface I18nValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  dir: "ltr" | "rtl";
  t: (key: MessageKey, values?: Values) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // The shell owns language. `currentLocale` is an ISO code from @plane/i18n's
  // nineteen; chat has copy for two of them, so anything else falls back to
  // English rather than rendering blanks.
  const { currentLocale } = useTranslation();
  const locale: LocaleCode = currentLocale in LOCALES ? (currentLocale as LocaleCode) : "en";

  /**
   * Kept because `ChatContextValue` consumers call it, but chat is no longer
   * allowed to set the language on its own -- doing so would leave the shell
   * showing one language and chat another.
   */
  const setLocale = useCallback((_next: LocaleCode) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[chat] setLocale is a no-op — language is a workspace setting.");
    }
  }, []);

  const dir = LOCALES[locale].dir;

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      dir,
      t: (key, values) => formatMessage(LOCALES[locale].catalog[key] ?? en[key], values, locale),
    }),
    [locale, setLocale, dir],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Safe default so components stay renderable in isolation (and in tests).
  return {
    locale: "en",
    setLocale: () => {},
    dir: "ltr",
    t: (key, values) => formatMessage(en[key], values, "en"),
  };
}
