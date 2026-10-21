import sys, os, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite import model
from pbixwrite.abf import write_abf
n = 2500
names = ["alpha","beta","gamma","delta","eps"]
rows = range(1, n + 1)
spec = {'id': 'g1', 'name': 'g1', 'tables': [{'name': 'T', 'm': 'let Source = 1 in Source', 'columns': [
    {'name': 'I', 'type': 'int64', 'values': list(rows)},
    {'name': 'C', 'type': 'string', 'values': [names[i // 500] if i // 500 < 5 else None for i in rows]},
    {'name': 'V', 'type': 'double', 'values': [None if i % 7 == 0 else i * 1.25 for i in rows]},
    {'name': 'DT', 'type': 'dateTime', 'values': [datetime.datetime(2024,1,1) + datetime.timedelta(days=i % 40) for i in rows]},
    {'name': 'N', 'type': 'int64', 'values': [(i * 37) % 101 - 50 for i in rows]},
]}]}
db_id, files, dbxml = model.build(spec)
files.insert(0, ('0.CryptKey.bin', open(os.path.join(os.path.dirname(model.__file__), 'CryptKey.bin'), 'rb').read()))
out = sys.argv[1]
open(out, 'wb').write(write_abf(db_id, files, dbxml))
print('written', out, len(files))
