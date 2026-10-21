# Starts a second Analysis Services instance (Power BI Desktop's msmdsrv.exe) in disk mode on port 61000, so that
# Backup/Restore work (Desktop's own instance is diskless). Needs Power BI Desktop to have run once (for its msmdsrv.ini).
if (Get-NetTCPConnection -State Listen -LocalPort 61000 -ErrorAction SilentlyContinue) { 'listening 61000'; return }
$root = 'C:\LinBIAS'
$ini = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces" -Recurse -Filter msmdsrv.ini | Sort LastWriteTime -Desc | Select -First 1
$s = Get-Content $ini.FullName -Raw
$ws = [regex]::Match($s, '<DataDir>(.*?)</DataDir>').Groups[1].Value
$s = $s.Replace($ws, "$root\Data").Replace('<DisklessModeRequested>1<', '<DisklessModeRequested>0<').Replace('<Port>0</Port>', '<Port>61000</Port>')
New-Item -ItemType Directory -Force "$root\Data", "$root\Config" | Out-Null
Set-Content "$root\Config\msmdsrv.ini" $s -Encoding UTF8
$a = New-ScheduledTaskAction -Execute 'C:\Program Files\Microsoft Power BI Desktop\bin\msmdsrv.exe' -Argument "-c -n LinBIAS -s $root\Config"
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName LinBIAS -Action $a -Principal $p -Force | Out-Null
Start-ScheduledTask -TaskName LinBIAS
for ($i = 0; $i -lt 30; $i++) { if (Get-NetTCPConnection -State Listen -LocalPort 61000 -ErrorAction SilentlyContinue) { 'listening 61000'; break }; Start-Sleep 1 }
