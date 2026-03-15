# Advanced Shortcut: Edit Mode

This guide covers the advanced WhisperFlow shortcut that includes text editing commands.

## Overview

The advanced shortcut adds a menu when triggered, letting you choose between:
- **Dictate** — standard speech-to-text (same as basic shortcut)
- **Edit Selection** — edit text from your clipboard using voice commands
- **Quick Note** — dictate and save directly to Notes app

## Setup

### Step 1: Create New Shortcut

Open **Shortcuts** app and tap **+** to create a new shortcut.

### Step 2: Add "Choose from Menu" Action

1. Tap **Add Action**
2. Search for **Choose from Menu**
3. Set up three options:
   - `Dictate`
   - `Edit Selection`
   - `Quick Note`

### Step 3: Configure "Dictate" Branch

Inside the **Dictate** section:

1. **Record Audio** (Quality: Normal, Start: Immediately, Finish: On Tap)
2. **Get Contents of URL**:
   - URL: `https://your-site.netlify.app/api/transcribe`
   - Method: POST
   - Headers: `x-api-key: your-secret`
   - Body (Form):
     - `audio` = Recorded Audio (File)
     - `tone` = `auto` (Text)
3. **Copy to Clipboard**: Contents of URL
4. **Show Notification**: Contents of URL

### Step 4: Configure "Edit Selection" Branch

Inside the **Edit Selection** section:

1. **Get Clipboard** — retrieves the text you've copied/highlighted
2. **Choose from Menu** (nested):
   - `Summarise`
   - `Bullet Points`
   - `Rewrite`
   - `Custom (Voice)`
3. For each sub-option, set a variable:
   - Summarise → Set variable `command` to `summarize`
   - Bullet Points → Set variable `command` to `bullet`
   - Rewrite → Set variable `command` to `rewrite`
   - Custom → Set variable `command` to `custom`
4. **Record Audio** (for voice instruction — especially useful for "Custom")
5. **Get Contents of URL**:
   - URL: `https://your-site.netlify.app/api/transcribe`
   - Method: POST
   - Headers: `x-api-key: your-secret`
   - Body (Form):
     - `audio` = Recorded Audio (File)
     - `mode` = `edit` (Text)
     - `text` = Clipboard (Text)
     - `command` = `command` variable (Text)
6. **Copy to Clipboard**: Contents of URL
7. **Show Notification**: Contents of URL

### Step 5: Configure "Quick Note" Branch

Inside the **Quick Note** section:

1. **Record Audio** (Quality: Normal, Start: Immediately, Finish: On Tap)
2. **Get Contents of URL** (same as Dictate branch)
3. **Create Note**: Set body to Contents of URL
4. **Show Notification**: "Note saved"

### Step 6: Name and Save

Name the shortcut **WhisperFlow Pro** and tap **Done**.

## Usage Examples

### Dictate
Press Action Button → Choose "Dictate" → Speak → Text copied to clipboard.

### Edit Selection
1. In any app, **select and copy** the text you want to edit
2. Press Action Button → Choose "Edit Selection"
3. Pick a command (e.g., "Bullet Points")
4. Optionally speak additional instructions (for "Custom" mode)
5. Edited text is copied to clipboard — paste to replace

### Quick Note
Press Action Button → Choose "Quick Note" → Speak your thought → Saved to Notes app.
