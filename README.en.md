<div align="center">
  <img src="logos/icon128.png" alt="OdysSeek logo" width="112" height="112">

  # OdysSeek

  **Academic research tools for your browser.**

  Chrome extension · Manifest V3 · JavaScript, HTML, CSS

  **Version:** `3.4.3` · **Status:** in development / pre-release testing

  [Español](README.md) · [Architecture](docs/ARQUITECTURA.md) · [Known issues](docs/PROBLEMAS_CONOCIDOS.md)
</div>

OdysSeek is a browser extension for highlighting text, collecting citations, saving contextual notes and resources, filtering Google Scholar results, and exploring PDFs with a bundled PDF.js viewer.

## Features

- Web-page search, customizable highlighting and match navigation.
- Google Scholar result filters and sorting (dependent on Scholar's page structure).
- PDF text extraction and **heuristic** paragraph ranking; this is not embedding-based semantic search.
- Citation collection and formatting options (APA, MLA, Chicago and Vancouver). **Always verify metadata and output.**
- Contextual notes, resources, history and trash recovery.
- `.doc` (HTML-based Word-compatible) and bibliography XML exports; not native `.docx` files.
- Optional Gemini or DeepSeek assistance using your own API key, disabled by default.

## Install locally

1. Download or clone the repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Test on a public webpage before trying PDF documents.

The PDF viewer currently has **known loading issues** and is not verified as production-ready. See [known issues](docs/PROBLEMAS_CONOCIDOS.md) (Spanish).

## Build checks

Requires Python 3.10+ and Node.js 22+ for development checks only. No npm installation is needed.

```bash
python3 scripts/validate_repo.py
python3 -m unittest discover -s tests -v
python3 scripts/package_webstore.py
```

The last command produces a Web Store-style ZIP under `dist/`; this is **not** proof of Chrome Web Store approval or runtime compatibility.

## Privacy and permissions

The extension requests `activeTab`, `scripting`, `storage`, `tabs`, `contextMenus`, and `<all_urls>` host access. Notes, citations and preferences are stored locally. When you explicitly use optional AI features, selected metadata and your API key are sent to the chosen provider. API keys are stored locally without additional encryption by OdysSeek.

See the [privacy notice](docs/PRIVACIDAD.md) and [third-party licenses](docs/LICENCIAS_TERCEROS.md).

## License

The owner has not yet selected a license for OdysSeek's original code. Third-party components retain their own licenses, including Apache 2.0 for PDF.js. See [license decision](docs/LICENCIA_PENDIENTE.md).

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md) · Security: [SECURITY.md](SECURITY.md) · Changelog: [CHANGELOG.md](CHANGELOG.md)
