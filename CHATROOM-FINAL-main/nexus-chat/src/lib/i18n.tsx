/**
 * i18n scaffolding.
 *
 * Not a full localisation effort — the point is that the plumbing exists and is
 * correct: a locale context, typed message keys, ICU-style interpolation,
 * plural selection through `Intl.PluralRules`, and an RTL flag wired to the
 * document direction. Adding a language is then a matter of adding a catalog.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
const STORAGE_KEY = "nexus-locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOCALES) setLocaleState(saved as LocaleCode);
  }, []);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Locale preference is a convenience; ignore quota/private-mode errors.
    }
  }, []);

  const dir = LOCALES[locale].dir;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

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
