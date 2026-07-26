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

### 1. Backend Setup (FastAPI)

1. Navigate to the `backend/` folder.
2. Copy `.env.example` to a new file named `.env` and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```
4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
5. Run the server:
   ```bash
   uvicorn main:app --reload
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
