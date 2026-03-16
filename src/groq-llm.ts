import type { GroqChatMessage, GroqChatResponse } from "./types.js";

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export async function processWithLLM(
  messages: GroqChatMessage[],
  apiKey: string
): Promise<string> {
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

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Groq LLM error (${res.status}): ${error}`);
  }

  const data: GroqChatResponse = await res.json();
  return data.choices[0].message.content.trim();
}
