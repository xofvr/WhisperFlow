import type { Context, Config } from "@netlify/functions";
import { transcribeAudio } from "../../src/groq-whisper.js";
import { processWithLLM } from "../../src/groq-llm.js";
import { loadDictionary, applyDictionary } from "../../src/dictionary.js";
import { removeFillers } from "../../src/filler-cleanup.js";
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
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const url = new URL(req.url);

    if (url.searchParams.get("test") === "1") {
      return new Response(JSON.stringify({ status: "ok", message: "WhisperFlow is working" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const secret = getEnv("WHISPERFLOW_SECRET");
    if (secret && req.headers.get("x-api-key") !== secret) {
      return errorResponse("Unauthorized", 401);
    }

    const apiKey = getEnv("GROQ_API_KEY");
    if (!apiKey) return errorResponse("GROQ_API_KEY not configured", 500);

    const dictionary = getDictionary();
    const contentType = req.headers.get("content-type") || "";
    let audioFile: Blob;
    let mode: Mode;
    let tone: Tone;
    let editText: string | null = null;
    let editCommand: EditCommand | null = null;

    if (contentType.includes("application/json")) {
      let json: Record<string, string>;
      try { json = await req.json(); } catch (e) {
        return errorResponse(`Invalid JSON: ${e instanceof Error ? e.message : e}`, 400);
      }
      if (!json.audio) return errorResponse("Missing 'audio' field in JSON body", 400);
      const binaryString = atob(json.audio.replace(/\s/g, ""));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      audioFile = new Blob([bytes], { type: "audio/m4a" });
      mode = (json.mode as Mode) || (url.searchParams.get("mode") as Mode) || "transcribe";
      tone = (json.tone as Tone) || (url.searchParams.get("tone") as Tone) || "auto";
      editText = json.text || null;
      editCommand = (json.command as EditCommand) || null;
    } else if (contentType.includes("multipart/form-data")) {
      let formData: FormData;
      try { formData = await req.formData(); } catch (e) {
        return errorResponse(`Invalid form data: ${e instanceof Error ? e.message : e}`, 400);
      }
      const formAudio = formData.get("audio");
      if (!formAudio || !(formAudio instanceof Blob)) {
        return errorResponse(`Missing 'audio' field. Received: ${[...formData.keys()].join(", ")}`, 400);
      }
      audioFile = formAudio;
      mode = (formData.get("mode") as Mode) || "transcribe";
      tone = (formData.get("tone") as Tone) || "auto";
      editText = formData.get("text") as string | null;
      editCommand = formData.get("command") as EditCommand | null;
    } else {
      const body = await req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return errorResponse("Empty request body. Send audio as the raw POST body.", 400);
      }
      audioFile = new Blob([body], { type: contentType || "audio/m4a" });
      mode = (url.searchParams.get("mode") as Mode) || "transcribe";
      tone = (url.searchParams.get("tone") as Tone) || "auto";
      editText = url.searchParams.get("text");
      editCommand = url.searchParams.get("command") as EditCommand | null;
    }

    let result: string;

    if (mode === "edit") {
      if (!editText) return errorResponse("Edit mode requires a 'text' field", 400);
      const command = editCommand || "custom";
      const voiceInstruction = await transcribeAudio(audioFile, apiKey, { language: "en" });
      const systemPrompt = COMMAND_PROMPTS[command] || COMMAND_PROMPTS.custom;
      const userContent = command === "custom"
        ? `Instruction: ${voiceInstruction}\n\nText to edit:\n${editText}`
        : editText;
      const messages: GroqChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];
      result = applyDictionary(await processWithLLM(messages, apiKey), dictionary);
    } else {
      const rawTranscript = await transcribeAudio(audioFile, apiKey, {
        language: "en",
        promptHints: dictionary.promptHints,
      });
      if (!rawTranscript.trim()) {
        return new Response("", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      result = applyDictionary(removeFillers(rawTranscript), dictionary);
    }

    return new Response(result, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/transcribe",
};
