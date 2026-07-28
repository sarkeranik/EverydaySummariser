#!/bin/bash
echo "==================================================="
echo "  Everyday Summariser - macOS / Linux Setup & Start"
echo "==================================================="
echo ""

echo "Which AI Provider do you want to use for this session?"
echo "1) Local AI (Ollama - Qwen2.5 3B)"
echo "2) Cloud AI (Gemini)"
read -p "Enter your choice (1 or 2): " ai_choice

if [ "$ai_choice" == "1" ]; then
    export AI_PROVIDER=local
    echo ""
    echo "[INFO] Checking for Ollama..."
    if ! command -v ollama &> /dev/null
    then
        echo ""
        echo "====================================================================="
        echo "[ERROR] Ollama is not installed!"
        echo "We need Ollama to run the local AI model."
        echo "Please download and install Ollama from: https://ollama.com/download"
        echo "After installing, run this script again."
        echo "====================================================================="
        echo ""
        exit 1
    fi

    echo "[INFO] Pulling the Qwen2.5 3B model (this may take a while the first time)..."
    ollama pull qwen2.5:3b
else
    export AI_PROVIDER=gemini
    echo ""
    echo "[INFO] Starting with Cloud AI (Gemini). Ensure your GEMINI_API_KEY is set in backend/.env."
fi

cd backend

if [ ! -f .env ]; then
    echo "[INFO] Creating default .env file from .env.example..."
    cp .env.example .env
    echo "Please remember to edit backend/.env with your API keys later!"
fi

if [ ! -d "venv" ]; then
    echo "[INFO] Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "[INFO] Activating virtual environment..."
source venv/bin/activate

echo "[INFO] Installing dependencies..."
pip install -r requirements.txt

echo ""
echo "[INFO] Starting the FastAPI server..."
echo ""
uvicorn main:app --reload
