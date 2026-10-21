import json
fact = 'let Source = #table(type table [K = Int64.Type, P = Int64.Type, D = datetime, Q = number], {{1,1,#datetime(2024,1,5,0,0,0),10},{2,2,#datetime(2024,2,5,0,0,0),20},{3,9,#datetime(2024,3,5,0,0,0),30},{4,1,null,40}}) in Source'
dim = 'let Source = #table(type table [P = Int64.Type, Name = text], {{1,"uno"},{2,"due"},{3,"tre"}}) in Source'
m2m = 'let Source = #table(type table [Name = text, Tag = text], {{"uno","x"},{"uno","y"},{"due","x"}}) in Source'
cal = 'Calendar(Date(Year(MIN(\'F\'[D])), 1, 1), Date(Year(MAX(\'F\'[D])), 12, 31))'
def dcol(n, t, e): return {"type":"calculated","name":n,"dataType":t,"isHidden":True,"isDataTypeInferred":True,"expression":e}
ldt = {"name":"LocalDateTable_1","isHidden":True,"showAsVariationsOnly":True,
  "columns":[{"type":"calculatedTableColumn","name":"Date","dataType":"dateTime","isHidden":True,"isNameInferred":True,"isDataTypeInferred":True,"sourceColumn":"[Date]","dataCategory":"PaddedDateTableDates"},
   dcol("Year","int64","YEAR([Date])"), dcol("MonthNo","int64","MONTH([Date])"), dcol("Month","string","FORMAT([Date], \"MMMM\")")],
  "partitions":[{"name":"LocalDateTable_1","mode":"import","source":{"type":"calculated","expression":cal}}],
  "hierarchies":[{"name":"Date Hierarchy","levels":[{"name":"Year","ordinal":0,"column":"Year"},{"name":"Month","ordinal":1,"column":"Month"}]}],
  "annotations":[{"name":"__PBI_LocalDateTable","value":"true"}]}
db = {"createOrReplace":{"object":{"database":"o7"},"database":{"name":"o7","compatibilityLevel":1600,"model":{"culture":"en-US","defaultPowerBIDataSourceVersion":"powerBI_V3","discourageImplicitMeasures":True,
 "tables":[
  {"name":"F","columns":[{"name":"K","dataType":"int64","sourceColumn":"K"},{"name":"P","dataType":"int64","sourceColumn":"P"},
     {"name":"D","dataType":"dateTime","sourceColumn":"D","variations":[{"name":"Variation","relationship":"rd","defaultHierarchy":{"table":"LocalDateTable_1","hierarchy":"Date Hierarchy"},"isDefault":True}]},
     {"name":"Q","dataType":"double","sourceColumn":"Q"}],
   "partitions":[{"name":"F","mode":"import","source":{"type":"m","expression":fact}}],
   "measures":[{"name":"Tot","expression":"SUM(F[Q])"}]},
  {"name":"Dm","columns":[{"name":"P","dataType":"int64","sourceColumn":"P"},{"name":"Name","dataType":"string","sourceColumn":"Name"}],
   "partitions":[{"name":"Dm","mode":"import","source":{"type":"m","expression":dim}}]},
  {"name":"T","columns":[{"name":"Name","dataType":"string","sourceColumn":"Name"},{"name":"Tag","dataType":"string","sourceColumn":"Tag"}],
   "partitions":[{"name":"T","mode":"import","source":{"type":"m","expression":m2m}}]},
  ldt,
  {"name":"CG","calculationGroup":{"calculationItems":[{"name":"Corrente","expression":"SELECTEDMEASURE()","ordinal":0},{"name":"Doppio","expression":"SELECTEDMEASURE() * 2","ordinal":1,"formatStringDefinition":{"expression":"\"0.0\""}}]},
   "columns":[{"name":"Voce","dataType":"string","sourceColumn":"Name","sortByColumn":"Ordinal"},{"name":"Ordinal","dataType":"int64","sourceColumn":"Ordinal","isHidden":True}],
   "partitions":[{"name":"CGp","mode":"import","source":{"type":"calculationGroup"}}]}],
 "relationships":[
  {"name":"r1","fromTable":"F","fromColumn":"P","toTable":"Dm","toColumn":"P","crossFilteringBehavior":"bothDirections"},
  {"name":"r2","fromTable":"F","fromColumn":"K","toTable":"Dm","toColumn":"P","isActive":False},
  {"name":"r3","fromTable":"T","fromColumn":"Name","fromCardinality":"many","toTable":"Dm","toColumn":"Name","toCardinality":"many"},
  {"name":"rd","fromTable":"F","fromColumn":"D","toTable":"LocalDateTable_1","toColumn":"Date","joinOnDateBehavior":"datePartOnly"}],
 "expressions":[{"name":"Soglia","kind":"m","expression":"10 meta [IsParameterQuery=true, Type=\"Number\", IsParameterQueryRequired=true]"}]}}}}
json.dump(db, open('o7.json','w'))
json.dump({"refresh":{"type":"full","objects":[{"database":"o7"}]}}, open('o7r.json','w'))
E='xmlns="http://schemas.microsoft.com/analysisservices/2003/engine"'
open('o7b.xml','w').write(f'<Backup {E}><Object><DatabaseID>o7</DatabaseID></Object><File>C:\\LinBIAS\\Data\\o7.abf</File><AllowOverwrite>true</AllowOverwrite><ApplyCompression>false</ApplyCompression></Backup>')
open('_c7.ps1','w').write('Copy-Item C:\\LinBIAS\\Data\\o7.abf $PSScriptRoot\\o7.abf -Force\n')
open('uo7.txt','w').write('o7')
open('qo7.txt','w').write('EVALUATE SUMMARIZECOLUMNS(Dm[Name], CG[Voce], "Tot", [Tot])')
open('qo7b.txt','w').write('EVALUATE SUMMARIZECOLUMNS(T[Tag], "Tot", [Tot])')
open('qo7c.txt','w').write('EVALUATE SUMMARIZECOLUMNS(LocalDateTable_1[Month], "Tot", [Tot], "Inact", CALCULATE([Tot], USERELATIONSHIP(F[K], Dm[P])))')
