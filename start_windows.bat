@echo off
setlocal enabledelayedexpansion
title Everyday Summariser - Setup ^& Start

echo.
echo =====================================================================
echo    Everyday Summariser - Windows Setup ^& Start
echo =====================================================================
echo.

:: =====================================================================
:: STEP 1: Check Python
:: =====================================================================
:check_python
where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo =====================================================================
    echo  [ERROR] Python is not installed or not in your PATH!
    echo.
    echo  HOW TO FIX:
    echo    1. Download Python from: https://www.python.org/downloads/
    echo    2. Run the installer - CHECK the box "Add Python to PATH"
    echo    3. Finish the install, then press Enter below to retry
    echo =====================================================================
    echo.
    pause
    goto check_python
)
for /f "delims=" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  [OK] %PY_VER% found.
echo.

:: =====================================================================
:: STEP 2: Choose AI Provider
:: =====================================================================
:choose_provider
echo  Which AI Provider do you want to use for this session?
echo    1) Local AI  (Ollama)  - runs 100%% offline
echo    2) Cloud AI  (Gemini)  - requires internet ^& API key
echo.
set /p ai_choice="  Enter your choice (1 or 2): "
echo.

if "%ai_choice%"=="1" goto setup_local
if "%ai_choice%"=="2" goto setup_gemini

echo  [ERROR] Invalid choice. Please type 1 or 2.
echo.
goto choose_provider

:: =====================================================================
:: LOCAL AI SETUP
:: =====================================================================
:setup_local
set AI_PROVIDER=local
echo  [INFO] Local AI (Ollama) selected.
echo.

:: --- Check Ollama binary ---
:check_ollama_installed
where ollama >nul 2>nul
if errorlevel 1 (
    echo =====================================================================
    echo  [ERROR] Ollama is not installed!
    echo.
    echo  HOW TO FIX:
    echo    1. Go to: https://ollama.com/download
    echo    2. Download and run the Windows installer
    echo    3. After installing, press Enter below to retry
    echo =====================================================================
    echo.
    pause
    goto check_ollama_installed
)
echo  [OK] Ollama is installed.

:: =====================================================================
:: STEP 3: Check Ollama service + Choose a Model
:: =====================================================================
:choose_model
echo  [INFO] Checking Ollama service and fetching installed models...
echo.

:: --- Fast HTTP ping: check if Ollama API is reachable (avoids blocking hang) ---
set OLLAMA_RUNNING=0
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:11434' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set OLLAMA_RUNNING=1

if !OLLAMA_RUNNING!==0 (
    echo =====================================================================
    echo  [INFO] Ollama service is not running. Starting it automatically...
    echo =====================================================================
    echo.
    start "Ollama Server" cmd /k "ollama serve"
    echo  [INFO] Waiting for Ollama to initialise (5 seconds^)...
    timeout /t 5 /nobreak >nul
    echo  [INFO] Retrying...
    echo.
    goto choose_model
)

:: Ollama is running — fetch model list
set MODEL_COUNT=0
for /f "skip=1 tokens=1" %%m in ('ollama list 2^>nul') do (
    set /a MODEL_COUNT+=1
    set MODEL_!MODEL_COUNT!=%%m
)

:: If MODEL_COUNT is still 0, service is up but no models installed.
if !MODEL_COUNT!==0 (
    :: Service is up but no models installed — show curated download menu
    echo =====================================================================
    echo  [INFO] Ollama is running but no models are installed yet!
    echo.
    echo  Please choose a model to download:
    echo.
    echo    1^)  qwen2.5:3b         ^<-- Recommended: fast, great for summarisation (~2 GB^)
    echo    2^)  qwen3:8b-q4_K_M        Larger Qwen3 with stronger reasoning     (~5 GB^)
    echo.
    echo =====================================================================
    echo.
    set /p pull_choice="  Enter your choice (1 or 2): "
    echo.

    if "!pull_choice!"=="1" set PULL_MODEL=qwen2.5:3b
    if "!pull_choice!"=="2" set PULL_MODEL=qwen3:8b-q4_K_M

    if not defined PULL_MODEL (
        echo  [ERROR] Invalid choice. Please enter 1 or 2.
        echo.
        goto choose_model
    )

    echo  [INFO] Downloading !PULL_MODEL! — this may take several minutes...
    echo  [INFO] A new window will open showing download progress.
    echo  [INFO] This window will continue automatically when the download is done.
    echo.
    start /wait "Downloading !PULL_MODEL!" cmd /c "ollama pull !PULL_MODEL!"
    set PULL_MODEL=
    echo  [INFO] Download complete. Refreshing model list...
    echo.
    goto choose_model
)

:: Display the dynamic numbered menu
echo  Models installed in Ollama:
echo  ---------------------------------------------------------------
for /l %%i in (1,1,%MODEL_COUNT%) do (
    echo   %%i^)  !MODEL_%%i!
)
echo  ---------------------------------------------------------------
echo.
set /p model_choice="  Enter your choice (1-%MODEL_COUNT%): "
echo.

:: Validate: must be a number between 1 and MODEL_COUNT
set VALID_CHOICE=0
for /l %%i in (1,1,%MODEL_COUNT%) do (
    if "%model_choice%"=="%%i" set VALID_CHOICE=%%i
)

if !VALID_CHOICE!==0 (
    echo  [ERROR] Invalid choice. Please enter a number between 1 and %MODEL_COUNT%.
    echo.
    goto choose_model
)

:: Set chosen model from dynamic variable
set CHOSEN_MODEL=!MODEL_%model_choice%!
echo  [INFO] You selected: !CHOSEN_MODEL!
echo  [OK] Model is installed and ready.
echo.

:model_ready
echo.
goto setup_backend

:: =====================================================================
:: GEMINI CLOUD AI SETUP
:: =====================================================================
:setup_gemini
set AI_PROVIDER=gemini
echo  [INFO] Cloud AI (Gemini) selected.
echo.

:: Make sure we are in the backend dir so we can read .env
cd /d "%~dp0backend"

:: Create .env from example if it doesn't exist
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo  [INFO] Created backend\.env from .env.example
    ) else (
        echo  [WARNING] No .env or .env.example found. A blank .env will be created.
        echo. > .env
    )
)

:: --- Check Gemini API key is set ---
:check_gemini_key
set GEMINI_KEY_VAL=
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="GEMINI_API_KEY" set GEMINI_KEY_VAL=%%b
)

if "!GEMINI_KEY_VAL!"=="" goto gemini_key_bad
if "!GEMINI_KEY_VAL!"=="your_gemini_api_key_here" goto gemini_key_bad
goto gemini_key_found

:gemini_key_bad
echo =====================================================================
echo  [ERROR] Gemini API key is not set in backend\.env!
echo.
echo  HOW TO FIX:
echo    1. Get a free API key at: https://aistudio.google.com/app/apikey
echo    2. Open the file:  %~dp0backend\.env
echo    3. Find the line:  GEMINI_API_KEY=your_gemini_api_key_here
echo    4. Replace "your_gemini_api_key_here" with your real API key
echo    5. Save the file, then press Enter below to retry
echo =====================================================================
echo.
pause
goto check_gemini_key

:gemini_key_found
echo  [OK] Gemini API key found in .env.
echo.

:: Flag to run Gemini test after venv is ready
set NEEDS_GEMINI_TEST=1
goto setup_backend

:: =====================================================================
:: BACKEND: .env update + venv + pip install
:: =====================================================================
:setup_backend
if not defined NEEDS_GEMINI_TEST set NEEDS_GEMINI_TEST=0

:: Go to backend dir (idempotent)
cd /d "%~dp0backend"

:: Ensure .env exists for the local path
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo  [INFO] Created backend\.env from .env.example
    )
)

:: Update AI_PROVIDER in .env
powershell -NoProfile -Command "(Get-Content '.env') -replace '^AI_PROVIDER=.*', 'AI_PROVIDER=%AI_PROVIDER%' | Set-Content '.env'" >nul 2>nul

:: Update LOCAL_MODEL_NAME in .env when using local provider
if "%AI_PROVIDER%"=="local" (
    powershell -NoProfile -Command "(Get-Content '.env') -replace '^LOCAL_MODEL_NAME=.*', 'LOCAL_MODEL_NAME=!CHOSEN_MODEL!' | Set-Content '.env'" >nul 2>nul
    echo  [INFO] Set LOCAL_MODEL_NAME=!CHOSEN_MODEL! in backend\.env
    echo.
)

:: --- Create venv ---
:create_venv
if not exist venv (
    echo  [INFO] Creating Python virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo.
        echo =====================================================================
        echo  [ERROR] Failed to create the Python virtual environment!
        echo.
        echo  HOW TO FIX:
        echo    1. Make sure Python was installed correctly (with the venv module)
        echo    2. Reinstall Python from: https://www.python.org/downloads/
        echo    3. CHECK "Add Python to PATH" during install
        echo    4. Press Enter below to retry
        echo =====================================================================
        echo.
        pause
        goto create_venv
    )
)
echo  [OK] Virtual environment ready.

:: --- Activate venv ---
call venv\Scripts\activate
if errorlevel 1 (
    echo.
    echo  [ERROR] Could not activate venv. Deleting and recreating it...
    rmdir /s /q venv
    goto create_venv
)
echo  [INFO] Virtual environment activated.

:: --- Install dependencies ---
:install_deps
echo  [INFO] Installing Python dependencies (this may take a minute)...
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo =====================================================================
    echo  [ERROR] Failed to install Python dependencies!
    echo.
    echo  HOW TO FIX:
    echo    1. Check your internet connection
    echo    2. Try upgrading pip:  python -m pip install --upgrade pip
    echo    3. Press Enter below to retry
    echo =====================================================================
    echo.
    pause
    goto install_deps
)
echo  [OK] All dependencies installed.
echo.

:: Gemini live API test (only for Gemini path)
if "%NEEDS_GEMINI_TEST%"=="1" goto test_gemini_api
goto start_server

:: =====================================================================
:: GEMINI API LIVE TEST
:: =====================================================================
:test_gemini_api
echo  [INFO] Testing Gemini API connection (sending a test request)...
python -c "import os; from dotenv import load_dotenv; load_dotenv(); import google.generativeai as g; g.configure(api_key=os.getenv('GEMINI_API_KEY')); r=g.GenerativeModel('gemini-1.5-flash').generate_content('Reply with the single word OK'); print('[OK] Gemini responded:', r.text.strip())" 2>"%TEMP%\es_gemini_err.txt"

if errorlevel 1 (
    del "%TEMP%\es_gemini_err.txt" >nul 2>nul
    echo.
    echo =====================================================================
    echo  [ERROR] Gemini API test FAILED!
    echo.
    echo  HOW TO FIX:
    echo    1. Verify your API key is correct in backend\.env
    echo    2. Make sure your key has not expired or been revoked
    echo    3. Check your internet connection
    echo    4. Generate a fresh key at: https://aistudio.google.com/app/apikey
    echo    5. Save the updated key in backend\.env, then press Enter to retry
    echo =====================================================================
    echo.
    pause
    goto check_gemini_key
)
del "%TEMP%\es_gemini_err.txt" >nul 2>nul

:: =====================================================================
:: START SERVER
:: =====================================================================
:start_server
echo.
echo =====================================================================
echo  [ALL CHECKS PASSED] Starting the FastAPI server...
if "%AI_PROVIDER%"=="local" (
    echo  Provider : Local AI (Ollama)
    echo  Model    : !CHOSEN_MODEL!
) else (
    echo  Provider : Cloud AI (Gemini)
)
echo  Press Ctrl+C to stop the server.
echo =====================================================================
echo.
uvicorn main:app --reload

echo.
echo  [INFO] Server has stopped.
pause
