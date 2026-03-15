# WhisperFlow

Speech-to-text dictation powered by Groq Whisper + LLM auto-editing, triggered from your iPhone Action Button.

A personal, low-cost alternative to [WisprFlow](https://wisprflow.ai/) that runs as an iPhone Shortcut backed by a Netlify serverless function.

## Features

- **Fast transcription** via Groq Whisper Large v3 Turbo (216x real-time speed)
- **Auto-editing** removes filler words (um, uh, like), adds punctuation, fixes grammar
- **British English** spelling throughout
- **Tone matching** — casual (messaging) or professional (email) modes
- **Custom dictionary** for your own terms, names, and acronyms
- **Smart editing** — highlight text, speak a command (summarise, bullet-point, rewrite)
- **Action Button** — press and hold to dictate, text lands in your clipboard

## How It Works

```
iPhone Action Button → Shortcut records audio
  → POST to Netlify function
  → Groq Whisper (transcribe) → Groq Llama 3.3 (auto-edit)
  → Clean text returned → copied to clipboard
```

## Setup

### 1. Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/YOUR_USERNAME/WhisperFlow)

Or deploy manually:
```bash
npm install
netlify deploy --prod
```

### 2. Set Environment Variables

In the Netlify dashboard (Site settings → Environment variables):

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Your Groq API key from [console.groq.com](https://console.groq.com) |
| `WHISPERFLOW_SECRET` | A secret string to protect your endpoint (you choose this) |

### 3. Create iPhone Shortcut

See [docs/shortcut-setup.md](docs/shortcut-setup.md) for the step-by-step guide.

### 4. Assign to Action Button

1. Open **Settings** on your iPhone
2. Tap **Action Button**
3. Swipe to **Shortcuts**
4. Select the **WhisperFlow** shortcut
5. Press and hold the Action Button — you'll feel a haptic tap when dictation starts

## API Reference

### `POST /api/transcribe`

**Headers:**
- `x-api-key`: Your `WHISPERFLOW_SECRET` value

**Body** (multipart/form-data):

| Field | Required | Description |
|-------|----------|-------------|
| `audio` | Yes | Audio file (m4a, mp3, wav, etc.) |
| `mode` | No | `transcribe` (default) or `edit` |
| `tone` | No | `auto` (default), `casual`, or `professional` |
| `text` | Edit mode | The text to edit |
| `command` | Edit mode | `summarize`, `bullet`, `rewrite`, or `custom` |

**Response:** Plain text (the transcribed/edited text).

## Custom Dictionary

Edit `config/dictionary.json` to add your own terms:

```json
{
  "terms": {
    "groq": "Groq",
    "mycompany": "MyCompany"
  },
  "promptHints": "Groq, MyCompany"
}
```

- `terms`: Maps misspellings/variants to the correct form (applied after LLM processing)
- `promptHints`: Fed to Whisper's prompt parameter to bias vocabulary recognition

## Cost

- **Groq Whisper**: ~$0.04/hour of audio (~$0.0006 per 30s dictation)
- **Groq LLM** (Llama 3.3 70B): Free tier
- **Netlify**: Free tier (125k requests/month)
- **Effective cost**: Essentially free for personal use

## Security

- Groq API key is stored server-side only (never exposed to the client/Shortcut)
- Endpoint protected by `x-api-key` header
- Audio is sent to Groq for processing — do not use for sensitive/confidential content unless you trust Groq's data policies
