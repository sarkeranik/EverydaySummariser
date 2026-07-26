# Everyday Summariser

A Chrome extension and local Python backend that act as an automated daily journal. As you browse the web, the extension quietly captures text, images, and audio, storing them locally. At the end of the day, it uses the Gemini AI API to generate a daily summary note.

## Features

- **Automated Text Capture**: Captures the main text of pages you visit.
- **Image Context**: Captures the source URLs of images on the page.
- **Audio Capture**: Automatically records audio from tabs that are playing sound.
- **Local Storage**: All captured data is stored in a local SQLite database (`journal.db`).
- **AI Daily Summary**: Generates a daily Markdown journal summarizing your web activity using Google's Gemini API.

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

If you don't want to use Docker, we've provided scripts to automatically set up a local Python environment, install dependencies, and start the server.

*On the very first run, this script will create a default `.env` file in the `backend/` folder. You will need to stop the server, edit that file with your AI configuration, and start it again.*

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

## Usage

1. Ensure the Python backend is running (`uvicorn main:app`).
2. Browse the web normally. The extension will silently capture data to your local SQLite database.
3. To generate your summary, click the **Everyday Summariser** icon in your Chrome toolbar and click **Generate Daily Note**.
4. Your note will be saved as a Markdown file in `backend/daily_notes/`.
