const assert = require("node:assert/strict");
const createClaudeContext = require("./helpers/claude-context.js");

const runtime = createClaudeContext({ location: {
  href: "https://claude.ai/chat/11111111-1111-4111-8111-111111111111",
  origin: "https://claude.ai"
} });
runtime.load("content/markdown-converter.js");
runtime.load("content/providers/claude-data.js");

const org = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
const firstUrl = `https://claude.ai/api/${org}/files/${firstId}/preview`;
const firstFile = { uuid: firstId, file_name: "first.png", file_kind: "image", preview_url: firstUrl };
const secondFile = {
  file_uuid: secondId, file_name: "second.png", file_kind: "image",
  preview_asset: { url: `/api/${org}/files/${secondId}/preview` }
};
const image = (file_uuid) => ({ type: "image", file_uuid });
const text = (text) => ({ type: "text", text });

function render(messages, downloadImages = false, includeToolActivity = false) {
  const imageCollector = [];
  const converter = runtime.ns.createMarkdownConverter({ downloadImages, includeToolActivity, imageFolder: "assets", imageCollector });
  const markdown = runtime.ns.claudeData.renderTurnDescriptor({ messages }, converter);
  return { markdown, images: imageCollector };
}

// Normal chat API: one image is described both in content and in files.
const messages = [{ content: [image(firstId), text("Describe this screenshot.")], files: [firstFile] }];
const linked = render(messages);
assert.equal(linked.markdown, `![first.png](<${firstUrl}>)\n\nDescribe this screenshot.`);
assert.doesNotMatch(linked.markdown, /unresolved|Attachment/);
const bundled = render(messages, true);
assert.equal(bundled.markdown, "![first.png](<assets/image-001>)\n\nDescribe this screenshot.");
assert.equal(bundled.images.length, 1);
assert.equal(bundled.images[0].url, firstUrl);

// Preserve content order even if the files metadata is in the opposite order.
const multiple = render([{
  content: [image(firstId), text("Between the images."), image(secondId)],
  files: [secondFile, firstFile]
}], true);
assert.equal(multiple.images.length, 2);
assert.equal(multiple.images[0].alt, "first.png");
assert.equal(multiple.images[1].alt, "second.png");
assert.ok(multiple.markdown.indexOf("image-001") < multiple.markdown.indexOf("Between the images."));
assert.ok(multiple.markdown.indexOf("Between the images.") < multiple.markdown.indexOf("image-002"));

// Preview URLs also identify a file when the metadata omits its UUID field.
const { uuid, ...withoutId } = firstFile;
const previewOnly = render([{ content: [image(firstId)], files: [withoutId] }], true);
assert.equal(previewOnly.images.length, 1);
assert.doesNotMatch(previewOnly.markdown, /unresolved/);
const idField = render([{ content: [image(firstId)], files: [{ ...firstFile, uuid: undefined, id: firstId }] }], true);
assert.equal(idField.images.length, 1);

// Explicit image URLs and alternate file previews must not create extra assets.
const explicit = render([{ content: [{ type: "image", url: firstUrl }], files: [firstFile] }], true);
assert.equal(explicit.images.length, 1);
const alternate = render([{
  content: [{ type: "image", file_uuid: firstId, url: "https://example.org/original.png" }], files: [firstFile]
}], true);
assert.equal(alternate.images.length, 1);
assert.equal(alternate.images[0].url, "https://example.org/original.png");

// The same resolution applies to tool output, not just top-level user images.
const nested = render([{
  content: [{ type: "tool_result", content: [text("Generated screenshot."), image(firstId)] }],
  files: [firstFile]
}], true, true);
assert.equal(nested.images.length, 1);
assert.match(nested.markdown, /Claude Tool Result/);
assert.doesNotMatch(nested.markdown, /unresolved|<details open/);

// Display media is independent of the raw result's shape and the activity flag.
for (const includeToolActivity of [false, true]) {
  const originalUrl = "https://example.org/original-tool-image.png";
  const aliases = render([{
    content: [{ type: "tool_result", content: [{ ...image(firstId), url: originalUrl }],
      display_content: { content: [image(firstId), { type: "image", url: firstUrl }] } }],
    files: [firstFile]
  }], true, includeToolActivity);
  assert.equal(aliases.images.length, 1, "UUID aliases deduplicate original and preview URLs");
  assert.equal(aliases.images[0].url, originalUrl);
  assert.equal((aliases.markdown.match(/!\[/g) || []).length, 1);
  for (const content of ["raw-result-text", [text("raw-result-text")], [text("raw-result-text"), image(firstId)]]) {
    const displayed = render([{
      content: [{ type: "tool_result", content,
        display_content: { content: [{ type: "image", url: firstUrl }, { type: "image", url: firstUrl }] } }],
      files: [firstFile]
    }], true, includeToolActivity);
    assert.equal(displayed.images.length, 1, "raw/display/files representations share one asset");
    assert.equal((displayed.markdown.match(/!\[/g) || []).length, 1);
    assert.match(displayed.markdown, /assets\/image-001/);
    if (includeToolActivity) assert.match(displayed.markdown, /raw-result-text/);
    else assert.doesNotMatch(displayed.markdown, /raw-result-text/);
    const linkedDisplay = render([{
      content: [{ type: "tool_result", content, display_content: { content: [{ type: "image", url: firstUrl }] } }],
      files: [firstFile]
    }], false, includeToolActivity);
    assert.match(linkedDisplay.markdown, /!\[.*\]\(<https:\/\/claude.ai\/api\//);
  }
}

// Do not guess a match for an unknown UUID or hide genuinely unavailable media.
const unmatched = render([{ content: [image(secondId)], files: [firstFile] }], true);
assert.match(unmatched.markdown, /Claude image \(unresolved\)/);
assert.match(unmatched.markdown, new RegExp(secondId));
assert.equal(unmatched.images.length, 1);
assert.equal(unmatched.images[0].url, firstUrl);
const unavailable = render([{ content: [image(firstId)], files: [{ uuid: firstId, file_name: "missing.png" }] }]);
assert.match(unavailable.markdown, /Claude image \(unresolved\)/);
assert.match(unavailable.markdown, /Attachment:\*\* missing.png/);

// Files-only payloads still work; duplicate metadata is not distinct content.
const legacy = render([{ content: [text("Prompt")], files: [firstFile, { ...firstFile }, secondFile] }], true);
assert.equal(legacy.images.length, 2);

// Explicit repeated content, including across messages, must remain intact.
const repeated = render([
  { content: [image(firstId), image(firstId)], files: [firstFile] },
  { content: [image(firstId)], files: [firstFile] }
], true);
assert.equal(repeated.images.length, 3);
assert.equal((repeated.markdown.match(/!\[/g) || []).length, 3);

console.log("claude image resolution tests passed");
