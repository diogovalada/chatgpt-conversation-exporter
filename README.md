# ChatGPT Conversation Exporter (Chrome Extension)

## Install from GitHub Releases (recommended)

1. Go to this repo's **Releases** page and download `chatgpt-conversation-exporter.zip`. Or download directly [here](https://github.com/diogovalada/chatgpt-conversation-exporter/releases/latest/download/chatgpt-conversation-exporter.zip).

### Install in Chrome

1. Unzip `chatgpt-conversation-exporter.zip` to a folder
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extracted folder (the one containing `manifest.json`)

## Usage

### Method 1: Currently opened conversation method

- Open a ChatGPT conversation on `chatgpt.com` (or `chat.openai.com`)
- Click the extension icon
- Choose **Save to Downloads** or **Save As…**
- Optional: enable **Download images** to download a single `.zip` that contains the `.md` and a `*-assets/` folder

### Method 2: Download from conversation list (left sidebar)

When you open the 3-dots menu for a conversation in the left sidebar, click the **Download**. This will open a background tab (which is automatically closed afterwards) and download the conversation

## Privacy

This extensions collects **NO** data. See `PRIVACY.md`.
