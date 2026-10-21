"""Byte comparison of the R$/U$ encoders with the engine's files (o4, o5 backups)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixray.loader import DataModelLoader
from pbixwrite import vertipaq as V
def files(p):
    dm = DataModelLoader(p).data_model; buf = bytes(dm.decompressed_data)
    return {e['Path'].split('\\')[-1]: buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']][:-4 if dm.error_code else None] for e in dm.file_log}
def cmp(F, name, mine):
    ref = F[name]
    if ref == mine: print('OK  ', name); return
    i = next((k for k in range(min(len(ref), len(mine))) if ref[k] != mine[k]), min(len(ref), len(mine)))
    print('DIFF', name, len(ref), len(mine), 'at', i, ref[max(0, i - 8):i + 24].hex(), '|', mine[max(0, i - 8):i + 24].hex())
o4, o5 = files(sys.argv[1]), files(sys.argv[2])
cmp(o4, '0.R$F (10)$r1 (19).INDEX.0.idfx', V.bitpacked_idfx([0, 0, 0, 2, 3, 4, 1]))
u = 'U$D (13)$Gerarchia (35)'
cmp(o4, f'0.{u}.MULTI_LEVEL_ID.0.idfx', V.raw32_single([3, 4, 5, 3, 4, 5, 6, 7], 0))
cmp(o4, f'0.{u}.PARENT_POS.0.idfx', V.raw32_single([0, 0, 0, 1, 1, 2, 2, 3], 0xFFFFFFFF))
cmp(o4, f'0.{u}.FIRST_CHILD_POS.0.idfx', V.raw32_single([4, 6, 8, 0, 0, 0, 0, 0], 0xFFFFFFFF))
cmp(o4, f'0.{u}.CHILD_COUNT.0.idfx', V.raw32_single([3, 3, 2, 0, 0, 0, 0, 0], 0xFFFFFFFF))
u = 'U$G (10)$H (17)'
cmp(o5, f'0.{u}.MULTI_LEVEL_ID.0.idfx', V.raw32_single([3, 4, 5, 3, 4, 5, 6, 3, 4, 5, 6, 7, 8, 9], 0))
cmp(o5, f'0.{u}.CHILD_COUNT.0.idfx', V.raw32_single([3, 2, 2, 4, 2, 2, 3] + [0] * 7, 0xFFFFFFFF))
if len(sys.argv) > 3:
    o6 = files(sys.argv[3])
    for col, kind, vals, keys in [('One (13)', 'string', ['x'], {3: (1, 'x')}),
                                  ('Two (14)', 'long', [1, 2], {3: (1, 1), 4: (1, 2)}),
                                  ('B (15)', 'long', [1, 0], {2: (0,), 3: (1, 1), 4: (1, 0)}),
                                  ('M (16)', 'currency', [12500, -35000, 10000001234], {2: (0,), 3: (1, 12500), 4: (1, -35000), 5: (1, 10000001234)}),
                                  ('OneN (17)', 'string', ['y'], {2: (0,), 3: (1, 'y')})]:
        cmp(o6, f'1.S (10).{col}.dictionary', V.dictionary(kind, vals))
        p, i, per = V.hierarchy(keys, max(keys))
        cmp(o6, f'0.H$S (10)${col}.POS_TO_ID.0.idfx', V.raw32_idfx(p, per))
        cmp(o6, f'0.H$S (10)${col}.ID_TO_POS.0.idfx', V.raw32_idfx(i, per))
