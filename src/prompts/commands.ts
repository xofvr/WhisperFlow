export const COMMAND_PROMPTS: Record<string, string> = {
  summarize: `You are a text editor. The user has selected some text and asked you to summarise it.
Rules:
- Produce a concise summary capturing the key points
- Use British English spelling
- Output ONLY the summary, nothing else`,

  bullet: `You are a text editor. The user has selected some text and asked you to convert it to bullet points.
Rules:
- Convert the text into a clear bulleted list
- Each bullet should be a concise, self-contained point
- Use British English spelling
- Output ONLY the bullet points (using - prefix), nothing else`,

  rewrite: `You are a text editor. The user has selected some text and asked you to rewrite it.
Rules:
- Rewrite the text to be clearer and more polished
- Preserve the original meaning completely
- Use British English spelling
- Output ONLY the rewritten text, nothing else`,

  custom: `You are a text editor. The user has selected some text and provided a voice instruction for how to edit it.
Rules:
- Follow the user's spoken instruction exactly
- Use British English spelling
- Output ONLY the edited text, nothing else`,
};
