@echo off
echo ===================================================
echo   Everyday Summariser - Windows Setup ^& Start
echo ===================================================
echo.

cd backend

if not exist .env (
    echo [INFO] Creating default .env file from .env.example...
    copy .env.example .env
    echo Please remember to edit backend\.env with your API keys later!
)

if not exist venv (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
)

echo [INFO] Activating virtual environment...
call venv\Scripts\activate

echo [INFO] Installing dependencies...
pip install -r requirements.txt

echo.
echo [INFO] Starting the FastAPI server...
echo.
uvicorn main:app --reload
pause
