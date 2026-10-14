@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.21 ou une version compatible plus recente est requis.
  echo Installez Node.js puis relancez ce fichier.
  pause
  exit /b 1
)
echo Ouvrez http://127.0.0.1:8186/codex/ dans votre navigateur.
echo Gardez cette fenetre ouverte. Ctrl+C arrete le serveur.
node codex/serveur-local.cjs
if errorlevel 1 pause
endlocal
