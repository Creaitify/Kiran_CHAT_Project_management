/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
// KCMS imports
import { AI_EDITOR_TASKS } from "@plane/constants";
import { cn } from "@plane/utils";
// services
import { AIService } from "@/services/ai.service";

const aiService = new AIService();

type TRole = "user" | "assistant";

type TMessage = {
  id: string;
  role: TRole;
  content: string;
};

type TAiAssistantPanelProps = {
  workspaceSlug: string;
};

const SUGGESTIONS = [
  "Draft a status update for this week's production run.",
  "Write a checklist for inspecting a galvanised cable tray batch.",
  "Summarise what a delayed dispatch means for the customer.",
];

/**
 * The endpoint behind this panel is stateless -- it answers one prompt at a time.
 * To make the assistant feel conversational we replay the transcript as the prompt,
 * capped so a long session cannot grow the request without bound.
 */
const TRANSCRIPT_TURN_LIMIT = 12;

const buildPrompt = (history: TMessage[], nextPrompt: string): string => {
  const recent = history.slice(-TRANSCRIPT_TURN_LIMIT);
  if (recent.length === 0) return nextPrompt;
  const transcript = recent.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return `${transcript}\n\nUser: ${nextPrompt}\n\nAssistant:`;
};

/** The API returns DRF-style error payloads; surface something a human can act on. */
const readableError = (error: unknown): string => {
  const detail =
    (error as { error?: string; detail?: string })?.error ?? (error as { detail?: string })?.detail ?? undefined;
  if (typeof detail === "string" && detail.length > 0) {
    if (detail.toLowerCase().includes("api key")) {
      return "AI isn't configured yet. Add a provider, model and API key in the admin console under Artificial Intelligence.";
    }
    return detail;
  }
  return "Couldn't reach the AI service. Check that the API is running and a provider key is configured.";
};

export function AiAssistantPanel(props: TAiAssistantPanelProps) {
  const { workspaceSlug } = props;
  // state
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // keep the newest message in view as the conversation grows
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Escape closes the panel from anywhere inside it
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const submitPrompt = useCallback(
    async (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (!prompt || isLoading || !workspaceSlug) return;

      setError(null);
      setInput("");

      // Snapshot the history *before* appending, so the prompt we send doesn't
      // include the question we're about to ask twice.
      const history = messages;
      const userMessage: TMessage = { id: `u-${Date.now()}`, role: "user", content: prompt };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const res = await aiService.performEditorTask(workspaceSlug, {
          task: AI_EDITOR_TASKS.ASK_ANYTHING,
          text_input: buildPrompt(history, prompt),
        });
        const answer = res?.response?.trim();
        if (!answer) throw new Error("empty response");
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: answer }]);
      } catch (err) {
        setError(readableError(err));
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, messages, workspaceSlug]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline -- the convention people expect in chat.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt(input);
    }
  };

  if (!workspaceSlug) return null;

  return (
    <>
      {/* Ink is text-on-color, never text-white: ink on a coloured fill flips per
          theme. Dark mode's accent fill is a LIGHT blue, so white on it measured
          2.54:1 against a 4.5 requirement. See DESIGN.md 3.1.1. */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open KCMS AI assistant"
          className="fixed right-5 bottom-5 z-[26] flex items-center gap-2 rounded-full bg-accent-primary px-4 py-3 text-13 font-medium text-on-color shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50"
        >
          <Sparkles className="size-4" />
          Ask AI
        </button>
      )}

      {isOpen && (
        <aside
          role="complementary"
          aria-label="KCMS AI assistant"
          className="fixed top-0 right-0 z-[28] flex h-full w-full max-w-[420px] flex-col border-l border-subtle bg-surface-1 shadow-2xl"
        >
          {/* header */}
          <header className="flex items-center justify-between border-b border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-accent-primary/15">
                <Sparkles className="size-4 text-accent-primary" />
              </span>
              <div className="leading-tight">
                <p className="text-13 font-semibold text-primary">KCMS Assistant</p>
                <p className="text-11 text-tertiary">Ask anything about your work</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                  }}
                  aria-label="Clear conversation"
                  className="rounded-md p-1.5 text-tertiary hover:bg-surface-2 hover:text-primary"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close AI assistant"
                className="rounded-md p-1.5 text-tertiary hover:bg-surface-2 hover:text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {/* transcript */}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col gap-3 pt-6">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-accent-primary/10">
                    <Bot className="size-5 text-accent-primary" />
                  </span>
                  <p className="text-13 font-medium text-primary">How can I help?</p>
                  <p className="max-w-[280px] text-12 text-tertiary">
                    Describe a task and I&apos;ll draft it for you — updates, checklists, summaries, or anything else.
                  </p>
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void submitPrompt(s)}
                      className="rounded-md border border-subtle px-3 py-2 text-left text-12 text-secondary transition-colors hover:border-accent-primary/40 hover:bg-surface-2"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex w-full", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-13 whitespace-pre-wrap",
                    message.role === "user"
                      ? "bg-accent-primary text-on-color"
                      : "border border-subtle bg-surface-2 text-primary"
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-12 text-tertiary">
                <Loader2 className="size-3.5 animate-spin" />
                Thinking…
              </div>
            )}

            {error && (
              <div className="rounded-md border border-danger-primary/30 bg-danger-primary/10 px-3 py-2 text-12 text-danger-primary">
                {error}
              </div>
            )}
          </div>

          {/* composer */}
          <div className="border-t border-subtle p-3">
            <div className="flex items-end gap-2 rounded-lg border border-subtle bg-surface-2 px-2 py-1.5 focus-within:border-accent-primary/50">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the assistant to do something…"
                aria-label="Message the AI assistant"
                className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1.5 text-13 text-primary outline-none placeholder:text-placeholder"
              />
              <button
                type="button"
                onClick={() => void submitPrompt(input)}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                className="mb-0.5 rounded-md bg-accent-primary p-1.5 text-on-color transition-opacity disabled:opacity-40"
              >
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
              </button>
            </div>
            <p className="pt-1.5 text-10 text-tertiary">Enter to send · Shift + Enter for a new line</p>
          </div>
        </aside>
      )}
    </>
  );
}
