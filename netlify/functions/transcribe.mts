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
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const secret = Netlify.env.get("WHISPERFLOW_SECRET");
  if (secret) {
    const provided = req.headers.get("x-api-key");
    if (provided !== secret) {
      return errorResponse("Unauthorized", 401);
    }
  }

  const apiKey = Netlify.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return errorResponse("GROQ_API_KEY not configured", 500);
  }

  const dictionary = getDictionary();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (_e) {
    return errorResponse("Invalid form data. Send multipart/form-data with an 'audio' field.", 400);
  }

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return errorResponse("Missing 'audio' field in form data", 400);
  }

  const mode = (formData.get("mode") as Mode) || "transcribe";
  const tone = (formData.get("tone") as Tone) || "auto";

  try {
    let result: string;

    if (mode === "edit") {
      const text = formData.get("text") as string;
      const command = (formData.get("command") as EditCommand) || "custom";
      if (!text) {
        return errorResponse("Edit mode requires a 'text' field", 400);
      }

      const voiceInstruction = await transcribeAudio(audioFile, apiKey, {
        language: "en",
      });

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

      result = await processWithLLM(messages, apiKey);
      result = applyDictionary(result, dictionary);
    } else {
      const rawTranscript = await transcribeAudio(audioFile, apiKey, {
        language: "en",
        promptHints: dictionary.promptHints,
      });

      if (!rawTranscript.trim()) {
        return new Response("", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      const systemPrompt = AUTO_EDIT_PROMPT + getTonePrompt(tone);
      const messages: GroqChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawTranscript },
      ];

      result = await processWithLLM(messages, apiKey);
      result = applyDictionary(result, dictionary);
    }

    return new Response(result, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("WhisperFlow error:", message);
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/transcribe",
};
