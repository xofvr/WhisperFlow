# iPhone Shortcut Setup Guide

This guide walks you through creating the WhisperFlow dictation shortcut on your iPhone.

## Prerequisites

- Your WhisperFlow Netlify site is deployed
- You have your site URL (e.g., `https://your-site.netlify.app`)
- You have your `WHISPERFLOW_SECRET` value

## Basic Dictation Shortcut

### Step 1: Open Shortcuts App

Open the **Shortcuts** app on your iPhone and tap **+** to create a new shortcut.

### Step 2: Add "Record Audio" Action

1. Tap **Add Action**
2. Search for **Record Audio**
3. Configure:
   - **Audio Quality**: Normal
   - **Start Recording**: Immediately
   - **Finish Recording**: On Tap

### Step 3: Add "Get Contents of URL" Action

1. Tap **+** to add another action
2. Search for **Get Contents of URL**
3. Configure:
   - **URL**: `https://your-site.netlify.app/api/transcribe`
   - **Method**: POST
   - **Headers**: Add header
     - Key: `x-api-key`
     - Value: `your-secret-here`
   - **Request Body**: Form
     - Add field: Key = `audio`, Value = **Recorded Audio** (tap to select the variable from Step 2), Type = **File**
     - Add field: Key = `tone`, Value = `auto`, Type = **Text**

### Step 4: Add "Copy to Clipboard" Action

1. Tap **+** to add another action
2. Search for **Copy to Clipboard**
3. Set it to copy **Contents of URL** (the response from Step 3)

### Step 5: Add Notification

1. Tap **+** to add another action
2. Search for **Show Notification**
3. Set the body to **Contents of URL** (shows a preview of the transcribed text)

### Step 6: Add Haptic Feedback (Optional)

1. Tap **+** to add another action
2. Search for **Play Sound** or use **Vibrate Device**

### Step 7: Name and Save

1. Tap the name at the top and rename to **WhisperFlow**
2. Tap **Done**

## Assign to Action Button

1. Open **Settings**
2. Tap **Action Button**
3. Swipe through options to **Shortcuts**
4. Tap the selection area and choose **WhisperFlow**

## Usage

1. **Press and hold** the Action Button — recording starts immediately
2. **Speak naturally** — say what you want to type, including filler words (they'll be removed)
3. **Tap the screen** to stop recording
4. **Wait ~1-2 seconds** — you'll feel a vibration and see a notification when done
5. **Paste anywhere** — the clean text is in your clipboard

## Tone Modes

Change the `tone` field value in Step 3 to switch modes:

- `auto` — general-purpose cleanup (default)
- `casual` — conversational tone for messaging apps
- `professional` — polished tone for emails and documents

## Tips

- **Speak naturally**: Don't worry about saying "um" or "uh" — they're automatically removed
- **British English**: Output uses British spelling (colour, organise, etc.)
- **Custom terms**: Add your own terms to `config/dictionary.json` in the repo and redeploy
- **Long recordings**: Groq supports up to 25MB audio files (~10+ minutes)
