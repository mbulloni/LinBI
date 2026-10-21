import sys, re
from kaitaistruct import KaitaiStream, BytesIO
from pbixray.loader import DataModelLoader
from pbixray.column_data.idfmeta import IdfmetaParser
from pbixray.column_data.idf import ColumnDataIdf
l = DataModelLoader(sys.argv[1]); dm = l.data_model; buf = bytes(dm.decompressed_data)
F = {}
for e in dm.file_log:
    d = buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader'] + e['Size']]
    F[e['Path']] = d[:-4] if dm.error_code else d
rows=set()
for p in list(F):
    if p.endswith('.idfx'):
        d=F.pop(p); k=d.index(b'<1:CP\x00'); e=d.rindex(b'SDOs:1>\x00')+8
        F[p[:-5]+'.idf']=d[:k]; F[p[:-5]+'.idfmeta']=d[k:e]
        if len(d)-e: print('tail', p[-50:], d[e:].hex())
for p, d in F.items():
    if not p.endswith('.idfmeta'): continue
    m = IdfmetaParser(KaitaiStream(BytesIO(d))).column_partition
    idf = ColumnDataIdf(KaitaiStream(BytesIO(F[p[:-4]])))
    for i, s in enumerate(m.segments):
        seg = idf.segments[i] if i < len(idf.segments) else None
        used = sum(1 for e in seg.primary_segment if e.repeat_value) if seg else None
        r = m.sdos.entries[i]
        rl = s.rle_facet_data if s.compression_class == 703066 else None
        rows.add((s.records, s.compression_class - 703000, s.sub_compression_class - 703000,
                  rl and rl.bookmark_bits, rl and rl.storage_alloc_size, rl and rl.storage_used_size,
                  s.ss.rle_runs, s.ss.others_rle_runs, s.ss.distinct_states, s.ss.has_nulls,
                  seg and seg.primary_segment_size, used, seg and seg.sub_segment_size, s.has_subsegment,
                  s.subsegment.records if s.has_subsegment else None,
                  r.segment_data_size, r.segment_data_offset,
                  r.sub_csdos.segment_data_size if s.has_subsegment else None, r.sub_csdos.segment_data_offset if s.has_subsegment else None,
                  s.ss.max_data_id - s.ss.min_data_id, s.first_run_value - s.ss.min_data_id, 'RN' if 'RowNumber' in p else ('H' if 'H$' in p else ('R' if 'R$' in p else ''))))
print('records cc scc bmk alloc used runs others distinct nulls prim used subsz hassub subrec sd_size sd_off sub_size sub_off range first kind')
for r in sorted(rows, key=lambda r: (r[1], r[0]))[:int(sys.argv[2]) if len(sys.argv)>2 else 400]: print(*r)
