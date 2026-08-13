@echo off
title Servidor CMIP - Chamada de Pacientes
cd /d "%~dp0"
echo ====================================================
echo 🏥 Iniciando Servidor CMIP...
echo ====================================================
node server.js
pause
