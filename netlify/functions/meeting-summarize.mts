import type { Context, Config } from "@netlify/functions";
import { processWithLLM } from "../../src/groq-llm.js";
import { MEETING_SUMMARY_PROMPT, MEETING_ACTION_ITEMS_PROMPT } from "../../src/prompts/meeting.js";
import type { GroqChatMessage, MeetingResponse } from "../../src/types.js";

function errorResponse(message: string, status: number): Response {
  console.error(`[MeetingSummarize] Error ${status}: ${message}`);
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

    let body: { transcript: string };
    try {
      body = await req.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResponse(`Invalid JSON: ${msg}`, 400);
    }

    if (!body.transcript || !body.transcript.trim()) {
      const empty: MeetingResponse = {
        transcript: "",
        summary: "No speech detected in the audio.",
        actionItems: "No action items identified.",
      };
      return new Response(JSON.stringify(empty), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const transcript = body.transcript;
    console.log(`[MeetingSummarize] Transcript: ${transcript.length} chars`);

    const summaryMessages: GroqChatMessage[] = [
      { role: "system", content: MEETING_SUMMARY_PROMPT },
      { role: "user", content: transcript },
    ];

    const actionMessages: GroqChatMessage[] = [
      { role: "system", content: MEETING_ACTION_ITEMS_PROMPT },
      { role: "user", content: transcript },
    ];

    console.log("[MeetingSummarize] Generating summary and action items...");
    const [summary, actionItems] = await Promise.all([
      processWithLLM(summaryMessages, apiKey),
      processWithLLM(actionMessages, apiKey),
    ]);

    const response: MeetingResponse = {
      transcript,
      summary,
      actionItems,
    };

    console.log("[MeetingSummarize] Success");
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[MeetingSummarize] FATAL: ${message}`);
    return errorResponse(message, 502);
  }
};

export const config: Config = {
  path: "/api/meeting-summarize",
};
