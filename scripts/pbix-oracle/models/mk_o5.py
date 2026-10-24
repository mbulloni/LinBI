import json
m = 'let Source = #table(type table [R = text, C = text, T = text], {{"R1","C1","t1"},{"R1","C1","t2"},{"R1","C1","t3"},{"R1","C2","t4"},{"R2","C3","t5"},{"R1","C1","t1"},{"R3","C4","t6"},{"R3","C4","t7"}}) in Source'
db = {"createOrReplace":{"object":{"database":"o5"},"database":{"name":"o5","compatibilityLevel":1600,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":"G","columns":[{"name":n,"dataType":"string","sourceColumn":n} for n in "RCT"],
   "partitions":[{"name":"G","source":{"type":"m","expression":m}}],
   "hierarchies":[{"name":"H","levels":[{"name":n,"ordinal":i,"column":n} for i,n in enumerate("RCT")]}]}]}}}}
json.dump(db, open('o5.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o5"}]}}, open('o5r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o5b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o5</DatabaseID></Object><File>C:\\MiBBIAS\\Data\\o5.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c5.ps1','w').write('Copy-Item C:\\MiBBIAS\\Data\\o5.abf $PSScriptRoot\\o5.abf -Force\n')
