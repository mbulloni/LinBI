import json
m = 'let Source = Table.FromColumns({List.Numbers(1, 300000), List.Transform(List.Numbers(1, 300000), each "valore numero " & Text.From(_ * 7919))}, type table [I = Int64.Type, C = text]) in Source'
db = {"createOrReplace":{"object":{"database":"o10"},"database":{"name":"o10","compatibilityLevel":1550,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":"Big","columns":[{"name":"I","dataType":"int64","sourceColumn":"I","encodingHint":"Hash"},{"name":"C","dataType":"string","sourceColumn":"C"}],
   "partitions":[{"name":"Big","mode":"import","source":{"type":"m","expression":m}}]}]}}}}
json.dump(db, open('o10.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o10"}]}}, open('o10r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o10b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o10</DatabaseID></Object><File>C:\\LinBIAS\\Data\\o10.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c9.ps1','w').write('Copy-Item C:\\LinBIAS\\Data\\o10.abf $PSScriptRoot\\o10.abf -Force\n')
