$asm = [Reflection.Assembly]::LoadFrom('C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll')
$type = $asm.GetTypes() | ? { $_.Name -eq 'AdomdConnection' } | Select -First 1
$port = Get-NetTCPConnection -State Listen | ? { (Get-Process -Id $_.OwningProcess).Name -eq 'msmdsrv' -and $_.LocalPort -ne 61000 } | Select -First 1 -Expand LocalPort
$c = [Activator]::CreateInstance($type, @("Data Source=localhost:$port"))
$c.Open()
$cmd = $c.CreateCommand(); $cmd.CommandText = (Get-Content "$PSScriptRoot\_q.txt" -Raw)
try {
  $r = $cmd.ExecuteReader()
  (0..($r.FieldCount-1) | % { $r.GetName($_) }) -join ' | '
  while ($r.Read()) { (0..($r.FieldCount-1) | % { $r.GetValue($_) }) -join ' | ' }
} catch { 'ERR: ' + $_.Exception.InnerException.Message + $_.Exception.Message }
$c.Close()
