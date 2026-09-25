@echo off
rem Fibre Guardian : double-cliquez sur ce fichier pour lancer l'application.
cd /d "%~dp0"
set PORT=8000
set URL=http://localhost:%PORT%
echo.
echo  Fibre Guardian demarre sur %URL%
echo  Laissez cette fenetre ouverte. Fermez-la pour arreter.
echo.

rem Ouvre le navigateur 2 s apres, le temps que le serveur demarre.
start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process '%URL%'"

where node >nul 2>nul
if %errorlevel%==0 (
  node server\server.mjs
  goto fin
)

python -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto fin
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outils\serveur.ps1" -Port %PORT%

:fin
pause
