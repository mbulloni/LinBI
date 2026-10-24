import json
m = 'let Source = #table(type table [One = text, Two = Int64.Type, B = logical, M = Currency.Type, OneN = text], {{"x",1,true,1.25,null},{"x",2,false,-3.5,"y"},{"x",1,true,1000000.1234,"y"},{"x",2,null,null,null}}) in Source'
db = {"createOrReplace":{"object":{"database":"o6"},"database":{"name":"o6","compatibilityLevel":1600,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":"S","columns":[{"name":n,"dataType":t,"sourceColumn":n,"encodingHint":"Hash"} for n,t in [("One","string"),("Two","int64"),("B","boolean"),("M","decimal"),("OneN","string")]],
   "partitions":[{"name":"S","source":{"type":"m","expression":m}}]}]}}}}
json.dump(db, open('o6.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o6"}]}}, open('o6r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o6b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o6</DatabaseID></Object><File>C:\\MiBBIAS\\Data\\o6.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c6.ps1','w').write('Copy-Item C:\\MiBBIAS\\Data\\o6.abf $PSScriptRoot\\o6.abf -Force\n')
