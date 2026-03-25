@echo off
title DrugsPal Server
cd /d "%~dp0"
echo.
echo  =============================
echo    DrugsPal Server Starting
echo  =============================
echo.
echo  Open your browser and go to:
echo  http://localhost:3000
echo.
echo  Press Ctrl+C to stop the server.
echo.
"C:\Program Files\nodejs\node.exe" server.js
pause
