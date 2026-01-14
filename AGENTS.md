# AGENTS

## Project Overview
- Chrome extension that posts Markdown outputs from ChatGPT/Claude/Gemini to WordPress.
- Content script detects code blocks; background service worker handles WordPress API posting.

## Tech Stack
- Chrome Extension (Manifest V3)
- marked.js, js-yaml
- WordPress REST API (Basic Auth + Application Password)

## Project Structure
- `manifest.json`: extension manifest
- `content/`: code block detection and in-page UI
- `background/`: WordPress API and posting workflow
- `popup/`: settings UI
- `libs/`: bundled libraries
- `setup-guide/`: setup guide
- `wp-plugin/`: auth helper plugin
- `docs/`: requirements/design doc (filename is in Japanese)

## Commands
- No standard build/test scripts. Follow docs for manual packaging and checks.

## Important Notes
- Keep parsing rules aligned with the requirements doc in `docs/`.
- Route network calls through the background service worker, not content scripts.
- Handle DOM differences across ChatGPT/Claude/Gemini when detecting blocks.

## Documentation
- `docs/`
