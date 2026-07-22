# Page to Markdown

[中文说明](./README.zh-CN.md)

A Chrome extension that focuses on API-documentation pages: it extracts the active tab into Markdown, filters common navigation noise, opens a preview page, and downloads the result as a `.md` file.

## Features

- Convert the current `http` or `https` page into Markdown.
- Prioritize API-documentation content and filter common navigation, sidebar, and menu noise.
- Detect Swagger UI, Redoc, Apifox, YApi, Postman Docs, Temu Partner, and TikTok Shop Partner, with a generic fallback.
- Fall back to manual selection when automatic extraction is not precise enough.
- Preserve indentation, spaces, and line breaks in code blocks and infer common languages.
- Treat dotted multi-level parameters such as `aaa.bbb.ccc` as absolute paths, including arrays and Unicode names.
- Edit Markdown beside a sanitized live preview, with copy, autosave, and re-extraction controls.
- Keep concurrent previews isolated with per-export session IDs.
- Download the edited content as a Markdown file.

## Project Structure

- `manifest.json`: Manifest V3 configuration.
- `background.js`: Background workflow coordinator for automatic and manual extraction.
- `content-script.js`: In-page extraction logic, platform detection, and manual selection overlay.
- `popup.html`, `popup.css`, `popup.js`: Extension popup and action triggers.
- `preview.html`, `preview.css`, `preview.js`: Markdown preview and download screen.

## How to Load

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory: `/mnt/d/project/page_to_markdown`.

The unpacked extension works without installing dependencies; runtime preview libraries are committed under `vendor/`. To run tests:

```bash
npm install
npm test
```

## How to Use

1. Open any API documentation page over `http` or `https`.
2. Click the extension icon.
3. Click **Auto Extract API Docs**.
4. If the result still contains navigation noise, use **Select Doc Area Manually** instead and click the actual documentation pane in the page.
5. Review the Markdown in the preview tab.
6. Adjust the file name if needed and click **Download Markdown**.

## Current Limitations

- The extraction still uses heuristics and platform-specific selectors; highly customized documentation portals may need manual selection.
- Platform adapters still depend on rendered DOM and may need fixture updates after platform redesigns.
- Images are referenced by URL only. The extension does not download or embed image assets.
- Browser-internal pages such as `chrome://` are not supported.

## Testing

Run `npm test` for converter, field-path, adapter, storage, preview-security, and content-script integration coverage. See [MANUAL_TEST.md](./MANUAL_TEST.md) for Chrome checks.
