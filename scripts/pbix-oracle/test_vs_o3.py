import os, sys, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixray.loader import DataModelLoader
from kaitaistruct import KaitaiStream, BytesIO
from pbixray.column_data.dictionary import ColumnDataDictionary as CD
from pbixwrite import vertipaq as V
l = DataModelLoader(sys.argv[1]); dm = l.data_model; buf = bytes(dm.decompressed_data)
F = {e['Path'].split('\\')[-1]: buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']][:-4] for e in dm.file_log}
def cmp(name, mine):
    ref = F[name]
    if ref == mine: print('OK  ', name); return
    i = next((k for k in range(min(len(ref), len(mine))) if ref[k] != mine[k]), min(len(ref), len(mine)))
    print('DIFF', name, len(ref), len(mine), 'at', i, ref[max(0,i-8):i+24].hex(), '|', mine[max(0,i-8):i+24].hex())
for col, kind in [('I (13)', 'long'), ('C (14)', 'string'), ('V (15)', 'real'), ('DT (16)', 'real'), ('N (17)', 'long')]:
    name = f'1.T (10).{col}.dictionary'
    c = CD(KaitaiStream(BytesIO(F[name])))
    if kind == 'string':
        vals = c.data.dictionary_pages[0].string_store.uncompressed_character_buffer.split('\x00')[:-1]
    else:
        vals = list(c.data.vector_of_vectors_info.values)
    cmp(name, V.dictionary(kind, vals))
    # hierarchy: sort by value, null first
    keys = {i + 3: (1, v) for i, v in enumerate(vals)}
    last = len(vals) + 2
    if col in ('C (14)', 'V (15)'): keys[2] = (0, '')
    p, i, per = V.hierarchy(keys, last)
    cmp(f'0.H$T (10)${col}.POS_TO_ID.0.idfx', V.raw32_idfx(p, per))
    cmp(f'0.H$T (10)${col}.ID_TO_POS.0.idfx', V.raw32_idfx(i, per))
cmp('1.T (10).RowNumber 2662979B 1795 4F74 8F37 6A1BA8059B61 (11).0.idfx', V.rownumber_idfx(2500))
