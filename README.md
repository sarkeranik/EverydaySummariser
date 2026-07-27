# Everyday Summariser

<img src="https://media1.tenor.com/m/yURfo_oem5cAAAAd/business-productive.gif" width="833" height="466.47999999999996" alt="a penguin wearing a top hat and carrying a briefcase is being productive ." fetchpriority="high" style="max-width: 833px;">

## The Story

Every day, we consume massive amounts of digital information—reading articles, watching videos, conducting research, and scrolling through social media. Yet, keeping track of what we actually learned or saw remains tedious and time-consuming. We realized we needed a completely frictionless way to capture our daily digital footprint and automatically synthesize it into a clean, searchable journal, all without interrupting our actual workflow. 

To solve this, I built **Everyday Summariser**. It's a Chrome extension that silently and privately records the text, images, and audio you interact with as you browse, securely passing this data to a local Python backend. At the end of the day, a single click triggers an AI model—like Google's Gemini, LM Studio, or Ollama—to process all that scattered data. 

The end result is a beautifully formatted, private Markdown journal generated right on your machine every single day, effectively acting as a perfect second brain for your web browsing.

## Features

### 🎯 Smart Content Capture
- **Readability-Based Extraction**: Uses Mozilla's Readability.js to cleanly extract article text, stripping out ads, navigation, and other noise. Falls back to DOM heuristics and raw text when needed.
- **Image Context**: Captures source URLs of significant images (filters out tiny tracking pixels and icons).
- **Audio Capture**: Automatically records audio from tabs that are playing sound.
- **YouTube Transcripts**: Automatically pulls captions/transcripts from YouTube videos using the built-in timedtext API.
- **PDF Extraction**: Captures text from PDFs opened in Chrome using pdf.js.
- **Twitter/X Threads**: Extracts full thread text from Twitter/X status pages.
- **Domain Blocklist**: Configure domains to exclude from capture (banking, email, etc.).

### 🤖 AI-Powered Summaries
- **Categorized Daily Journals**: AI groups your browsing by topic (Research, Entertainment, News, etc.) with relevant emoji.
- **Key Takeaways**: Extracts the most important learnings and facts from each page.
- **Time-Based Sections**: Organizes content by Morning / Afternoon / Evening based on timestamps.
- **Mood & Productivity Analysis**: AI infers focus areas and productivity with a focus score.
- **Weekly & Monthly Rollups**: Auto-scheduled (Sunday & 1st of month) summaries, plus manual generation anytime.

### 🔍 Search & Organize
- **Full-Text Search**: SQLite FTS5-powered search across all captured text, YouTube transcripts, PDFs, Twitter threads, and generated notes.
- **Tag System**: Create colored tags and tag specific pages for easy recall.
- **Journal Timeline**: Browse past daily, weekly, and monthly notes with full markdown rendering.
- **Raw Data Browser**: Explore all captured content with pagination and filtering.

### 🎮 Retro 8-bit Pixel Art UI
- **Full-Tab Dashboard**: The primary experience with journal timeline, search, raw data browser, tags, generate controls, and settings. Styled with NES-inspired pixel art aesthetics.
- **Side Panel**: Lightweight companion showing today's stats and quick actions.
- **Popup**: Quick-status hub with stats, generate button, and dashboard/sidepanel launchers.
- **Dark & Light Themes**: Both in retro pixel art style with CRT scanline overlay.
- **Onboarding Wizard**: First-run multi-step setup for backend, AI, and privacy configuration.

### 💾 Local & Private
- All captured data is stored in a local SQLite database (`journal.db`).
- All processing happens on your machine—no data is ever sent to third parties.
- Generated notes are saved as Markdown files in `backend/daily_notes/`.

## Repository Structure

- `backend/`: The FastAPI Python application that handles data storage and AI generation.
- `extension/`: The Manifest V3 Chrome Extension source code.

## Setup Instructions

### 1. Backend Setup (Docker - Recommended)

The simplest way to run the backend is using Docker and Docker Compose. This ensures you don't need to install Python directly on your system.

1. Ensure you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.
2. In the `backend/` folder, copy `.env.example` to `.env` and configure your AI provider (see "AI Configuration" below).
3. Open a terminal in the root of the project (where `docker-compose.yml` is) and run:
   ```bash
   docker-compose up -d
   ```
This will build and start the server in the background. To stop it, run `docker-compose down`. All data (database, audio, notes) will persist safely in your local `backend/` folder.

### 1B. Backend Setup (1-Click Start without Docker)

If you don't want to use Docker, we've provided scripts to automatically set up a local Python environment, install dependencies, and start the server:

- **Windows**: Double-click `start_windows.bat` in the project root.
- **macOS / Linux**: Run `./start_mac.sh` in your terminal.

*On the very first run, this script will create a default `.env` file in the `backend/` folder. You can configure your AI provider either in `backend/.env` or directly inside the Chrome Extension's Onboarding Wizard / Settings page.*

#### AI Configuration (in `backend/.env`)

- **For Gemini**:
  ```env
  AI_PROVIDER=gemini
  GEMINI_API_KEY=your_gemini_api_key_here
  ```
- **For Local AI (LM Studio or Ollama)**:
  ```env
  AI_PROVIDER=local
  # LM Studio default: http://localhost:1234/v1
  # Ollama default: http://localhost:11434/v1
  LOCAL_AI_ENDPOINT=http://localhost:1234/v1
  LOCAL_MODEL_NAME=your_model_name
  ```

### 2. Chrome Extension Setup

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `extension/` directory from this repository.
4. The onboarding wizard will open on first install to guide you through setup.

## Usage

1. Ensure the Python backend is running (`uvicorn main:app`).
2. Browse the web normally. The extension will silently capture data to your local SQLite database.
3. **Quick access**: Click the extension icon for a popup with today's stats and quick actions.
4. **Generate notes**: Click **Generate Daily Note** from the popup, side panel, or full dashboard.
5. **Dashboard**: Click **📊 Dashboard** from the popup to open the full retro pixel art dashboard with journal timeline, search, tags, raw data browser, and settings.
6. **Side Panel**: Use Chrome's side panel for a lightweight companion view alongside your browsing.
7. Your notes are saved as Markdown files in `backend/daily_notes/`.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/stats` | GET | Today's capture counts |
| `/api/text` | POST | Save captured page text |
| `/api/images` | POST | Save captured image URLs |
| `/api/audio` | POST | Save captured audio file |
| `/api/youtube` | POST | Save YouTube transcript |
| `/api/pdf` | POST | Save extracted PDF text |
| `/api/twitter` | POST | Save Twitter thread text |
| `/api/search?q=...` | GET | Full-text search |
| `/api/notes` | GET | List all generated notes |
| `/api/notes/{date}` | GET | Get a specific note |
| `/api/tags` | GET/POST | List/create tags |
| `/api/tag-page` | POST | Tag a page |
| `/api/tagged-pages` | GET | Get tagged pages |
| `/api/settings` | GET/PUT | Get/update settings |
| `/api/captured` | GET | Browse raw captured data |
| `/api/generate-daily-note` | POST | Generate daily note |
| `/api/generate-weekly-note` | POST | Generate weekly rollup |
| `/api/generate-monthly-note` | POST | Generate monthly rollup |
| `/api/clear-today` | POST | Clear today's data |
