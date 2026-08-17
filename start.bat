@echo off
REM start.bat — double-click launcher (delegates to start.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
