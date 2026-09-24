# Privacy Policy

Last updated: September 1, 2026

AI Conversation Exporter reads conversation content from supported ChatGPT and Claude pages only when needed to provide its user-facing export features. Processing happens locally in the user's browser.

## Data handled

The extension may handle the following data from the conversation selected by the user:

- Website content, including conversation titles, prompts, responses, code, equations, links, and attachment metadata.
- Personal communications and user-generated content contained in those conversations.
- User-uploaded and model-generated images when the user enables **Download images**.

The developer does not receive, collect, retain, sell, or share this conversation data. The extension has no analytics, advertising, tracking, or developer-operated data server.

## How data is used

Conversation data is used only to create the Markdown or ZIP export requested by the user. The resulting file is downloaded to the user's own device and remains under the user's control.

When **Download images** is enabled, the extension requests image URLs from the relevant ChatGPT, OpenAI, Claude, or Anthropic host over HTTPS so those images can be included in the local ZIP. These requests are made directly by the browser to the service already hosting the image; the data is not routed through a developer-operated server.

## Local storage

The extension stores only its user-selected settings, such as whether image downloading is enabled, in `chrome.storage.local`. It does not store conversation content in extension storage.

## Retention and deletion

The developer retains no user conversation data. Users can delete exported files through their operating system, clear the extension's local settings in Chrome, or uninstall the extension at any time.

## Third-party services

Use of ChatGPT and Claude remains subject to the privacy policies and terms of their respective providers. This extension is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

## Limited Use

The extension's use of information obtained from supported services is limited to providing the conversation-export functionality described to the user. It does not use or transfer user data for advertising, profiling, creditworthiness, lending, or any purpose unrelated to that single function.

## Contact

Privacy questions can be submitted through the project's [GitHub issue tracker](https://github.com/diogovalada/chatgpt-conversation-exporter/issues).
