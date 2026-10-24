import json
fact = 'let Source = #table(type table [K = Int64.Type, P = Int64.Type, Q = number], List.Transform({1..300}, each {_, Number.Mod(_, 4) + 1, _ * 2.0})) in Source'
dim = 'let Source = #table(type table [P = Int64.Type, Name = text, Cat = text], {{1,"uno","A"},{2,"due","A"},{3,"tre","B"},{4,"quattro","B"},{5,"cinque","C"}}) in Source'
db = {"createOrReplace":{"object":{"database":"o4"},"database":{"name":"o4","compatibilityLevel":1600,"model":{
 "culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3","dataAccessOptions":{"legacyRedirects":True,"returnErrorValuesAsNull":True},
 "tables":[
  {"name":"F","columns":[{"name":"K","dataType":"int64","sourceColumn":"K"},{"name":"P","dataType":"int64","sourceColumn":"P"},
     {"name":"Q","dataType":"double","sourceColumn":"Q","formatString":"0.00"},
     {"name":"Q2","type":"calculated","dataType":"double","expression":"F[Q] * 10"}],
   "partitions":[{"name":"F","source":{"type":"m","expression":fact}}],
   "measures":[{"name":"Tot","expression":"SUM(F[Q])","formatString":"#,0.00"},{"name":"Cnt","expression":"COUNTROWS(F)","displayFolder":"Cartella"}]},
  {"name":"D","columns":[{"name":"P","dataType":"int64","sourceColumn":"P"},{"name":"Name","dataType":"string","sourceColumn":"Name","sortByColumn":"P"},
     {"name":"Cat","dataType":"string","sourceColumn":"Cat"}],
   "partitions":[{"name":"D","source":{"type":"m","expression":dim}}],
   "hierarchies":[{"name":"Gerarchia","levels":[{"name":"Cat","ordinal":0,"column":"Cat"},{"name":"Name","ordinal":1,"column":"Name"}]}],
   "annotations":[{"name":"PBI_ResultType","value":"Table"}]},
  {"name":"CT","partitions":[{"name":"CT","source":{"type":"calculated","expression":'SUMMARIZECOLUMNS(D[Cat], "S", [Tot])'}}],
   "columns":[{"name":"Cat","type":"calculatedTableColumn","dataType":"string","sourceColumn":"D[Cat]","isNameInferred":True,"isDataTypeInferred":True},
              {"name":"S","type":"calculatedTableColumn","dataType":"double","sourceColumn":"[S]","isNameInferred":True,"isDataTypeInferred":True}]}],
 "relationships":[{"name":"r1","fromTable":"F","fromColumn":"P","toTable":"D","toColumn":"P"}],
 "roles":[{"name":"SoloA","modelPermission":"read","tablePermissions":[{"name":"D","filterExpression":'D[Cat] = "A"'}]}],
 "annotations":[{"name":"PBIDesktopVersion","value":"2.159"}]}}}}
json.dump(db, open('o4.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o4"}]}}, open('o4r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o4b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o4</DatabaseID></Object><File>C:\\MiBBIAS\\Data\\o4.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c4.ps1','w').write('Copy-Item C:\\MiBBIAS\\Data\\o4.abf $PSScriptRoot\\o4.abf -Force\n')
open('uo4.txt','w').write('o4')
open('qo4.txt','w').write('EVALUATE SUMMARIZECOLUMNS(D[Cat], "Tot", [Tot], "Cnt", [Cnt], "Q2", SUM(F[Q2]))')
open('qo4b.txt','w').write('EVALUATE CT')
