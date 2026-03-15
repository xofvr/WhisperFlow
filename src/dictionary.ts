import type { Dictionary } from "./types.js";

export function loadDictionary(raw: {
  terms: Record<string, string>;
  promptHints: string;
}): Dictionary {
  return {
    terms: raw.terms,
    promptHints: raw.promptHints,
  };
}

export function applyDictionary(text: string, dictionary: Dictionary): string {
  let result = text;
  for (const [variant, correct] of Object.entries(dictionary.terms)) {
    const pattern = new RegExp(`\\b${escapeRegex(variant)}\\b`, "gi");
    result = result.replace(pattern, correct);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
