$asm = [Reflection.Assembly]::LoadFrom('C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll')
$type = $asm.GetTypes() | ? { $_.Name -eq 'AdomdConnection' } | Select -First 1
$port = Get-NetTCPConnection -State Listen | ? { (Get-Process -Id $_.OwningProcess).Name -eq 'msmdsrv' } | Select -First 1 -Expand LocalPort
if (Test-Path "$PSScriptRoot\_port") { $port = (Get-Content "$PSScriptRoot\_port").Trim() }
Get-ChildItem "$PSScriptRoot\stage" -File -ErrorAction SilentlyContinue | % { Copy-Item $_.FullName C:\LinBIAS\Data\ -Force }
$c = [Activator]::CreateInstance($type, @("Data Source=localhost:$port" + $(if (Test-Path "$PSScriptRoot\_db") { ";Initial Catalog=" + (Get-Content "$PSScriptRoot\_db").Trim() } else { "" })))
$c.Open()
"port $port"
foreach ($f in (Get-ChildItem "$PSScriptRoot\xmla" -File -ErrorAction SilentlyContinue | Sort Name)) {
  "== $($f.Name)"
  $cmd = $c.CreateCommand(); $cmd.CommandText = (Get-Content $f.FullName -Raw)
  try {
    if ($f.Name -like '*-u-*') {
      # "db" or "db;Roles=R" (reconnect with extra connection-string properties)
      $u = (Get-Content $f.FullName -Raw).Trim()
      if ($u.Contains(';')) { $c.Close(); $c = [Activator]::CreateInstance($type, @("Data Source=localhost:$port;Initial Catalog=$u")); $c.Open() } else { $c.ChangeDatabase($u) }
      'use ok'
    }
    elseif ($f.Name -like '*-q-*') {
      $r = $cmd.ExecuteReader()
      (0..($r.FieldCount-1) | % { $r.GetName($_) }) -join ' | '
      while ($r.Read()) { (0..($r.FieldCount-1) | % { $r.GetValue($_) }) -join ' | ' }
      $r.Close()
    } else { $n = $cmd.ExecuteNonQuery(); "ok" }
  } catch { 'ERR: ' + $_.Exception.InnerException.Message }
}
$c.Close()
