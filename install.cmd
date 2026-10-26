@echo off
rem zcode-acp installer (Windows): run install.ps1 with execution policy bypassed.
rem cmd.exe decodes batch files in the local ANSI codepage, so keep this file ASCII-only.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
