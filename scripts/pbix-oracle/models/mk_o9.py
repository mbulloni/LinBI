import json
m = 'let Source = Table.FromColumns({List.Numbers(1, 2500000), List.Transform(List.Numbers(1, 2500000), each if Number.Mod(_, 1000) = 0 then null else Text.From(Number.Mod(_, 7)))}, type table [I = Int64.Type, C = text]) in Source'
db = {"createOrReplace":{"object":{"database":"o9"},"database":{"name":"o9","compatibilityLevel":1550,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":"Big","columns":[{"name":"I","dataType":"int64","sourceColumn":"I","encodingHint":"Hash"},{"name":"C","dataType":"string","sourceColumn":"C"}],
   "partitions":[{"name":"Big","mode":"import","source":{"type":"m","expression":m}}]}]}}}}
json.dump(db, open('o9.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o9"}]}}, open('o9r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o9b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o9</DatabaseID></Object><File>C:\\LinBIAS\\Data\\o9.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c9.ps1','w').write('Copy-Item C:\\LinBIAS\\Data\\o9.abf $PSScriptRoot\\o9.abf -Force\n')
