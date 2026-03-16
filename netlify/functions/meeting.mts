import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { processWithLLM } from "../../src/groq-llm.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { removeFillers } from "../../src/filler-cleanup.js";
import { MEETING_SUMMARY_PROMPT, MEETING_ACTION_ITEMS_PROMPT } from "../../src/prompts/meeting.js";
import type { GroqChatMessage, MeetingResponse } from "../../src/types.js";

const MAX_AUDIO_SIZE = 24 * 1024 * 1024; // 24MB (under Groq's 25MB limit)

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
  return jsonResponse({ error: message }, status);
}

function getEnv(key: string): string | undefined {
  try {
    return Netlify.env.get(key) ?? undefined;
  } catch {
    return process.env[key];
  }
}

function authenticate(req: Request): { apiKey: string } | Response {
  const secret = getEnv("WHISPERFLOW_SECRET");
  if (secret && req.headers.get("x-api-key") !== secret) {
    return errorResponse("Unauthorized", 401);
  }
  const apiKey = getEnv("GROQ_API_KEY");
  if (!apiKey) return errorResponse("GROQ_API_KEY not configured", 500);
  return { apiKey };
}

async function extractAudio(req: Request): Promise<Blob | Response> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    let json: Record<string, string>;
    try { json = await req.json(); } catch (e) {
      return errorResponse(`Invalid JSON: ${e instanceof Error ? e.message : e}`, 400);
    }
    if (!json.audio) return errorResponse("Missing 'audio' field in JSON body", 400);
    const binaryString = atob(json.audio.replace(/\s/g, ""));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return new Blob([bytes], { type: "audio/m4a" });
  }

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try { formData = await req.formData(); } catch (e) {
      return errorResponse(`Invalid form data: ${e instanceof Error ? e.message : e}`, 400);
    }
    const formAudio = formData.get("audio");
    if (!formAudio || !(formAudio instanceof Blob)) {
      return errorResponse(`Missing 'audio' field. Received: ${[...formData.keys()].join(", ")}`, 400);
    }
    return formAudio;
  }

  const body = await req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    return errorResponse("Empty request body", 400);
  }
  return new Blob([body], { type: contentType || "audio/m4a" });
}

// action=transcribe — Transcribe a single audio chunk
async function handleTranscribeChunk(req: Request): Promise<Response> {
  const auth = authenticate(req);
  if (auth instanceof Response) return auth;
  const dictionary = getDictionary();

  const audioOrError = await extractAudio(req);
  if (audioOrError instanceof Response) return audioOrError;
  const audioFile = audioOrError;

  if (audioFile.size > MAX_AUDIO_SIZE) {
    return errorResponse(`Audio chunk too large (${(audioFile.size / 1024 / 1024).toFixed(1)}MB)`, 413);
  }

  const raw = await transcribeAudio(audioFile, auth.apiKey, {
    language: "en",
    promptHints: dictionary.promptHints,
  });

  return jsonResponse({ transcript: applyDictionary(removeFillers(raw), dictionary) });
}

// action=summarize — Accept { transcript } text, return summary + action items
async function handleSummarize(req: Request): Promise<Response> {
  const auth = authenticate(req);
  if (auth instanceof Response) return auth;

  let json: Record<string, string>;
  try { json = await req.json(); } catch (e) {
    return errorResponse(`Invalid JSON: ${e instanceof Error ? e.message : e}`, 400);
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

  const summaryMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_SUMMARY_PROMPT },
    { role: "user", content: transcript },
  ];
  const actionMessages: GroqChatMessage[] = [
    { role: "system", content: MEETING_ACTION_ITEMS_PROMPT },
    { role: "user", content: transcript },
  ];

  const [summary, actionItems] = await Promise.all([
    processWithLLM(summaryMessages, auth.apiKey),
    processWithLLM(actionMessages, auth.apiKey),
  ]);

  return jsonResponse({ transcript, summary, actionItems } satisfies MeetingResponse);
}

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const url = new URL(req.url);
    if (url.searchParams.get("test") === "1") {
      return jsonResponse({ status: "ok", message: "Meeting endpoint is working" });
    }

    switch (url.searchParams.get("action")) {
      case "transcribe": return await handleTranscribeChunk(req);
      case "summarize": return await handleSummarize(req);
      default: return errorResponse(
        "Missing ?action= param. Use action=transcribe or action=summarize.", 400
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/meeting",
};
