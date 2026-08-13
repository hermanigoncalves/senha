@echo off
title Instalar CMIP no Autostart do Windows
cd /d "%~dp0"
echo Configurando o CMIP para iniciar automaticamente com o Windows...

powershell -ExecutionPolicy Bypass -File "%~dp0registrar_autostart.ps1"

echo ====================================================
echo ✅ CMIP configurado com sucesso para iniciar junto com o Windows!
echo ====================================================
pause
