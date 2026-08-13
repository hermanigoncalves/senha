@echo off
title Remover CMIP do Autostart do Windows
cd /d "%~dp0"
echo Removendo a inicializacao automatica do CMIP...

powershell -Command "$startup = [Environment]::GetFolderPath('Startup'); $link = Join-Path $startup 'CMIP_Servidor.lnk'; if (Test-Path $link) { Remove-Item $link -Force; Write-Host '✅ Atalho removido com sucesso!' } else { Write-Host 'ℹ️ Atalho nao encontrado.' }"

echo ====================================================
echo Concluido.
echo ====================================================
pause
