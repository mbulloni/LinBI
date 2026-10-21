import sys, zipfile, re
sys.path.insert(0, sys.path[0])
from pbixray.loader import DataModelLoader
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite.abf import write_abf
from xpress9 import Xpress9

def compress(abf):
    x = Xpress9()
    sig = 'This backup was created using XPress9 compression.'.encode('utf-16le')
    out = bytearray(b'\xff\xfe' + sig)
    for i in range(0, len(abf), 2 * 1024 * 1024):
        chunk = abf[i:i + 2 * 1024 * 1024]
        c = x.compress(chunk, len(chunk) + 65536)
        out += len(chunk).to_bytes(4, 'little') + len(c).to_bytes(4, 'little') + c
    return bytes(out)

src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
drop = sys.argv[4] if len(sys.argv) > 4 else None
l = DataModelLoader(src)
dm = l.data_model; buf = bytes(dm.decompressed_data)
files, dbxml, dbid = [], None, None
for e in dm.file_log:
    data = buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']]
    if dm.error_code: data = data[:-4]
    if e['Path'].endswith('.db.xml'):
        dbxml = data; dbid = re.search(r'([^\\]+)\.\d+\.db\.xml$', e['Path']).group(1)
    elif not (drop and re.search(drop, e['Path'])):
        files.append((e['Path'], data))
abf = write_abf(dbid, files, dbxml)
dmbytes = compress(abf) if mode == 'x9' else abf
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zo:
    for info in zi.infolist():
        if info.filename == 'DataModel':
            zo.writestr('DataModel', dmbytes, compress_type=zipfile.ZIP_STORED)
        else:
            zo.writestr(info, zi.read(info.filename))
print('ok', len(abf), len(dmbytes))
