/**
 * Lightweight filler word removal for Whisper transcripts.
 *
 * Whisper already suppresses most fillers by default, but occasional
 * ones slip through on longer audio. This catches the stragglers
 * without needing a full LLM round-trip.
 */

const FILLER_WORDS = [
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "err",
  "hmm",
  "hm",
  "ah",
  "ahh",
  "mhm",
  "mm",
  "mmm",
];

// Standalone filler words (whole-word match, case-insensitive)
const FILLER_PATTERN = new RegExp(
  `\\b(${FILLER_WORDS.join("|")})\\b[,.]?`,
  "gi"
);

/**
 * Remove filler words and clean up resulting whitespace/punctuation.
 */
export function removeFillers(text: string): string {
  let result = text.replace(FILLER_PATTERN, "");

  // Collapse multiple spaces into one
  result = result.replace(/  +/g, " ");

  // Remove leading spaces after newlines
  result = result.replace(/\n +/g, "\n");

  // Remove spaces before punctuation
  result = result.replace(/ +([.,!?;:])/g, "$1");

  // Fix double punctuation left behind (e.g. ",," or "..")
  result = result.replace(/([.,!?;:])\1+/g, "$1");

  // Capitalise first letter after a full stop if it was lowered by removal
  result = result.replace(/(\. )([a-z])/g, (_match, dot, letter) => dot + letter.toUpperCase());

  return result.trim();
}
