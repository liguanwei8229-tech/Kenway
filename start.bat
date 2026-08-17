@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)
echo 正在启动 AI 选题雷达…
echo 浏览器访问 http://localhost:8787
node server.js
pause
