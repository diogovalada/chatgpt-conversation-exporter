# Privacy

This extension runs locally in your browser and exports the ChatGPT conversation you are viewing.

## Data collection

- The extension does **not** collect, sell, or share personal data.
- The extension does **not** send your conversation contents to any external server.

## Network access

- When **Download images** is enabled, the extension fetches image URLs referenced by the conversation in order to bundle them into a `.zip`.
- These requests go directly from your browser to the image hosts used by ChatGPT (e.g. `chatgpt.com`, `chat.openai.com`, `images.openai.com`).

## Storage

- The extension stores a small settings object in `chrome.storage.local` (e.g., whether “Download images” is enabled).

