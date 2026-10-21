"""mutate.py <src .abf|.pbix> <out .abf> <script.py>: load ABF files into dict F {relpath: bytes} (+ DBXML, DBID),
run script (may edit F, use sql(q) on metadata.sqlitedb), write ABF with abfwrite."""
import sys, re, sqlite3, tempfile, os
sys.path.insert(0, os.path.dirname(__file__))
from pbixray.loader import DataModelLoader
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite.abf import write_abf
l = DataModelLoader(sys.argv[1]); dm = l.data_model; buf = bytes(dm.decompressed_data)
F = {}; DBXML = None; DBID = None
for e in dm.file_log:
    d = buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']]
    if dm.error_code: d = d[:-4]
    if e['Path'].endswith('.db.xml'):
        DBXML = d; DBID = re.search(r'([^\\]+)\.\d+\.db\.xml$', e['Path']).group(1)
    else:
        F[e['Path']] = d
tmp = tempfile.mktemp(suffix='.sqlitedb'); open(tmp, 'wb').write(F['metadata.sqlitedb'])
con = sqlite3.connect(tmp)
def sql(q, *a):
    cur = con.execute(q, a); r = cur.fetchall(); return r
exec(open(sys.argv[3]).read())
con.commit(); con.close()
F['metadata.sqlitedb'] = open(tmp, 'rb').read()
files = [(k, v) for k, v in F.items() if k != 'metadata.sqlitedb'] + [('metadata.sqlitedb', F['metadata.sqlitedb'])]
open(sys.argv[2], 'wb').write(write_abf(DBID, files, DBXML))
print('written', sys.argv[2], len(files), 'files')
