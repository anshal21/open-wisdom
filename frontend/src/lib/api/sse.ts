import type { AskEvent, AskEventName } from "./types";

/**
 * Minimal SSE reader. `fetch` + ReadableStream rather than EventSource, because
 * the ask endpoint is a POST and EventSource cannot send a body.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): { event: string; data: string } | null {
  const lines = raw.split("\n");
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0 && event === "message") return null;
  return { event, data: data.join("\n") };
}

const ASK_EVENTS = new Set<string>([
  "stage",
  "interpretation",
  "ambiguity",
  "result",
  "check",
  "verdict",
  "narrative",
  "chart",
  "cost",
  "error",
]);

export function toAskEvent(frame: { event: string; data: string }): AskEvent | null {
  if (!ASK_EVENTS.has(frame.event)) return null;
  try {
    return {
      event: frame.event as AskEventName,
      data: JSON.parse(frame.data),
    } as AskEvent;
  } catch {
    return null;
  }
}
