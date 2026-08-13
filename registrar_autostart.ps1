$startup = [Environment]::GetFolderPath('Startup')
$target = Join-Path $startup "CMIP_Servidor.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($target)
$sc.TargetPath = "wscript.exe"
$sc.Arguments = "`"C:\Users\Hermani\Downloads\cmipservidor\iniciar_silencioso.vbs`""
$sc.WorkingDirectory = "C:\Users\Hermani\Downloads\cmipservidor"
$sc.Description = "Servidor CMIP Autostart"
$sc.Save()
Write-Host "✅ Atalho do CMIP criado com sucesso na pasta de Inicializacao do Windows!"
