"""VertiPaq column storage encoders (hash-encoded columns only).

Data ids: 2 = null/blank, values get 3.. in first-appearance order. Every data column is hash encoded
(dictionary + bit-packed ids), so no value-encoding hash index (.hidx) is ever needed.

A column partition is stored either as one `.idfx` file (idf + idfmeta + u64 length of the idfmeta), which the engine
writes for small tables, or as separate `.idf` / `.idfmeta` files (large tables, empty tables). Functions return
`('x', idfx)` or `('s', idf, idfmeta)`.
"""
import struct

import numpy as np

NULL_ID = 2
FIRST_ID = 3
SEGMENT_ROWS = 1 << 20  # 1,048,576 rows per segment, like Power BI Desktop
HYBRID_RLE = 703066
RAW32 = 703062
RN_SUB = 703067
_BITPACK = [(w, 703030 + w) for w in range(1, 11)] + [(12, 703042), (16, 703046), (21, 703051), (32, 703062)]
PAGE_CHARS = 1 << 19  # string dictionary page: 512K UTF-16 characters (1 MiB), terminators included


def bit_class(span):
    """Smallest supported bit width holding values 0..span, and its compression class."""
    need = max(1, int(span).bit_length())
    for w, cls in _BITPACK:
        if w >= need:
            return w, cls
    raise ValueError('span too large')


def bitpack(values, width):
    """Little-endian packing of `width`-bit values into u64 words, 64 // width per word; always one spare word
    when the values fill the last word exactly (the engine does the same). Returns a uint64 array."""
    v = np.asarray(values, dtype=np.uint64)
    per = 64 // width
    nwords = len(v) // per + 1
    padded = np.zeros(nwords * per, dtype=np.uint64)
    padded[:len(v)] = v
    shifts = (np.arange(per, dtype=np.uint64) * np.uint64(width))
    return np.bitwise_or.reduce(padded.reshape(nwords, per) << shifts, axis=1)


def _tag(name):
    return f'<1:{name}\x00'.encode('ascii')


def _end(name):
    return f'{name}:1>\x00'.encode('ascii')


def _q(*v):
    return struct.pack('<' + 'Q' * len(v), *v)


def _words(w):
    return np.asarray(w, dtype='<u8').tobytes()


def _ss(min_id, max_id, rows, has_nulls, runs=0, others=1, orig_min=2):
    return (_tag('SS') + _q(0) + struct.pack('<III', min_id, max_id, orig_min) + struct.pack('<q', -1) + _q(rows)
            + bytes([1 if has_nulls else 0]) + _q(runs, others) + _end('SS'))


def _idfmeta_cs(records, base_id, cc, scc, rle, first, ss, sub_records):
    out = _tag('CS') + _q(records, base_id) + struct.pack('<II', cc, scc)
    if cc == HYBRID_RLE:
        out += _q(*rle[:3]) + bytes([rle[3]])
    out += struct.pack('<I', first) + ss
    if sub_records is None:
        out += b'\x00'
    else:
        out += b'\x01' + _tag('CS') + _q(sub_records, 0) + b'\x00' + _end('CS')
    return out + _end('CS')


def _sdos(entries):
    out = _tag('SDOs')
    for off, words, sub in entries:
        out += _tag('CSDOs') + struct.pack('<qq', off, words)
        if sub is not None:
            out += _tag('CSDOs') + struct.pack('<qq', *sub) + _end('CSDOs')
        out += _end('CSDOs')
    return out + _end('SDOs')


def _pack(idf, cs_list, sdos, split):
    meta = _tag('CP') + _q(len(cs_list)) + b''.join(cs_list) + _end('CP') + _sdos(sdos)
    return ('s', idf, meta) if split else ('x', idf + meta + _q(len(meta)))


def _bookmark_bits(n):
    return max(5, int(n).bit_length() + 2)


def _segment(ids):
    """One data segment: null runs as RLE entries (id 2), everything else bit-packed relative to first_run_value.
    -> (idf bytes, idfmeta CS bytes, (slots, words), runs, others)"""
    n = len(ids)
    nulls = ids == NULL_ID
    nonnull = ids[~nulls]
    has_nulls = bool(nulls.any())
    lo = int(nonnull.min()) if len(nonnull) else FIRST_ID
    hi = int(nonnull.max()) if len(nonnull) else FIRST_ID
    first = NULL_ID if has_nulls else lo
    width, scc = bit_class(hi - first)
    entries = []
    if n:
        starts = np.concatenate(([0], np.flatnonzero(nulls[1:] != nulls[:-1]) + 1))
        ends = np.concatenate((starts[1:], [n]))
        packed = 0
        for s, e in zip(starts.tolist(), ends.tolist()):
            if nulls[s]:
                entries.append((NULL_ID, e - s))
            else:
                entries.append((0xFFFFFFFF - packed, e - s))
                packed += e - s
    words = bitpack(nonnull - first, width)
    slots = max(16, len(entries))
    prim = np.zeros((slots, 2), dtype='<u4')
    if entries:
        prim[:len(entries)] = entries
    idf = _q(slots) + prim.tobytes() + _q(len(words)) + _words(words)
    runs = sum(1 for e in entries if e[0] == NULL_ID)
    others = len(entries) - runs
    rle = (_bookmark_bits(n), 2 * slots, 2 * len(entries) + 2, 0)
    cs = _idfmeta_cs(n, 1, HYBRID_RLE, scc, rle, first, _ss(lo, hi, n, has_nulls, runs, others), len(nonnull))
    return idf, cs, (slots, len(words)), runs, others


def column_store(ids, seg_rows=SEGMENT_ROWS):
    """Data column partition -> (stored, stats). One segment = .idfx, more = .idf + .idfmeta."""
    ids = np.asarray(ids, dtype=np.int64)
    idf, cs_list, sdos, runs, others = b'', [], [], 0, 0
    for s in range(0, max(len(ids), 1), seg_rows):
        sidf, cs, (slots, nw), r, o = _segment(ids[s:s + seg_rows])
        off = len(idf)
        sdos.append((off, slots, (off + 8 + slots * 8, nw)))
        idf += sidf
        cs_list.append(cs)
        runs, others = runs + r, others + o
    return _pack(idf, cs_list, sdos, len(cs_list) > 1), {'runs': runs, 'others': others, 'segments': len(cs_list)}


def column_idfx(ids, has_nulls=None):
    """Single-segment data column as one .idfx file (kept for the byte-comparison tests)."""
    return column_store(ids)[0][1]


def rownumber_store(n, seg_rows=SEGMENT_ROWS):
    idf, cs_list, sdos = b'', [], []
    for s in range(0, max(n, 1), seg_rows):
        rec = min(seg_rows, n - s)
        prim = [(0xFFFFFFFF, rec)] + [(0, 0)] * 15
        off = len(idf)
        idf += _q(16) + b''.join(struct.pack('<II', *e) for e in prim) + _q(0)
        lo = FIRST_ID + s
        cs_list.append(_idfmeta_cs(rec, 0, HYBRID_RLE, RN_SUB, (24, 32, 2, 0), lo, _ss(lo, lo + rec - 1, rec, False, 0, 0), rec))
        sdos.append((off, 16, (off + 8 + 16 * 8, 0)))
    return _pack(idf, cs_list, sdos, len(cs_list) > 1)


def rownumber_idfx(n):
    return rownumber_store(n)[1]


def _raw32_words(vals):
    v = np.zeros((len(vals) // 2 + 1) * 2, dtype='<u4')
    v[:len(vals)] = vals
    return v.tobytes()


def raw32_store(values, per, split=False, first=0):
    """H$ hierarchy column: raw 32-bit segments of `per` records (per = distinct values of the column)."""
    values = np.asarray(values, dtype=np.uint32)
    chunks = [values[i:i + per] for i in range(0, len(values), per)] or [values[:0]]
    idf, sdos, cs_list = b'', [], []
    ss = _ss(NULL_ID, NULL_ID, 0, False, 0, 0)
    for ch in chunks:
        words = _raw32_words(ch)
        sdos.append((len(idf), len(words) // 8, None))
        idf += _q(len(words) // 8) + words
        cs_list.append(_idfmeta_cs(len(ch), 0, RAW32, 1, None, first, ss, None))
    return _pack(idf, cs_list, sdos, split)


def raw32_idfx(values, per):
    return raw32_store(values, per)[1]


def raw32_single(values, first):
    """U$ user-hierarchy column as one .idfx (one raw 32-bit segment); raw32_store(values, len, split, first) otherwise."""
    return raw32_store(values, max(len(values), 1), False, first)[1]


def hierarchy(order, last_id):
    """order: data ids sorted by position (NULL_ID first when present) -> (pos_to_id, id_to_pos, records per segment)."""
    order = np.asarray(order, dtype=np.int64)
    distinct = len(order)
    total = last_id + 1
    pos_to_id = np.zeros(total, dtype=np.int64)
    pos_to_id[:distinct] = order
    id_to_pos = np.zeros(total, dtype=np.int64)
    id_to_pos[1] = distinct
    id_to_pos[order] = np.arange(distinct)
    return pos_to_id, id_to_pos, max(distinct, 1)


HASH_INFO = {'long': [-1, 8, 64, 6, -1, -1], 'real': [-1, 16, 64, 3, -1, -1], 'string': [0, 8, 64, 6, -1, -1]}
CURRENCY_SCALE = 10000  # fixed decimal: int64 of value * 10^4


def _string_pages(values):
    """Uncompressed pages of at most PAGE_CHARS characters -> (pages bytes, handles bytes, page count)."""
    pages, handles, page_count = [], [], 0
    i, n = 0, len(values)
    while i < n or page_count == 0:
        start, used, parts = i, 0, []
        while i < n and (used + len(values[i]) + 1 <= PAGE_CHARS or not parts):
            handles.append((used, page_count))
            parts.append(values[i])
            used += len(values[i]) + 1
            i += 1
        buf = ('\x00'.join(parts) + ('\x00' if parts else '')).encode('utf-16le')
        pages.append(_q(0) + b'\x00' + _q(start, len(parts)) + b'\x00' + b'\xdd\xcc\xbb\xaa'
                     + _q(0, used, len(buf)) + buf + b'\xcd\xab\xcd\xab')
        page_count += 1
        if i >= n:
            break
    return b''.join(pages), np.asarray(handles, dtype='<u4').reshape(-1, 2).tobytes(), page_count


def dictionary(kind, values):
    """values in data-id order (id 3 first)."""
    if kind == 'string':
        pages, handles, count = _string_pages(values)
        longest = max((len(v) for v in values), default=0)
        body = _q(len(values)) + b'\x01' + _q(longest, count) + pages + _q(len(values)) + struct.pack('<I', 8) + handles
        return struct.pack('<i', 2) + struct.pack('<6i', *HASH_INFO['string']) + body
    arr = np.asarray(values)
    if kind == 'long':
        small = len(arr) == 0 or (arr.min() >= -2**31 and arr.max() < 2**31)
        data, size = (arr.astype('<i4').tobytes(), 4) if small else (arr.astype('<i8').tobytes(), 8)
        return struct.pack('<i', 0) + struct.pack('<6i', *HASH_INFO['long']) + _q(len(arr)) + struct.pack('<I', size) + data
    if kind == 'currency':
        return struct.pack('<i', 0) + struct.pack('<6i', *HASH_INFO['real']) + _q(len(arr)) + struct.pack('<I', 8) + arr.astype('<i8').tobytes()
    return struct.pack('<i', 1) + struct.pack('<6i', *HASH_INFO['real']) + _q(len(arr)) + struct.pack('<I', 8) + arr.astype('<f8').tobytes()


def bitpacked_store(values, split=False):
    """R$ relationship INDEX column: pure bit-packing (no RLE), class 703030 + width."""
    values = np.asarray(values, dtype=np.int64)
    width, cls = bit_class(int(values.max()) if len(values) else 0)
    words = bitpack(values, width)
    idf = _q(len(words)) + _words(words)
    cs = _idfmeta_cs(len(values), 0, cls, 1, None, 0xFFFFFFFF, _ss(NULL_ID, NULL_ID, 0, False, 0, 0), None)
    return _pack(idf, [cs], [(0, len(words), None)], split)


def bitpacked_idfx(values):
    return bitpacked_store(values)[1]


def empty_column(rownumber=False):
    """Column of an empty table: (idf, idfmeta) in the separate-file format the engine writes for 0 rows."""
    if rownumber:
        prim = [(0xFFFFFFFF, 0)] + [(0, 0)] * 15
        idf = _q(16) + b''.join(struct.pack('<II', *e) for e in prim) + _q(0)
        cs = _idfmeta_cs(0, 0, HYBRID_RLE, RN_SUB, (24, 32, 2, 0), FIRST_ID, _ss(NULL_ID, NULL_ID, 0, False, 0, 0), 0)
        sub = (8 + 16 * 8, 0)
    else:
        idf = _q(16) + b'\x00' * 128 + _q(1) + _q(0)
        cs = _idfmeta_cs(0, 1, HYBRID_RLE, 703031, (1, 32, 2, 0), NULL_ID, _ss(NULL_ID, NULL_ID, 0, False, 0, 1), 0)
        sub = (8 + 16 * 8, 1)
    return idf, _tag('CP') + _q(1) + cs + _end('CP') + _sdos([(0, 16, sub)])
