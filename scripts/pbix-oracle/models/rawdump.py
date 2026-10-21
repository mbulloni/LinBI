import sys, struct
from kaitaistruct import KaitaiStream, BytesIO
from pbixray.loader import DataModelLoader
from pbixray.column_data.idfmeta import IdfmetaParser
from pbixray.column_data.idf import ColumnDataIdf
l = DataModelLoader(sys.argv[1]); dm=l.data_model; buf=bytes(dm.decompressed_data)
pat = sys.argv[2:]
for e in dm.file_log:
    n=e['Path'].split('\\')[-1]
    if not n.endswith('idfx') or not any(p in n for p in pat): continue
    d=buf[e['m_cbOffsetHeader']:e['m_cbOffsetHeader']+e['Size']]
    if dm.error_code: d=d[:-4]
    k=d.index(b'<1:CP\x00'); m=IdfmetaParser(KaitaiStream(BytesIO(d[k:d.rindex(b'SDOs:1>\x00')+8]))).column_partition
    print('##', n)
    for i,s in enumerate(m.segments):
        print('  seg',i,'rec',s.records,'base',s.base_id,'cc',s.compression_class,s.sub_compression_class,'first',s.first_run_value,'ss',(s.ss.min_data_id,s.ss.max_data_id,s.ss.original_min_segment_data_id,s.ss.row_count,s.ss.has_nulls,s.ss.rle_runs,s.ss.others_rle_runs), 'rle', getattr(s,'rle_facet_data',None) and (s.rle_facet_data.bookmark_bits,s.rle_facet_data.storage_alloc_size,s.rle_facet_data.storage_used_size), 'sub', s.has_subsegment and s.subsegment.records)
    idf=d[:k]
    if m.segments[0].compression_class==703062:
        a=struct.unpack_from('<Q',idf,0)[0]; p=struct.unpack_from(f'<{2*a}I',idf,8); b=struct.unpack_from('<Q',idf,8+8*a)[0]; q=struct.unpack_from(f'<{2*b}I',idf,16+8*a)
        print('  raw32', p, '|', q)
    else:
        x=ColumnDataIdf(KaitaiStream(BytesIO(idf)))
        for s in x.segments: print('  prim', [(e.data_value,e.repeat_value) for e in s.primary_segment if e.repeat_value], 'sub', s.sub_segment.hex()[:64])
