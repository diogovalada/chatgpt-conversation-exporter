# Provider Test Checklist

Use this checklist when adding or changing provider parsers. The goal is to build at least one "golden" conversation that exercises the important content types and export flows.

## Golden Conversation Contents

The fixture conversation should include all of the following whenever the provider supports them:

- User prompt with multiple paragraphs and blank lines
- User prompt containing Markdown-like characters such as `#`, `*`, backticks, pipes, and brackets
- Non-English text and accented characters
- User-uploaded image
- Claude API image blocks containing only `file_uuid` resolve from `message.files`, in content order and without duplicate Markdown/ZIP assets
- Multiple user-uploaded images in the same turn
- Assistant response that describes the uploaded image
- Assistant Markdown with headings, bold, italics, blockquotes, unordered lists, ordered lists, links, and tables
- Inline code and fenced code blocks
- Inline LaTeX and display LaTeX
- Assistant-generated image or assistant-side image attachment
- Detached tool or code-execution panel with code input and output
- Detached tool or code-execution panel in a failed state or with stderr
- Detached tool or status panel saved while collapsed
- Detached tool or status panel saved while expanded
- Long output inside a scrollable code or tool panel
- At least one ordinary visible code block outside a tool panel
- A long enough conversation to force lazy loading or virtualization on the provider UI, if that UI virtualizes turns
- A bidirectionally virtualized conversation where newer turns unload while scrolling toward the oldest turn
- A very long ChatGPT conversation where the rendered DOM and legacy endpoint start at a later segment but authenticated pagination contains the older turns
- A pagination-complete ChatGPT API response exports without moving the conversation scroll position
- A long Claude conversation where the DOM starts near the final messages but the authenticated API contains the opening prompt
- A branched Claude conversation exports the lineage ending at `current_leaf_message_uuid`, not abandoned alternatives
- A normal Claude `/chat/...` URL is recognized before messages mount, and the DOM fallback handles `div role="article"` with `aria-posinset`/`aria-setsize`

## Optional But Worth Testing

### Claude Code Web Sessions

- Export from the extension popup on `/code/session_...`, then navigate to a normal Claude chat and back without reloading
- Verify the opening prompt and final reply in a session spanning several API event pages
- Confirm extraction works with only the last message mounted and does not scroll the page
- Check multiple assistant/tool messages form one answer, without counting tool results as user prompts
- Include commands containing backticks, failed tools, nested tool-result images and base64 user images
- Verify both Markdown image references and ZIP image assets
- Include subagent activity and a context-compaction boundary/summary; preserve the earlier history
- Repeat overlapping pages and echoed message IDs without duplicating messages
- Match a `session_...` route to the corresponding `cse_...` metadata ID, but reject unrelated IDs
- Reject event sequences that start after 1 or contain missing ranges, including gaps between pages
- Do not count synthetic notifications as human prompts; retain them as collapsed session context
- Exclude transport requests/successful responses, routine sandbox setup and unsent prompt suggestions; retain error responses, sandbox warnings/errors and unfamiliar events
- Tool progress, hook/task updates and permission-check activity obey the tool-activity option
- Failed hook outcomes and nonzero hook exits remain visible with tool activity disabled
- Retain nested MCP failures even when their outer control response reports success
- Interrupt/fail a later API page: report failure and do not save a partial transcript
- Repeated cursors, malformed events and unfinished streamed messages must fail visibly
- A multi-block stream must have a message stop, closed blocks and completed snapshots for every non-empty block, including across API pages
- Tool-use summaries and subagent task notifications obey the tool-activity option while session errors and context summaries remain visible
- Verify with a live session after reloading both the extension and the page; the test fixtures use synthetic data

### Other Provider Cases

These cases are provider-dependent. If the UI supports them, test and document the current behavior.

- File attachments such as PDF, text, or CSV
- Multiple assistant images in one turn
- Audio or voice attachments
- Regenerated answers or edited user prompts
- Consecutive assistant turns without an intervening user turn
- Messages containing only media and no surrounding text
- Tables with empty cells or wide content
- Code blocks with uncommon languages
- HTML snapshots saved after partial scrolling rather than from the fully loaded live page

## Export Flows To Verify

- Popup export from an open conversation
- Export with images disabled
- Export with images enabled
- New installations start with both **Download images** and **Include tool activity** unchecked
- Preferences persist between popup and conversation-menu dialogs, including existing image preferences after upgrading
- Simultaneously open dialogs stay synchronized; changing different flags concurrently must preserve both choices
- Copy Markdown, Save to Downloads and Save As honor the tool-activity preference on all supported providers
- With tool activity off, omit commands/results/subagent transcripts without removing ordinary code, math, images, attachments or Claude artifacts
- Tool images in `display_content` are retained in both export modes, without duplicating media also represented in raw content or file metadata
- With tool activity on, retain the detailed tool export and collapsed sections
- `Save to Downloads`
- `Save As...`
- Sidebar conversation-menu export by URL
- ChatGPT project-home conversation-menu export by URL
- Background-tab export followed by automatic tab close
- Saved static HTML snapshot export

## Pass Criteria

- No user or assistant turns are silently skipped
- Previously captured newer turns remain in the export after older history pages load
- A known long-conversation fixture preserves both its expected user/assistant turn counts and a unique phrase from the first prompt
- Turn order matches the UI order
- Multi-line user prompts keep their paragraph breaks
- Markdown content remains readable and structurally correct
- Math is preserved as LaTeX where available
- User-uploaded images are exported and linked correctly
- Assistant-side images are exported and linked correctly
- Visible code blocks become fenced code blocks in Markdown
- Expanded tool panels export their title, code, output, and status
- Collapsed saved tool panels are still represented, with an explicit note when inner content is missing from the HTML
- Duplicate images are not emitted repeatedly unless they are distinct conversation content
- Filenames are sanitized safely for Windows paths
- Project-home filenames use only the conversation title, not the preview snippet
- Sidebar export and open-tab export produce equivalent Markdown for the same conversation

## Suggested Prompt Sequence

If you need to create one fresh test conversation from scratch, this sequence covers most of the parser surface area:

1. Upload one image and ask the model to describe it.
2. Upload two images in the same turn and ask for a comparison.
3. Ask for a response with a heading, quote, bullet list, numbered list, table, link, and fenced code block.
4. Ask for one inline equation and one display equation in LaTeX.
5. Ask the model to solve something by running code and to show both the code and the output.
6. Ask for a second code run that fails on purpose so stderr or failure UI is exercised.
7. Ask the model to generate an image, if supported.
8. Ask a follow-up question in non-English text with accents.
9. Save one HTML snapshot with all tool panels expanded.
10. Save one HTML snapshot with some tool panels collapsed.

## Snapshot-Specific Notes

- A saved HTML snapshot can only export what is actually present in the DOM at save time.
- If a provider keeps collapsed tool panels out of the DOM, the exporter cannot reconstruct their hidden code or output later.
- For high-fidelity regression fixtures, expand tool and code-execution panels before saving the page.
