# Provider Test Checklist

Use this checklist when adding or changing provider parsers. The goal is to build at least one "golden" conversation that exercises the important content types and export flows.

## Golden Conversation Contents

The fixture conversation should include all of the following whenever the provider supports them:

- User prompt with multiple paragraphs and blank lines
- User prompt containing Markdown-like characters such as `#`, `*`, backticks, pipes, and brackets
- Non-English text and accented characters
- User-uploaded image
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

## Optional But Worth Testing

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
- `Save to Downloads`
- `Save As...`
- Sidebar conversation-menu export by URL
- Background-tab export followed by automatic tab close
- Saved static HTML snapshot export

## Pass Criteria

- No user or assistant turns are silently skipped
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
