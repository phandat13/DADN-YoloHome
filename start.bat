@echo off
chcp 65001 >nul
title YoloHome
cd /d "%~dp0"

echo ==== YoloHome: khoi dong ====

where node >nul 2>nul || (echo [LOI] Chua cai Node.js - tai tai https://nodejs.org & pause & exit /b 1)
if not exist "Backend\.env" (echo [LOI] Thieu Backend\.env - sao chep tu Backend\.env.example roi dien thong tin & pause & exit /b 1)

if not exist "Backend\node_modules" (
  echo Cai thu vien Backend lan dau...
  pushd Backend & call npm install --omit=dev & popd
)

rem 1. Backend (phuc vu ca API lan giao dien web o cong 3000)
start "YoloHome Backend" cmd /k "cd /d "%~dp0Backend" && npm start"

rem 2. Gateway (chi chay khi da co Gateway\.env)
if not exist "Gateway\.env" goto nogateway
set "PY=python"
if exist "Gateway\.venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if exist "Gateway\.venv\bin\python.exe" set "PY=.venv\bin\python.exe"
start "YoloHome Gateway" cmd /k "cd /d "%~dp0Gateway" && %PY% main.py"
goto gatewaydone
:nogateway
echo [Bo qua] Chua co Gateway\.env nen khong chay Gateway.
:gatewaydone

rem 3. Doi Backend san sang roi mo trinh duyet
echo Dang cho Backend khoi dong...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" && goto open
  timeout /t 1 >nul
)
echo [Canh bao] Backend chua phan hoi sau 30 giay - xem cua so "YoloHome Backend" (MySQL da chay chua?).
:open
start "" http://localhost:3000
echo Da mo http://localhost:3000 . Dong cac cua so "YoloHome ..." de tat he thong.
timeout /t 5 >nul
