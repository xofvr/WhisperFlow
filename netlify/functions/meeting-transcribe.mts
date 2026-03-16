import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { removeFillers } from "../../src/filler-cleanup.js";

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
  console.error(`[MeetingTranscribe] Error ${status}: ${message}`);
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

export default async (req: Request, _context: Context) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

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

    const dictionary = getDictionary();
    const contentType = req.headers.get("content-type") || "";
    let audioFile: Blob;

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
        return errorResponse("Missing 'audio' field", 400);
      }
      audioFile = formAudio;
    } else {
      const body = await req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return errorResponse("Empty request body", 400);
      }
      audioFile = new Blob([body], { type: contentType || "audio/webm" });
    }

    console.log(`[MeetingTranscribe] Audio: ${audioFile.size} bytes, type: ${audioFile.type}`);

    const rawTranscript = await transcribeAudio(audioFile, apiKey, {
      language: "en",
      promptHints: dictionary.promptHints,
    });

    let transcript = removeFillers(rawTranscript);
    transcript = applyDictionary(transcript, dictionary);

    return new Response(JSON.stringify({ transcript }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[MeetingTranscribe] FATAL: ${message}`);
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/meeting-transcribe",
};
