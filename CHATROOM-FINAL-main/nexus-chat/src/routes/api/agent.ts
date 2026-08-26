import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkBudget,
  clientKey,
  consume,
  estimateTokens,
  rateLimitHeaders,
  recordUsage,
} from "@/lib/rate-limit";

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

/** Sustained request budget per client per minute. */
const RATE_LIMIT = { limit: 12, windowMs: 60_000 };
/** Token allowance per client per rolling hour. */
const TOKEN_BUDGET = 40_000;
const TOKEN_WINDOW = 60 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 1024;

/* -------------------------------------------------------------------------- */
/* Request validation                                                         */
/* -------------------------------------------------------------------------- */

const HistoryTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});

const AgentRequest = z.object({
  prompt: z.string().trim().min(1, "Prompt is required").max(8_000),
  // Room context can be long, but it is bounded so a client can't push an
  // arbitrarily large body through the model on the deployment's key.
  context: z.string().max(24_000).optional(),
  history: z.array(HistoryTurn).max(12).optional(),
  userName: z.string().max(120).optional(),
  mode: z.enum(["chat", "summary"]).default("chat"),
  stream: z.boolean().default(false),
});

type AgentBody = z.infer<typeof AgentRequest>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

function sseEvent(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Wraps a plain string as a single-chunk SSE stream, for the demo path. */
function streamText(text: string, extraHeaders: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chunked so the client's streaming renderer is exercised even without a key.
      const words = text.split(/(\s+)/);
      let index = 0;
      const push = () => {
        if (index >= words.length) {
          controller.enqueue(encoder.encode(sseEvent({ done: true })));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        const chunk = words.slice(index, index + 6).join("");
        index += 6;
        controller.enqueue(encoder.encode(sseEvent({ delta: chunk })));
        setTimeout(push, 24);
      };
      push();
    },
  });
  return new Response(stream, { headers: { ...sseHeaders, ...extraHeaders } });
}

function demoResponse(body: AgentBody): string {
  const topic = body.prompt.length > 140 ? `${body.prompt.slice(0, 137)}…` : body.prompt;
  const contextNote = body.context?.trim()
    ? "I also read the recent messages in this room."
    : "There was no earlier room context to consider.";

  if (body.mode === "summary") {
    return [
      "**Catch-up (demo mode)**",
      "",
      contextNote,
      "",
      "- **Decisions** — nothing recorded yet in this demo response.",
      "- **Action items** — confirm owners for anything still open.",
      "- **Addressed to you** — check any messages that mention you directly.",
      "",
      "_Set `ANTHROPIC_API_KEY` to generate real summaries with Claude._",
    ].join("\n");
  }

  return [
    `**Demo-mode analysis** for “${topic}”`,
    "",
    contextNote,
    "",
    "1. Confirm the goal, the owner, and what a good result looks like.",
    "2. Break the work into small steps and take the highest-risk one first.",
    "3. Agree a review point before final delivery.",
    "",
    "_Set `ANTHROPIC_API_KEY` to get live answers from Claude._",
  ].join("\n");
}

function systemPrompt(body: AgentBody): string {
  const base =
    body.mode === "summary"
      ? "You summarise a team chat conversation for one person, privately. " +
        "Lead with anything addressed to them or awaiting their decision, then decisions made, " +
        "then open action items with owners. Be brief and concrete."
      : "You are the private AI assistant inside a team collaboration chat app. " +
        "Be concise, practical and well structured.";

  return (
    `${base} ` +
    `You are speaking privately with ${body.userName ?? "a user"}; nobody else in the room can see your reply. ` +
    "Use short paragraphs, bullet lists and Markdown where it helps readability." +
    (body.context ? `\n\nRecent room discussion for context:\n${body.context}` : "")
  );
}

/* -------------------------------------------------------------------------- */
/* Route                                                                      */
/* -------------------------------------------------------------------------- */

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        /* ---------------------------- validation --------------------------- */

        const raw = await request.json().catch(() => null);
        if (raw === null) return json({ error: "Invalid request body" }, 400);

        const parsed = AgentRequest.safeParse(raw);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return json({ error: first?.message ?? "Invalid request" }, 400);
        }
        const body = parsed.data;

        /* --------------------------- rate limiting -------------------------- */

        const key = clientKey(request, "agent");
        const limit = consume(key, RATE_LIMIT);
        const headers = rateLimitHeaders(limit, RATE_LIMIT.limit);
        if (!limit.allowed) {
          return json(
            { error: `Too many AI requests. Try again in ${limit.retryAfterSeconds}s.` },
            429,
            headers,
          );
        }

        /* --------------------------- token budget --------------------------- */

        const budget = checkBudget(key, TOKEN_BUDGET, TOKEN_WINDOW);
        const estimatedInput =
          estimateTokens(body.prompt) +
          estimateTokens(body.context ?? "") +
          (body.history ?? []).reduce((sum, turn) => sum + estimateTokens(turn.content), 0);

        if (budget.used + estimatedInput + MAX_OUTPUT_TOKENS > budget.limit) {
          const minutes = Math.ceil((budget.resetAt - Date.now()) / 60_000);
          return json(
            { error: `AI token budget exhausted. It resets in about ${minutes} minutes.` },
            429,
            headers,
          );
        }

        /* ----------------------------- demo mode ---------------------------- */

        const apiKey = process.env["ANTHROPIC_API_KEY"] ?? process.env["CLAUDE_API_KEY"];
        if (!apiKey) {
          const content = demoResponse(body);
          recordUsage(key, estimatedInput + estimateTokens(content));
          return body.stream ? streamText(content, headers) : json({ content }, 200, headers);
        }

        /* ------------------------------ upstream ---------------------------- */

        const messages = [
          ...(body.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
          { role: "user" as const, content: body.prompt },
        ];

        let upstream: Response;
        try {
          upstream = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5",
              max_tokens: MAX_OUTPUT_TOKENS,
              system: systemPrompt(body),
              messages,
              stream: body.stream,
            }),
          });
        } catch {
          return json({ error: "Could not connect to Claude. Check your network." }, 502, headers);
        }

        if (!upstream.ok) {
          const data = (await upstream.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          if (upstream.status === 401 || upstream.status === 403)
            return json({ error: "The Claude API key is invalid or lacks access." }, 401, headers);
          if (upstream.status === 429)
            return json({ error: "Claude rate limit reached. Try again shortly." }, 429, headers);
          return json(
            { error: data.error?.message?.slice(0, 300) || "Claude request failed." },
            upstream.status >= 500 ? 502 : 400,
            headers,
          );
        }

        /* ---------------------------- non-streaming -------------------------- */

        if (!body.stream) {
          const data = (await upstream.json().catch(() => ({}))) as {
            content?: Array<{ type?: string; text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          const content = (data.content ?? [])
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n")
            .trim();
          if (!content) return json({ error: "Claude returned an empty response." }, 502, headers);
          recordUsage(
            key,
            (data.usage?.input_tokens ?? estimatedInput) + (data.usage?.output_tokens ?? 0),
          );
          return json({ content }, 200, headers);
        }

        /* ------------------------------ streaming --------------------------- */

        // Anthropic's SSE is re-emitted as a minimal `{delta}` protocol so the
        // client never has to know the upstream event schema.
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let outputTokens = 0;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body?.getReader();
            if (!reader) {
              controller.enqueue(
                encoder.encode(sseEvent({ error: "Empty response from Claude." })),
              );
              controller.close();
              return;
            }
            let buffer = "";
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  if (!line.startsWith("data:")) continue;
                  const payload = line.slice(5).trim();
                  if (!payload) continue;
                  let event: {
                    type?: string;
                    delta?: { text?: string };
                    usage?: { output_tokens?: number };
                    error?: { message?: string };
                  };
                  try {
                    event = JSON.parse(payload);
                  } catch {
                    continue;
                  }
                  if (event.type === "error") {
                    controller.enqueue(
                      encoder.encode(
                        sseEvent({ error: event.error?.message ?? "Claude stream failed." }),
                      ),
                    );
                    continue;
                  }
                  if (event.type === "content_block_delta" && event.delta?.text) {
                    outputTokens += estimateTokens(event.delta.text);
                    controller.enqueue(encoder.encode(sseEvent({ delta: event.delta.text })));
                  }
                  if (event.type === "message_delta" && event.usage?.output_tokens) {
                    outputTokens = event.usage.output_tokens;
                  }
                }
              }
              controller.enqueue(encoder.encode(sseEvent({ done: true })));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  sseEvent({
                    error: error instanceof Error ? error.message : "Stream interrupted.",
                  }),
                ),
              );
            } finally {
              recordUsage(key, estimatedInput + outputTokens);
              controller.close();
            }
          },
        });

        return new Response(stream, { headers: { ...sseHeaders, ...headers } });
      },
    },
  },
});
