# Chrome Web Store Assets

These listing assets are deliberately excluded from the extension ZIP.

## Required assets

- `promo-small.png`: 440x280 pixels. Generated from `promo-small.svg`; upload the PNG.
- At least one product screenshot at 1280x800 or 640x400 pixels.
- `icons/icon-128.png`: already included in the extension ZIP through `manifest.json`.

## Screenshot checklist

Capture a real, sanitized conversation with no personal, confidential, or copyrighted third-party content. A useful listing set is:

1. The extension popup showing Markdown and image-bundle export options.
2. ChatGPT message-selection checkboxes with the **Select** menu visible.
3. A ChatGPT conversation menu showing the injected **Download** action.
4. A Markdown export beside its source conversation, using synthetic text and images.
5. A Claude conversation and its resulting Markdown export.

Use a fresh demonstration conversation created for the listing. Do not reuse private conversation screenshots from development or crop them in a way that leaves account names, project names, prompts, or attachments visible.

## Regenerating the promotional image

The SVG is the editable source. Render it at exactly 440x280 to `promo-small.png` and verify the dimensions before uploading it to the Developer Dashboard.
