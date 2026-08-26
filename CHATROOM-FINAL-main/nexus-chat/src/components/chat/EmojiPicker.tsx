/**
 * Emoji picker.
 *
 * `emoji-picker-react` touches `window` on import, so it is code-split behind
 * `React.lazy` and only mounted once the popover opens — that keeps it out of
 * the SSR pass and off the initial bundle.
 */

import { lazy, Suspense, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

const Picker = lazy(() => import("emoji-picker-react"));

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: "start" | "end";
}

export function EmojiPicker({ onSelect, onClose, align = "end" }: EmojiPickerProps) {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full z-50 mb-2 ${align === "end" ? "right-0" : "left-0"}`}
    >
      <Suspense
        fallback={
          <div className="h-80 w-72 animate-pulse rounded-xl border border-border bg-surface shadow-[var(--shadow-float)]" />
        }
      >
        <Picker
          onEmojiClick={(emoji) => {
            onSelect(emoji.emoji);
            onClose();
          }}
          theme={(resolved === "dark" ? "dark" : "light") as never}
          searchPlaceholder="Search emoji"
          skinTonesDisabled={false}
          lazyLoadEmojis
          width={320}
          height={380}
          previewConfig={{ showPreview: false }}
        />
      </Suspense>
    </div>
  );
}
