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

  // Derive filename extension from mime type so Groq doesn't misdetect the format
  const extMap: Record<string, string> = {
    "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
    "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3", "audio/webm": "webm", "audio/ogg": "ogg", "audio/flac": "flac",
  };
  const ext = extMap[audioBlob.type] || "m4a";

  const form = new FormData();
  form.append("file", audioBlob, `audio.${ext}`);
  form.append("model", MODEL);
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (promptHints) form.append("prompt", promptHints);

  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${error}`);
  }

  const data: GroqWhisperResponse = await res.json();
  return data.text;
}
