import json
db = {"createOrReplace":{"object":{"database":"o8"},"database":{"name":"o8","compatibilityLevel":1550,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":"Misure","columns":[{"name":"Colonna1","dataType":"string","sourceColumn":"Colonna1","isHidden":True}],
   "partitions":[{"name":"Misure","mode":"import","source":{"type":"m","expression":"let Origine = Table.FromRows({}, type table [Colonna1 = text]) in Origine"}}],
   "measures":[{"name":"Uno","expression":"1"}]}]}}}}
json.dump(db, open('o8.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o8"}]}}, open('o8r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o8b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o8</DatabaseID></Object><File>C:\\MiBBIAS\\Data\\o8.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c8.ps1','w').write('Copy-Item C:\\MiBBIAS\\Data\\o8.abf $PSScriptRoot\\o8.abf -Force\n')
