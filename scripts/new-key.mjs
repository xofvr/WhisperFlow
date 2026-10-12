// Usage: npm run new-key -- <name>
// Prints a new key for <name> and the entry to append to WHISPERFLOW_KEYS in Netlify.
import { createHash, randomBytes } from "node:crypto";

const name = process.argv[2];
if (!name || !/^[\w-]+$/.test(name)) {
  console.error("Usage: npm run new-key -- <name>   (letters, numbers, - or _)");
  process.exit(1);
}

const key = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(key).digest("hex");

console.log(`\nKey for ${name} (give this to them, it goes in the website / Shortcut):\n\n  ${key}\n`);
console.log(`Add to WHISPERFLOW_KEYS in Netlify (comma-separate multiple entries):\n\n  ${name}:${hash}\n`);
