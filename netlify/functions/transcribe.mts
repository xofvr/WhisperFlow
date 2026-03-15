import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { processWithLLM } from "../../src/groq-llm.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { AUTO_EDIT_PROMPT } from "../../src/prompts/auto-edit.js";
import { TONE_CASUAL_PROMPT } from "../../src/prompts/tone-casual.js";
import { TONE_PROFESSIONAL_PROMPT } from "../../src/prompts/tone-professional.js";
import { COMMAND_PROMPTS } from "../../src/prompts/commands.js";
import type { Mode, Tone, EditCommand, GroqChatMessage } from "../../src/types.js";

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
  console.error(`[WhisperFlow] Error ${status}: ${message}`);
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

function getTonePrompt(tone: Tone): string {
  switch (tone) {
    case "casual":
      return "\n\n" + TONE_CASUAL_PROMPT;
    case "professional":
      return "\n\n" + TONE_PROFESSIONAL_PROMPT;
    case "auto":
    default:
      return "";
  }
}

export default async (req: Request, _context: Context) => {
  try {
    console.log(`[WhisperFlow] ${req.method} ${req.url}`);

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const url = new URL(req.url);

    // Test mode: return immediately to verify POST works
    if (url.searchParams.get("test") === "1") {
      console.log("[WhisperFlow] Test mode — returning OK");
      return new Response(JSON.stringify({ status: "ok", message: "WhisperFlow is working" }), {
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
    console.log("[WhisperFlow] Auth passed");

    const apiKey = getEnv("GROQ_API_KEY");
    if (!apiKey) {
      return errorResponse("GROQ_API_KEY not configured", 500);
    }

    const dictionary = getDictionary();

    // Support three input modes:
    // 1. JSON with base64 audio (preferred for Apple Shortcuts)
    //    - { "audio": "base64string", "tone": "auto", "mode": "transcribe" }
    // 2. Raw binary body (Content-Type: audio/*)
    //    - tone/mode via query params
    // 3. Multipart form-data (legacy)
    //    - tone/mode via form fields
    const contentType = req.headers.get("content-type") || "";
    let audioFile: Blob;
    let mode: Mode;
    let tone: Tone;
    let editText: string | null = null;
    let editCommand: EditCommand | null = null;

    if (contentType.includes("application/json")) {
      // JSON with base64-encoded audio
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

      console.log(`[WhisperFlow] Base64 audio received: ${json.audio.length} chars`);
      const binaryString = atob(json.audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioFile = new Blob([bytes], { type: "audio/m4a" });
      mode = (json.mode as Mode) || (url.searchParams.get("mode") as Mode) || "transcribe";
      tone = (json.tone as Tone) || (url.searchParams.get("tone") as Tone) || "auto";
      editText = json.text || null;
      editCommand = (json.command as EditCommand) || null;
    } else if (contentType.includes("multipart/form-data")) {
      // Legacy: multipart form-data
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
      mode = (formData.get("mode") as Mode) || "transcribe";
      tone = (formData.get("tone") as Tone) || "auto";
      editText = formData.get("text") as string | null;
      editCommand = formData.get("command") as EditCommand | null;
    } else {
      // Raw binary body — audio sent directly
      const body = await req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return errorResponse("Empty request body. Send audio as the raw POST body.", 400);
      }
      const mimeType = contentType || "audio/m4a";
      audioFile = new Blob([body], { type: mimeType });
      mode = (url.searchParams.get("mode") as Mode) || "transcribe";
      tone = (url.searchParams.get("tone") as Tone) || "auto";
      editText = url.searchParams.get("text");
      editCommand = url.searchParams.get("command") as EditCommand | null;
    }

    const audioSize = audioFile.size;
    const audioType = audioFile.type;
    console.log(`[WhisperFlow] Audio received: ${audioSize} bytes, type: ${audioType}`);
    console.log(`[WhisperFlow] Mode: ${mode}, Tone: ${tone}`);

    let result: string;

    if (mode === "edit") {
      const text = editText;
      const command = editCommand || "custom";
      if (!text) {
        return errorResponse("Edit mode requires a 'text' field", 400);
      }

      console.log(`[WhisperFlow] Edit mode: command=${command}, text length=${text.length}`);

      console.log("[WhisperFlow] Transcribing voice instruction...");
      const voiceInstruction = await transcribeAudio(audioFile, apiKey, {
        language: "en",
      });
      console.log(`[WhisperFlow] Voice instruction: "${voiceInstruction}"`);

      const systemPrompt = COMMAND_PROMPTS[command] || COMMAND_PROMPTS.custom;
      let userContent: string;
      if (command === "custom") {
        userContent = `Instruction: ${voiceInstruction}\n\nText to edit:\n${text}`;
      } else {
        userContent = text;
      }

      const messages: GroqChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      console.log("[WhisperFlow] Sending to LLM for editing...");
      result = await processWithLLM(messages, apiKey);
      result = applyDictionary(result, dictionary);
    } else {
      console.log("[WhisperFlow] Transcribing audio with Whisper...");
      const rawTranscript = await transcribeAudio(audioFile, apiKey, {
        language: "en",
        promptHints: dictionary.promptHints,
      });
      console.log(`[WhisperFlow] Raw transcript (${rawTranscript.length} chars): "${rawTranscript.substring(0, 200)}"`);

      if (!rawTranscript.trim()) {
        console.log("[WhisperFlow] Empty transcript, returning empty response");
        return new Response("", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      const systemPrompt = AUTO_EDIT_PROMPT + getTonePrompt(tone);
      const messages: GroqChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawTranscript },
      ];

      console.log("[WhisperFlow] Sending to LLM for auto-editing...");
      result = await processWithLLM(messages, apiKey);
      result = applyDictionary(result, dictionary);
      console.log(`[WhisperFlow] Final result (${result.length} chars): "${result.substring(0, 200)}"`);
    }

    console.log("[WhisperFlow] Success, returning response");
    return new Response(result, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[WhisperFlow] FATAL: ${message}`);
    console.error(`[WhisperFlow] Stack: ${stack}`);
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/transcribe",
};
