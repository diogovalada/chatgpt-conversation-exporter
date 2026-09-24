# AI Conversation Exporter (Chrome Extension)

Exports ChatGPT and Claude conversations to Markdown or a single zip bundle with local image assets.

## Install from GitHub Releases (recommended)

1. Go to this repo's **Releases** page and download `chatgpt-conversation-exporter.zip`. Or download directly [here](https://github.com/diogovalada/chatgpt-conversation-exporter/releases/latest/download/chatgpt-conversation-exporter.zip).

### Install in Chrome

1. Unzip `chatgpt-conversation-exporter.zip` to a folder
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extracted folder (the one containing `manifest.json`)

Chrome Web Store publishing and release automation are documented in [PUBLISHING.md](./PUBLISHING.md). Ready-to-paste listing and reviewer text is in [STORE_LISTING.md](./STORE_LISTING.md).

## Supported Providers

- ChatGPT on `chatgpt.com` and `chat.openai.com`
- Claude on `claude.ai`

## Usage

### Method 1: Currently opened conversation

- Open a ChatGPT or Claude conversation
- Click the extension icon
- Choose **Save to Downloads** or **Save As…**
- Optional: enable **Download images** to download a single `.zip` that contains the `.md` and a `*-assets/` folder

### Method 2: Download from a conversation list

When you open the 3-dots menu for a supported conversation in the left sidebar or a ChatGPT project home, click **Download**. This opens a background tab, exports the conversation, and closes the tab automatically afterwards.

For live ChatGPT conversations, the exporter authenticates with the current ChatGPT session and loads the fully paginated active branch before attempting any DOM scrolling. It follows every previous-page cursor and exports immediately once the API reaches the first page; currently rendered turns may still enrich its formatting. The legacy full-conversation endpoint and context-continuation stitching are fallbacks only when pagination fails. If API coverage cannot be proven, a direct conversation-page export runs the DOM fallback, which retains snapshots from every rendered window, including newer turns that ChatGPT unloads while older history is loading, and restores the original scroll position afterwards. Project-home and sidebar exports fail visibly instead of silently saving a partial remote conversation when API coverage is unavailable.

For live Claude conversations, the exporter likewise uses the authenticated first-party conversation endpoint before touching the page. It resolves the conversation across the account's organizations, requests all message and tool blocks, and follows `current_leaf_message_uuid` to export only the active branch. If that API is unavailable, the DOM fallback loads earlier messages and snapshots the virtualized feed until every advertised `Message N of M` index has been collected; otherwise it fails rather than saving a partial transcript.

## Provider Support Checklist

When adding a new provider, verify these cases before calling support complete:

- User prompts, including multi-line prompts
- Assistant Markdown, headings, lists, links, and tables
- Code blocks and any detached tool output blocks
- Math and KaTeX content via `annotation[encoding="application/x-tex"]`
- Uploaded images inside user turns
- Generated images or assistant-side image attachments
- Sidebar conversation selection and background-tab export by URL

For the full regression checklist and a suggested "golden conversation" fixture, see [TEST_CHECKLIST.md](./TEST_CHECKLIST.md).

## Known Limitations

- The exporter does not currently auto-expand collapsed sections before extraction.
- If a provider lazily loads the contents of collapsed sections only after they are expanded, that hidden content will not be exported.
- This is known to affect Claude saved HTML snapshots when tool or activity panels were still collapsed at save time, because the inner code/output content may be missing from the saved DOM entirely.
- A future enhancement could expand supported collapsed sections automatically before export, extract their contents, and optionally restore the previous collapsed state afterwards.

## Privacy

The extension handles only the conversation content needed for a user-requested export and processes it locally in the browser. The developer does not receive, retain, sell, or share conversation data, and the extension includes no analytics or advertising. See [PRIVACY.md](./PRIVACY.md).
