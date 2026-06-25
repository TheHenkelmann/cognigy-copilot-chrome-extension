import { describe, expect, it } from "vitest";
import { parseGeminiSseBlock, readGeminiSseStream } from "../lib/gemini-sse.js";

describe("parseGeminiSseBlock", () => {
  it("parses answer chunks from SSE data lines", () => {
    const chunks = [];
    const block =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":" world","thought":false}]}}]}';

    parseGeminiSseBlock(block, (chunk) => chunks.push(chunk));

    expect(chunks).toEqual([
      { chunkType: "answer", text: "Hello" },
      { chunkType: "answer", text: " world" },
    ]);
  });

  it("parses thought chunks when part.thought is true", () => {
    const chunks = [];
    const block = 'data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true}]}}]}';

    parseGeminiSseBlock(block, (chunk) => chunks.push(chunk));

    expect(chunks).toEqual([{ chunkType: "thought", text: "thinking…" }]);
  });

  it("ignores malformed JSON and [DONE] markers", () => {
    const chunks = [];
    parseGeminiSseBlock("data: [DONE]\ndata: not-json", (chunk) => chunks.push(chunk));
    expect(chunks).toHaveLength(0);
  });
});

describe("readGeminiSseStream", () => {
  it("reads chunked SSE bodies from a stream reader", async () => {
    const encoder = new TextEncoder();
    const parts = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}\n\n',
    ];
    let index = 0;
    const reader = {
      read: async () => {
        if (index >= parts.length) {
          return { done: true, value: undefined };
        }
        const value = encoder.encode(parts[index++]);
        return { done: false, value };
      },
    };

    const chunks = [];
    await readGeminiSseStream(reader, (chunk) => chunks.push(chunk));

    expect(chunks).toEqual([
      { chunkType: "answer", text: "Hi" },
      { chunkType: "answer", text: " there" },
    ]);
  });
});
