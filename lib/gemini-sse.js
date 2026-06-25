/**
 * Parse Gemini streamGenerateContent SSE blocks (alt=sse).
 * @param {string} block
 * @param {(chunk: { chunkType: 'thought' | 'answer', text: string }) => void} emit
 */
export function parseGeminiSseBlock(block, emit) {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("data:")) continue;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr || jsonStr === "[DONE]") continue;
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      continue;
    }
    const candidates = parsed.candidates || [];
    for (let c = 0; c < candidates.length; c++) {
      const parts = (candidates[c].content && candidates[c].content.parts) || [];
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (!part || !part.text) continue;
        if (part.thought) {
          emit({ chunkType: "thought", text: part.text });
        } else {
          emit({ chunkType: "answer", text: part.text });
        }
      }
    }
  }
}

/**
 * Read a fetch Response body stream and emit parsed Gemini chunks.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(chunk: { chunkType: 'thought' | 'answer', text: string }) => void} emit
 */
export async function readGeminiSseStream(reader, emit) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (let i = 0; i < parts.length; i++) {
      parseGeminiSseBlock(parts[i], emit);
    }
  }
  if (buffer.trim()) {
    parseGeminiSseBlock(buffer, emit);
  }
}
