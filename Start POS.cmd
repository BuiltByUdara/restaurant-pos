@echo off
cd /d "%~dp0"
if not exist .env (
  echo Run npm install and npm run setup first. See README.md.
  pause
  exit /b 1
)
call npm run dev
if errorlevel 1 pause
