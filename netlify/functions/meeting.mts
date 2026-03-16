import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { processWithLLM } from "../../src/groq-llm.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { removeFillers } from "../../src/filler-cleanup.js";
import { MEETING_SUMMARY_PROMPT, MEETING_ACTION_ITEMS_PROMPT } from "../../src/prompts/meeting.js";
import type { GroqChatMessage, MeetingResponse } from "../../src/types.js";

const CHUNK_SIZE = 24 * 1024 * 1024; // 24MB

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

function errorResponse(message: string, status: number): Response {
  console.error(`[Meeting] Error ${status}: ${message}`);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getEnv(key: string): string | undefined {
  try {
    return Netlify.env.get(key) ?? undefined;
  } catch {
    return process.env[key];
  }
}

function splitIntoChunks(audioBuffer: ArrayBuffer, mimeType: string): Blob[] {
  const chunks: Blob[] = [];
  for (let offset = 0; offset < audioBuffer.byteLength; offset += CHUNK_SIZE) {
    const slice = audioBuffer.slice(offset, Math.min(offset + CHUNK_SIZE, audioBuffer.byteLength));
    chunks.push(new Blob([slice], { type: mimeType }));
  }
  return chunks;
}

export default async (req: Request, _context: Context) => {
  try {
    console.log(`[Meeting] ${req.method} ${req.url}`);

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const url = new URL(req.url);

    if (url.searchParams.get("test") === "1") {
      console.log("[Meeting] Test mode — returning OK");
      return new Response(JSON.stringify({ status: "ok", message: "Meeting endpoint is working" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const secret = getEnv("WHISPERFLOW_SECRET");
    if (secret) {
      const provided = req.headers.get("x-api-key");
      if (provided !== secret) {
        return errorResponse("Unauthorized", 401);
      }
    }
    console.log("[Meeting] Auth passed");

    const apiKey = getEnv("GROQ_API_KEY");
    if (!apiKey) {
      return errorResponse("GROQ_API_KEY not configured", 500);
    }

    const dictionary = getDictionary();

    // Parse audio from request
    const contentType = req.headers.get("content-type") || "";
    let audioFile: Blob;

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
      audioFile = new Blob([bytes], { type: "audio/m4a" });
    } else if (contentType.includes("multipart/form-data")) {
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
      audioFile = formAudio;
    } else {
      const body = await req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return errorResponse("Empty request body. Send audio as the raw POST body.", 400);
      }
      const mimeType = contentType || "audio/m4a";
      audioFile = new Blob([body], { type: mimeType });
    }

    console.log(`[Meeting] Audio received: ${audioFile.size} bytes, type: ${audioFile.type}`);

    // Transcribe — with chunking safety net for large files
    let rawTranscript: string;
    const audioBuffer = await audioFile.arrayBuffer();

    if (audioBuffer.byteLength > CHUNK_SIZE) {
      console.log(`[Meeting] Audio exceeds ${CHUNK_SIZE} bytes, splitting into chunks`);
      const chunks = splitIntoChunks(audioBuffer, audioFile.type);
      const transcripts: string[] = [];
      for (const chunk of chunks) {
        console.log(`[Meeting] Transcribing chunk: ${chunk.size} bytes`);
        transcripts.push(await transcribeAudio(chunk, apiKey, {
          language: "en",
          promptHints: dictionary.promptHints,
        }));
      }
      rawTranscript = transcripts.join(" ");
    } else {
      rawTranscript = await transcribeAudio(audioFile, apiKey, {
        language: "en",
        promptHints: dictionary.promptHints,
      });
    }

    console.log(`[Meeting] Raw transcript (${rawTranscript.length} chars)`);

    if (!rawTranscript.trim()) {
      const empty: MeetingResponse = {
        transcript: "",
        summary: "No speech detected in the audio.",
        actionItems: "No action items identified.",
      };
      return new Response(JSON.stringify(empty), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Clean up transcript
    let transcript = removeFillers(rawTranscript);
    transcript = applyDictionary(transcript, dictionary);
    console.log(`[Meeting] Cleaned transcript (${transcript.length} chars)`);

    // Summarise and extract action items in parallel
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

    const response: MeetingResponse = {
      transcript,
      summary,
      actionItems,
    };

    console.log("[Meeting] Success, returning response");
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
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
