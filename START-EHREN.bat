@echo off
title EHREN
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js is required. Install the LTS version from https://nodejs.org then run this again. & pause & exit /b)
if not exist node_modules (
  echo First launch: installing EHREN components, this takes a minute...
  call npm install
)
call npm start
