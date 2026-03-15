import type { GroqChatMessage, GroqChatResponse } from "./types.js";

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export async function processWithLLM(
  messages: GroqChatMessage[],
  apiKey: string
): Promise<string> {
  console.log(`[LLM] Sending ${messages.length} messages to ${MODEL}`);

  const startTime = Date.now();
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  const elapsed = Date.now() - startTime;
  console.log(`[LLM] Response: ${res.status} in ${elapsed}ms`);

  if (!res.ok) {
    const error = await res.text();
    console.error(`[LLM] API error body: ${error}`);
    throw new Error(`Groq LLM error (${res.status}): ${error}`);
  }

  const data: GroqChatResponse = await res.json();
  const result = data.choices[0].message.content.trim();
  console.log(`[LLM] Result (${result.length} chars): "${result.substring(0, 100)}"`);
  return result;
}
