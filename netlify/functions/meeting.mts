import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { processWithLLM } from "../../src/groq-llm.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { removeFillers } from "../../src/filler-cleanup.js";
import { MEETING_SUMMARY_PROMPT, MEETING_ACTION_ITEMS_PROMPT } from "../../src/prompts/meeting.js";
import type { GroqChatMessage, MeetingResponse } from "../../src/types.js";

// Max audio size we'll accept for direct transcription (under Groq's 25MB limit)
const MAX_AUDIO_SIZE = 24 * 1024 * 1024; // 24MB

function getDictionary() {
  return loadDictionary({
    terms: {
      groq: "Groq",
      whisperflow: "WhisperFlow",
      wisprflow: "WisprFlow",
      netlify: "Netlify",
    },
    promptHints: "Groq, WhisperFlow, WisprFlow, Netlify",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  console.error(`[Meeting] Error ${status}: ${message}`);
  return jsonResponse({ error: message }, status);
}

function getEnv(key: string): string | undefined {
  try {
    return Netlify.env.get(key) ?? undefined;
  } catch {
    return process.env[key];
  }
}

/**
 * Authenticate and return the Groq API key, or an error Response.
 */
function authenticate(req: Request): { apiKey: string } | Response {
  const secret = getEnv("WHISPERFLOW_SECRET");
  if (secret) {
    const provided = req.headers.get("x-api-key");
    if (provided !== secret) {
      return errorResponse("Unauthorized", 401);
    }
  }
  const apiKey = getEnv("GROQ_API_KEY");
  if (!apiKey) {
    return errorResponse("GROQ_API_KEY not configured", 500);
  }
  return { apiKey };
}

/**
 * Extract audio blob from request body (supports JSON base64, multipart, raw binary).
 */
async function extractAudio(req: Request): Promise<Blob | Response> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    let json: Record<string, string>;
    try {
      json = await req.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResponse(`Invalid JSON: ${msg}`, 400);
    }

    if (!json.audio) {
      return errorResponse("Missing 'audio' field in JSON body", 400);
    }

    const cleanBase64 = json.audio.replace(/\s/g, "");
    console.log(`[Meeting] Base64 audio received: ${cleanBase64.length} chars`);
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: "audio/m4a" });
  }

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResponse(`Invalid form data: ${msg}`, 400);
    }

    const formAudio = formData.get("audio");
    if (!formAudio || !(formAudio instanceof Blob)) {
      const keys = [...formData.keys()];
      return errorResponse(`Missing 'audio' field. Received: ${keys.join(", ")}`, 400);
    }
    return formAudio;
  }

  const body = await req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    return errorResponse("Empty request body. Send audio as the raw POST body.", 400);
  }
  const mimeType = contentType || "audio/m4a";
  return new Blob([body], { type: mimeType });
}

// ---------------------------------------------------------------------------
// action=transcribe — Transcribe a single audio chunk, return { transcript }
// ---------------------------------------------------------------------------
async function handleTranscribeChunk(req: Request): Promise<Response> {
  const auth = authenticate(req);
  if (auth instanceof Response) return auth;
  const { apiKey } = auth;
  const dictionary = getDictionary();

  const audioOrError = await extractAudio(req);
  if (audioOrError instanceof Response) return audioOrError;
  const audioFile = audioOrError;

  console.log(`[Meeting:transcribe] Audio chunk: ${audioFile.size} bytes, type: ${audioFile.type}`);

  if (audioFile.size > MAX_AUDIO_SIZE) {
    return errorResponse(
      `Audio chunk too large (${(audioFile.size / 1024 / 1024).toFixed(1)}MB). ` +
      `Max is ${MAX_AUDIO_SIZE / 1024 / 1024}MB per chunk. Split into smaller segments.`,
      413
    );
  }

  const rawTranscript = await transcribeAudio(audioFile, apiKey, {
    language: "en",
    promptHints: dictionary.promptHints,
  });

  let transcript = removeFillers(rawTranscript);
  transcript = applyDictionary(transcript, dictionary);

  console.log(`[Meeting:transcribe] Transcript (${transcript.length} chars)`);
  return jsonResponse({ transcript });
}

// ---------------------------------------------------------------------------
// action=summarize — Accept { transcript } text, return summary + action items
// ---------------------------------------------------------------------------
async function handleSummarize(req: Request): Promise<Response> {
  const auth = authenticate(req);
  if (auth instanceof Response) return auth;
  const { apiKey } = auth;

  let json: Record<string, string>;
  try {
    json = await req.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(`Invalid JSON: ${msg}`, 400);
  }

  if (!json.transcript || typeof json.transcript !== "string") {
    return errorResponse("Missing 'transcript' string in JSON body", 400);
  }

  const transcript = json.transcript.trim();
  if (!transcript) {
    return jsonResponse({
      transcript: "",
      summary: "No speech detected in the audio.",
      actionItems: "No action items identified.",
    } satisfies MeetingResponse);
  }

  console.log(`[Meeting:summarize] Transcript (${transcript.length} chars), generating summary...`);

  const summaryMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_SUMMARY_PROMPT },
    { role: "user", content: transcript },
  ];

  const actionMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_ACTION_ITEMS_PROMPT },
    { role: "user", content: transcript },
  ];

  const [summary, actionItems] = await Promise.all([
    processWithLLM(summaryMessages, apiKey),
    processWithLLM(actionMessages, apiKey),
  ]);

  const response: MeetingResponse = { transcript, summary, actionItems };
  console.log("[Meeting:summarize] Success");
  return jsonResponse(response);
}

// ---------------------------------------------------------------------------
// Default — Full pipeline for small files (backwards-compatible)
// ---------------------------------------------------------------------------
async function handleFullPipeline(req: Request): Promise<Response> {
  const auth = authenticate(req);
  if (auth instanceof Response) return auth;
  const { apiKey } = auth;
  const dictionary = getDictionary();

  const audioOrError = await extractAudio(req);
  if (audioOrError instanceof Response) return audioOrError;
  const audioFile = audioOrError;

  console.log(`[Meeting] Audio received: ${audioFile.size} bytes, type: ${audioFile.type}`);

  if (audioFile.size > MAX_AUDIO_SIZE) {
    return errorResponse(
      `Audio file too large (${(audioFile.size / 1024 / 1024).toFixed(1)}MB). ` +
      `For files over ${MAX_AUDIO_SIZE / 1024 / 1024}MB, use the chunked upload mode ` +
      `(the web app handles this automatically).`,
      413
    );
  }

  const rawTranscript = await transcribeAudio(audioFile, apiKey, {
    language: "en",
    promptHints: dictionary.promptHints,
  });

  console.log(`[Meeting] Raw transcript (${rawTranscript.length} chars)`);

  if (!rawTranscript.trim()) {
    return jsonResponse({
      transcript: "",
      summary: "No speech detected in the audio.",
      actionItems: "No action items identified.",
    } satisfies MeetingResponse);
  }

  let transcript = removeFillers(rawTranscript);
  transcript = applyDictionary(transcript, dictionary);
  console.log(`[Meeting] Cleaned transcript (${transcript.length} chars)`);

  const summaryMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_SUMMARY_PROMPT },
    { role: "user", content: transcript },
  ];

  const actionMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_ACTION_ITEMS_PROMPT },
    { role: "user", content: transcript },
  ];

  console.log("[Meeting] Generating summary and action items...");
  const [summary, actionItems] = await Promise.all([
    processWithLLM(summaryMessages, apiKey),
    processWithLLM(actionMessages, apiKey),
  ]);

  const response: MeetingResponse = { transcript, summary, actionItems };
  console.log("[Meeting] Success, returning response");
  return jsonResponse(response);
}

// ---------------------------------------------------------------------------
// Main handler — routes by ?action= param
// ---------------------------------------------------------------------------
export default async (req: Request, _context: Context) => {
  try {
    console.log(`[Meeting] ${req.method} ${req.url}`);

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const url = new URL(req.url);

    if (url.searchParams.get("test") === "1") {
      console.log("[Meeting] Test mode — returning OK");
      return jsonResponse({ status: "ok", message: "Meeting endpoint is working" });
    }

    const action = url.searchParams.get("action");

    switch (action) {
      case "transcribe":
        return await handleTranscribeChunk(req);
      case "summarize":
        return await handleSummarize(req);
      default:
        return await handleFullPipeline(req);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[Meeting] FATAL: ${message}`);
    console.error(`[Meeting] Stack: ${stack}`);
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/meeting",
};
