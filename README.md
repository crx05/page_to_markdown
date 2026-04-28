# Page to Markdown

[中文说明](./README.zh-CN.md)

A Chrome extension that focuses on API-documentation pages: it extracts the active tab into Markdown, filters common navigation noise, opens a preview page, and downloads the result as a `.md` file.

## Features

- Convert the current `http` or `https` page into Markdown.
- Prioritize API-documentation content and filter common navigation, sidebar, and menu noise.
- Detect common API doc platforms such as Swagger UI and Redoc.
- Fall back to manual selection when automatic extraction is not precise enough.
- Open a preview page where the Markdown can be reviewed and edited.
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
4. Select this directory: `/mnt/d/project/markdown`.

## How to Use

1. Open any API documentation page over `http` or `https`.
2. Click the extension icon.
3. Click **Auto Extract API Docs**.
4. If the result still contains navigation noise, use **Select Doc Area Manually** instead and click the actual documentation pane in the page.
5. Review the Markdown in the preview tab.
6. Adjust the file name if needed and click **Download Markdown**.

## Current Limitations

- The extraction still uses heuristics and platform-specific selectors; highly customized documentation portals may need manual selection.
- Only Swagger UI and Redoc receive targeted platform rules in this version.
- Images are referenced by URL only. The extension does not download or embed image assets.
- Browser-internal pages such as `chrome://` are not supported.

## Suggested Next Steps

- Add more platform adapters for Apifox, YApi, Stoplight, and Postman Docs.
- Replace the built-in extractor with Mozilla Readability where it improves generic fallback.
- Replace the built-in HTML-to-Markdown walker with Turndown.
- Add rendered Markdown preview alongside the editable source.
