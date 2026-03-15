import type { GroqWhisperResponse } from "./types.js";

const WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  options: {
    language?: string;
    promptHints?: string;
  } = {}
): Promise<string> {
  const { language = "en", promptHints } = options;

  console.log(`[Whisper] Starting transcription: ${audioBlob.size} bytes, lang=${language}, model=${MODEL}`);

  const form = new FormData();
  form.append("file", audioBlob, "audio.m4a");
  form.append("model", MODEL);
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");

  if (promptHints) {
    form.append("prompt", promptHints);
  }

  const startTime = Date.now();
  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const elapsed = Date.now() - startTime;
  console.log(`[Whisper] Response: ${res.status} in ${elapsed}ms`);

  if (!res.ok) {
    const error = await res.text();
    console.error(`[Whisper] API error body: ${error}`);
    throw new Error(`Whisper API error (${res.status}): ${error}`);
  }

  const data: GroqWhisperResponse = await res.json();
  console.log(`[Whisper] Transcript: "${data.text.substring(0, 100)}"`);
  return data.text;
}
