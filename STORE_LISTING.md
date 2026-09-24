# Chrome Web Store Listing

Use this copy in the Chrome Web Store Developer Dashboard. Keep the listing, privacy declarations, and extension behavior consistent when functionality changes.

## Product details

**Name**

AI Conversation Exporter

**Summary**

Export ChatGPT and Claude conversations to clean Markdown, with optional local image bundles.

**Detailed description**

Save the AI conversations you choose as portable Markdown files.

AI Conversation Exporter supports ChatGPT and Claude and preserves common conversation content such as headings, lists, tables, links, code blocks, equations, uploaded images, and generated images. On ChatGPT, you can export the complete active conversation, select individual user or assistant messages, or start a download from a conversation menu in the sidebar or project view.

Enable image downloads to receive one ZIP containing the Markdown file and its local image assets. Otherwise, the extension creates a standalone Markdown file with the original image links.

Conversation processing happens locally in your browser. The developer does not receive or retain your conversation content, and the extension includes no analytics, advertising, or tracking.

This extension is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

## Privacy tab

**Single purpose**

Export user-selected ChatGPT and Claude conversation content to Markdown or a local ZIP with image assets.

**Permission justification: downloads**

Required to save the Markdown or ZIP file explicitly requested by the user to their device and to support Chrome's Save As dialog.

**Permission justification: storage**

Required to remember the user's local export preference for whether images should be downloaded. Conversation content is not stored in extension storage.

**Host permission justification: chatgpt.com and chat.openai.com**

Required to add the export controls, read only the conversation selected by the user, and retrieve that conversation's authenticated paginated data when necessary for a complete export.

**Host permission justification: images.openai.com**

Required only when the user enables image downloading, so ChatGPT-hosted images can be included in the requested local ZIP.

**Host permission justification: claude.ai**

Required to add the export controls and read only the Claude conversation selected by the user.

**Host permission justification: assets-proxy.anthropic.com**

Required only when the user enables image downloading, so Claude-hosted images can be included in the requested local ZIP.

**Remote code**

No. All executable code is included in the extension package. Conversation and image requests retrieve user content, not executable code.

**User data disclosures**

Disclose website content, personal communications, and user-generated content. The extension handles these categories locally only to perform a user-requested export. It does not transmit them to the developer or to unrelated third parties, and it does not use them for advertising, analytics, profiling, or any secondary purpose.

**Privacy policy URL**

https://github.com/diogovalada/chatgpt-conversation-exporter/blob/main/PRIVACY.md

## Store URLs

**Homepage**

https://github.com/diogovalada/chatgpt-conversation-exporter

**Support**

https://github.com/diogovalada/chatgpt-conversation-exporter/issues

## Reviewer test instructions

1. Sign in to ChatGPT or Claude and open a conversation containing at least one user message and one assistant response.
2. Click the extension toolbar icon and choose **Save to Downloads**. Confirm that a Markdown file is downloaded and includes the visible conversation.
3. Enable **Download images** and repeat with a conversation containing an image. Confirm that a ZIP is downloaded with the Markdown file and an assets folder.
4. On ChatGPT, click **Select**, choose a selection preset or individual checkboxes, and export. Confirm that only selected messages are included.
5. On ChatGPT, open a conversation's three-dot menu in the sidebar, project home, or conversation header and click **Download**. Confirm that the corresponding conversation is exported.

No separate test account or credentials are supplied. Reviewers may use their own ChatGPT or Claude account because the extension does not provide or bypass access to either service.
