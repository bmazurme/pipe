@echo off
rem Double-click entry point for Windows, no Docker required. See
rem scripts\launch.mjs for what it actually does.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22+ from https://nodejs.org and run this again.
  pause
  exit /b 1
)

node scripts\launch.mjs
pause
