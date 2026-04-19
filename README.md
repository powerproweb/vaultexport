# VaultExport — AI Chat Exporter

**Export ChatGPT and Claude conversations to Markdown, JSON, DOCX, HTML, CSV, and more.**
100% local. No cloud. No subscriptions. RecallOS-ready.

---

## Features

- **Multi-platform** — ChatGPT and Claude in one extension. Gemini support planned.
- **6 export formats** — Markdown `.md`, JSON `.json`, Word `.docx`, HTML `.html`, Plain Text `.txt`, CSV `.csv`
- **RecallOS Mode** — One click organizes exports into `recallos/<platform>/` subfolders for direct `recallos ingest`
- **Bulk Export** — Browse all conversations, search/filter, select any subset, download as a single ZIP
- **Fidelity** — Preserves code blocks, tables, timestamps, model info, Claude Thinking blocks, and Claude Artifacts
- **Injected Export Button** — Appears directly in the ChatGPT and Claude UI
- **Progress Tracking** — Live progress bar for bulk exports
- **100% Local** — All processing happens in your browser. No data sent anywhere.

---

## Quick Install (No Build Required)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `11_vaultexport/` folder
6. The VaultExport icon appears in your toolbar

**For Claude:** Open the extension Options (⚙️) and paste your Claude Organization ID.
- Go to `https://claude.ai/settings/account`
- Find your Organization ID (UUID format)
- Paste it into VaultExport Options → Save

---

## Usage

### Export Current Conversation
1. Open any conversation on chatgpt.com or claude.ai
2. Click the VaultExport icon in your browser toolbar
3. Select your format
4. Toggle **RecallOS Mode** if you want organized output
5. Click **Export Conversation**

### Bulk Export
1. Open a ChatGPT or Claude page
2. Click the popup → **Browse & Bulk Export →**
3. Search/filter conversations
4. Check the ones you want (or **Select All**)
5. Choose format and click **Export Selected (ZIP)**

### RecallOS Integration
```bash
# After exporting with RecallOS Mode ON, your Downloads folder contains:
# recallos/chatgpt/My_Conversation.md
# recallos/claude/Another_Chat.md

# Run this to ingest everything into RecallOS:
recallos ingest ~/Downloads/recallos/ --mode convos
```

---

## Supported Platforms

| Platform | Single Export | Bulk Export | Thinking Blocks | Artifacts |
|----------|:---:|:---:|:---:|:---:|
| ChatGPT  | ✅ | ✅ | — | — |
| Claude   | ✅ | ✅ | ✅ | ✅ |
| Gemini   | 🔜 | 🔜 | — | — |

---

## Export Formats

| Format | Extension | Best For |
|--------|-----------|----------|
| Markdown | `.md` | RecallOS ingest, Obsidian, version control |
| JSON | `.json` | Full structured data, programmatic use |
| Word | `.docx` | Sharing with non-technical users |
| HTML | `.html` | Self-contained archive, beautiful viewing |
| Text | `.txt` | Universal plain text |
| CSV | `.csv` | Analysis in Excel / Google Sheets |

> Note: DOCX is not available in bulk export (use for single conversations only).

---

## Markdown Output (RecallOS-Ready)

```markdown
---
title: "My ChatGPT Session"
platform: chatgpt
model: gpt-4o
url: "https://chatgpt.com/c/..."
exported_at: "2026-04-19T..."
recallos_ingest: true
---

# My ChatGPT Session

## Human
*4/19/2026, 10:30:00 AM*

What is RecallOS?

## Assistant (gpt-4o)
*4/19/2026, 10:30:05 AM*

RecallOS is a local AI memory system...

---
```

---

## Project Structure

```
11_vaultexport/
├── manifest.json          ← MV3 extension manifest
├── background.js          ← Service worker (all API calls, formatting, downloads)
├── content.js             ← Injected into ChatGPT/Claude pages
├── content.css            ← Export button + toast styles
├── popup.html/js/css      ← Main popup UI
├── options.html/js        ← Settings (Claude Org ID, preferences)
├── browse.html/js         ← Bulk export UI
├── lib/
│   ├── jszip.min.js       ← ZIP generation (JSZip 3.10.1)
│   └── docx.iife.js       ← DOCX generation (docx.js 9.6.1)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── generate_icons.py      ← Icon generator (run once)
```

---

## Privacy

- Zero telemetry, zero analytics, zero external requests
- All API calls use your existing browser session (`credentials: 'include'`)
- Your conversations never leave your machine
- Claude Org ID stored only in `chrome.storage.local` (your device only)
- Open source — audit every line

---

## Chrome Web Store Publishing

To package for the Chrome Web Store:

```powershell
# From the 11_vaultexport directory
Compress-Archive -Path * -DestinationPath ..\vaultexport_v1.0.0.zip -Force
```

Then submit at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).

Required assets for store listing:
- Screenshots (1280×800): popup, browse page, exported file preview
- Promo tile (440×280)
- Detailed description (use Features section above)

---

## Roadmap

- [ ] Gemini support
- [ ] Perplexity support
- [ ] Incremental export (only new since last export)
- [ ] Direct RecallOS MCP push (trigger `recallos ingest` via MCP)
- [ ] Firefox / Edge packaging

---

## License

MIT

---

*Built by VaultExport contributors. Not affiliated with OpenAI or Anthropic.*
