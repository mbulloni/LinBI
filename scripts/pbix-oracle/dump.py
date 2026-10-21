import sys, os
from pbixray.loader import DataModelLoader
f, out = sys.argv[1], sys.argv[2]
l = DataModelLoader(f)
dm = l.data_model
buf = bytes(dm.decompressed_data)
os.makedirs(out, exist_ok=True)
open(os.path.join(out, '_abf.bin'), 'wb').write(buf)
print('abf size', len(buf), 'compression flag', dm.apply_compression, 'err', dm.error_code)
for e in dm.file_log:
    print(e['m_cbOffsetHeader'], e['Size'], e['SizeFromLog'], e['StoragePath'], e['Path'])
    open(os.path.join(out, e['FileName']), 'wb').write(buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader']+e['Size']])
