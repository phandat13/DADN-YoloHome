@echo off
taskkill /fi "WINDOWTITLE eq YoloHome Backend*" /t /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq YoloHome Gateway*" /t /f >nul 2>nul
echo Da tat YoloHome.
timeout /t 2 >nul
