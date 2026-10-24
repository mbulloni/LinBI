import json
T = "a!b#c$d%e&f'g(h)i+j,k-l;m=n@o[p]q^r_s`t{u}v~w x\tñß日本😀é"
db = {"createOrReplace":{"object":{"database":"o12"},"database":{"name":"o12","compatibilityLevel":1550,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":T.replace('\t',' '),"columns":[{"name":"C","dataType":"string","sourceColumn":"C"}],
   "partitions":[{"name":"p","mode":"import","source":{"type":"m","expression":'let Source = #table(type table [C = text], {{"x"}}) in Source'}}]}]}}}}
json.dump(db, open('o12.json','w'), ensure_ascii=True)
json.dump({"refresh":{"type":"full","objects":[{"database":"o12"}]}}, open('o12r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o12b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o12</DatabaseID></Object><File>C:\\MiBBIAS\\Data\\o12.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c12.ps1','w').write('Copy-Item C:\\MiBBIAS\\Data\\o12.abf $PSScriptRoot\\o12.abf -Force\n')
