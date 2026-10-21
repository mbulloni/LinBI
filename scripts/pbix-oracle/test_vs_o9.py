"""Byte comparison of multi-segment storage (2.5M rows, 3 segments of 1,048,576) with the engine's o9 backup."""
import os, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixray.loader import DataModelLoader
from pbixwrite import vertipaq as V
dm = DataModelLoader(sys.argv[1]).data_model; buf = bytes(dm.decompressed_data)
F = {e['Path'].split('\\')[-1]: buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']][:-4 if dm.error_code else None] for e in dm.file_log}
def cmp(name, mine):
    ref = F[name]
    if ref == mine: print('OK  ', name); return
    i = next((k for k in range(min(len(ref), len(mine))) if ref[k] != mine[k]), min(len(ref), len(mine)))
    print('DIFF', name, len(ref), len(mine), 'at', i, ref[max(0, i - 8):i + 24].hex(), '|', mine[max(0, i - 8):i + 24].hex())
n = 2500000
t = time.time()
kind, idf, meta = V.rownumber_store(n)
cmp('1.Big (10).RowNumber 2662979B 1795 4F74 8F37 6A1BA8059B61 (11).0.idf', idf); cmp('1.Big (10).RowNumber 2662979B 1795 4F74 8F37 6A1BA8059B61 (11).0.idfmeta', meta)
(kind, idf, meta), stats = V.column_store(np.arange(V.FIRST_ID, n + V.FIRST_ID))
cmp('1.Big (10).I (13).0.idf', idf); cmp('1.Big (10).I (13).0.idfmeta', meta)
cmp('1.Big (10).I (13).dictionary', V.dictionary('long', np.arange(1, n + 1)))
print('stats', stats, 'seconds', round(time.time() - t, 2))
