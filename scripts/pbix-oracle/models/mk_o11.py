import json
T = 'Vendite / 2026: "q" <a>|b*?\\c.d'
C = 'Città [€] / %'
m = 'let Source = #table(type table [#"' + C.replace('"', '""') + '" = text, N = Int64.Type], {{"x", 1}, {"y", 2}}) in Source'
db = {"createOrReplace":{"object":{"database":"o11"},"database":{"name":"o11","compatibilityLevel":1550,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3",
 "tables":[{"name":T,"columns":[{"name":C,"dataType":"string","sourceColumn":C},{"name":"N","dataType":"int64","sourceColumn":"N","encodingHint":"Hash"}],
   "partitions":[{"name":"p","mode":"import","source":{"type":"m","expression":m}}],
   "hierarchies":[{"name":"Gerarchia / ü","levels":[{"name":"L","ordinal":0,"column":C}]}]}]}}}}
json.dump(db, open('o11.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o11"}]}}, open('o11r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o11b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o11</DatabaseID></Object><File>C:\\LinBIAS\\Data\\o11.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c11.ps1','w').write('Copy-Item C:\\LinBIAS\\Data\\o11.abf $PSScriptRoot\\o11.abf -Force\n')
