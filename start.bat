@echo off
chcp 65001 >nul
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo 首次运行，正在构建界面...
  call npm run build
)

start "" "%~dp0node_modules\electron\dist\electron.exe" .
