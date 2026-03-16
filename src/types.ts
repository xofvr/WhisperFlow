export type Mode = "transcribe" | "edit";
export type Tone = "casual" | "professional" | "auto";
export type EditCommand = "summarize" | "bullet" | "rewrite" | "custom";

export interface TranscribeRequest {
  audio: Blob;
  mode: Mode;
  tone: Tone;
  /** For edit mode: the text to edit */
  text?: string;
  /** For edit mode: the command to apply */
  command?: EditCommand;
}

export interface Dictionary {
  /** Map of misspelling/variant -> correct form */
  terms: Record<string, string>;
  /** Comma-separated hints fed to Whisper's prompt parameter */
  promptHints: string;
}

export interface GroqWhisperResponse {
  text: string;
}

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface MeetingResponse {
  transcript: string;
  summary: string;
  actionItems: string;
}
