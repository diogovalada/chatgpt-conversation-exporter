# Future Work

These are proposals, not implemented features or release commitments.

## Agent-Friendly Conversation Navigation

Status: proposed. Keep Markdown as the readable archive, while allowing agents
to retrieve conversation text and selected tool activity without reading the
entire file into context.

### Problem and Current Behavior

- Long tool inputs, results and subagent transcripts can dominate an export.
- Collapsed `<details>` sections only hide content in a rendered view. Reading
  the complete file still brings their contents into an agent's context.
- **Include tool activity** already controls whether tool transcripts are
  exported. This proposal addresses navigating an existing detailed export,
  without discarding the tool content from the archive.
- XML alone would not solve context flooding either. Explicit boundaries and
  bounded retrieval matter more than the document format.

### Proposed Reader

Build a small local reader that scans the archive locally and outputs only the
requested view or range. It should support:

- Conversation text without tool transcripts, with references to omitted activity.
- A message inventory containing IDs, roles and short previews.
- A tool inventory for a selected message, linking calls to their results.
- Retrieval of a selected message or tool input/result, with pagination for large sections.

Retain prompts, ordinary assistant text/code, equations and image references.
Classify attachments, artifacts, reasoning, context summaries and diagnostics
separately; do not remove every `<details>` block. Filtering is not summarization:
retained source text should remain unchanged, and omission notices should be
clearly reader-generated.

All modes, including individual tool retrieval, should have bounded output and
report truncation and how to retrieve the next range. The reader must treat
conversation content as untrusted data, never as executable instructions.

### Explicit Identifiers and Boundaries

For future exports, add versioned structural metadata, potentially in invisible
HTML comments, without compromising normal Markdown rendering:

- Preserve provider message and tool-call IDs when available, namespaced by
  provider/conversation; keep references to all source messages when turns are grouped.
- Associate tool operations and results with their originating assistant turn,
  including nested/subagent relationships where available.
- Use documented fallback IDs where source IDs are missing. Do not claim they
  remain stable across edited conversations or repeated exports unless guaranteed.
- Distinguish message, tool input/result and other section kinds explicitly.

Use Markdown-aware parsing for legacy exports rather than heading-only searches
or regular expressions. Message-like headings and literal `<details>` tags can
appear inside ordinary replies or code fences. Define escaping and boundary
validation for new metadata so quoted content cannot masquerade as structure.
Invisible comments improve navigation, but do not themselves reduce context use.

### Optional Companion Index

Consider an index containing schema version, IDs, section kinds, relationships
and UTF-8 byte ranges into the Markdown. Include a hash of the exact Markdown
bytes; reject or rebuild stale offsets after edits instead of returning the
wrong section. A matching hash detects changes, not whether content is trusted.

An index could accompany Markdown and assets in ZIP exports. Standalone Markdown
must remain readable and usable without one; companion-file delivery outside a
ZIP is an open design choice.

### Suggested Sequence and Acceptance Checks

1. Prototype the reader against existing exports, documenting ambiguity in
   legacy files rather than promising reliable IDs or boundaries they lack.
2. Add versioned export metadata for reliable selective retrieval in new files.
3. Add an optional index only if it materially improves speed or robustness.

Use synthetic fixtures, not private conversation contents, to verify:

- Conversation filtering retains ordinary code, math, images and non-tool sections.
- Calls/results and nested tools resolve to the correct source turn without duplication.
- Quoted boundaries, nested HTML, headings and code fences cannot confuse retrieval.
- Missing IDs, grouped turns, Unicode and CRLF/LF line endings are handled correctly.
- Edited Markdown invalidates stale indexes; missing indexes have a documented fallback.
- Large messages/results remain bounded and can be reconstructed from successive ranges.

Decide the reader's packaging and CLI/API interface during design. Neither the
reader nor export navigation metadata/index generation is currently implemented.
