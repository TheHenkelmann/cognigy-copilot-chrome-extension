// @ts-check
/**
 * Cognigy Copilot — service worker (Manifest V3, ES module)
 */
import { readGeminiSseStream } from "./lib/gemini-sse.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("[CognigyCopilot:BG]");
const GEMINI_PORT_NAME = "GEMINI_GENERATE";

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== GEMINI_PORT_NAME) return;

  port.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "GENERATE") return;
    handleGeminiStream(port, msg).catch(function (err) {
      try {
        port.postMessage({ type: "error", error: String(err && err.message ? err.message : err) });
      } catch {
        /* ignore disconnect errors */
      }
    });
  });
});

/**
 * @param {chrome.runtime.Port} port
 * @param {{ apiKey?: string, model?: string, systemInstruction?: string, userText?: string }} msg
 */
async function handleGeminiStream(port, msg) {
  const apiKey = String(msg.apiKey || "").trim();
  const model = String(msg.model || "gemini-3.5-flash").trim();
  const systemInstruction = String(msg.systemInstruction || "");
  const userText = String(msg.userText || "");

  if (!apiKey) {
    port.postMessage({ type: "error", error: "API key missing" });
    return;
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":streamGenerateContent?alt=sse";

  const body = {
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      maxOutputTokens: 65535,
      temperature: 1,
      topP: 0.95,
      thinkingConfig: {
        thinkingLevel: "MEDIUM",
        includeThoughts: true,
      },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(function () {
      return "";
    });
    port.postMessage({
      type: "error",
      error: "Gemini HTTP " + res.status + ": " + errText.slice(0, 500),
    });
    return;
  }

  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    port.postMessage({ type: "error", error: "Streaming not supported" });
    return;
  }

  await readGeminiSseStream(reader, function (chunk) {
    port.postMessage({ type: "chunk", chunkType: chunk.chunkType, text: chunk.text });
  });

  port.postMessage({ type: "done" });
}

log.info("service worker initialized");
