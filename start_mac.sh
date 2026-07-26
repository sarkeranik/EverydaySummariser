#!/bin/bash
echo "==================================================="
echo "  Everyday Summariser - macOS / Linux Setup & Start"
echo "==================================================="
echo ""

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
