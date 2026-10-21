"""VertiPaq column storage encoders (hash-encoded columns only).

Data ids: 2 = null/blank, values get 3.. in first-appearance order. Every data column is hash encoded
(dictionary + bit-packed ids), so no value-encoding hash index (.hidx) is ever needed.
"""
import struct

NULL_ID = 2
FIRST_ID = 3
HYBRID_RLE = 703066
RAW32 = 703062
RN_SUB = 703067
_BITPACK = [(w, 703030 + w) for w in range(1, 11)] + [(12, 703042), (16, 703046), (21, 703051), (32, 703062)]


def bit_class(span):
    """Smallest supported bit width holding values 0..span, and its compression class."""
    need = max(1, span.bit_length())
    for w, cls in _BITPACK:
        if w >= need:
            return w, cls
    raise ValueError('span too large')


def bitpack(values, width):
    per = 64 // width
    words = []
    for i in range(0, len(values), per):
        w = 0
        for j, v in enumerate(values[i:i + per]):
            w |= v << (j * width)
        words.append(w)
    if len(values) % per == 0:
        words.append(0)
    return words


def _tag(name):
    return f'<1:{name}\x00'.encode('ascii')


def _end(name):
    return f'{name}:1>\x00'.encode('ascii')


def _q(*v):
    return struct.pack('<' + 'Q' * len(v), *v)


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


def _idfx(idf, meta):
    return idf + meta + _q(len(meta))


def _bookmark_bits(n):
    return max(5, n.bit_length() + 2)


def column_idfx(ids, has_nulls):
    """Data column, one segment: null runs as RLE entries (id 2), everything else bit-packed."""
    n = len(ids)
    nonnull = [i for i in ids if i != NULL_ID]
    lo = min(nonnull) if nonnull else FIRST_ID
    hi = max(nonnull) if nonnull else FIRST_ID
    first = NULL_ID if has_nulls else lo  # bit-packed ids are stored relative to this
    width, scc = bit_class(hi - first)
    entries, packed, k = [], 0, 0
    while k < n:
        j = k
        is_null = ids[k] == NULL_ID
        while j < n and (ids[j] == NULL_ID) == is_null:
            j += 1
        if is_null:
            entries.append((NULL_ID, j - k))
        else:
            entries.append((0xFFFFFFFF - packed, j - k))
            packed += j - k
        k = j
    words = bitpack([i - first for i in nonnull], width) if nonnull else []
    slots = max(16, len(entries))
    prim = entries + [(0, 0)] * (slots - len(entries))
    idf = _q(len(prim)) + b''.join(struct.pack('<II', *e) for e in prim) + _q(len(words)) + (_q(*words) if words else b'')
    runs = sum(1 for e in entries if e[0] == NULL_ID)
    others = len(entries) - runs
    rle = (_bookmark_bits(n), 2 * slots, 2 * len(entries) + (2 if words else 0), 0)
    cs = _idfmeta_cs(n, 1, HYBRID_RLE, scc, rle, first, _ss(lo, hi, n, has_nulls, runs, others), len(nonnull))
    meta = _tag('CP') + _q(1) + cs + _end('CP') + _sdos([(0, slots, (8 + slots * 8, len(words)))])
    return _idfx(idf, meta)


def rownumber_idfx(n):
    prim = [(0xFFFFFFFF, n)] + [(0, 0)] * 15
    idf = _q(len(prim)) + b''.join(struct.pack('<II', *e) for e in prim) + _q(0)
    cs = _idfmeta_cs(n, 0, HYBRID_RLE, RN_SUB, (24, 32, 2, 0), FIRST_ID, _ss(FIRST_ID, n + 2, n, False, 0, 0), n)
    meta = _tag('CP') + _q(1) + cs + _end('CP') + _sdos([(0, 16, (8 + 16 * 8, 0))])
    return _idfx(idf, meta)


def raw32_idfx(values, per):
    """H$ hierarchy column: raw 32-bit segments of `per` records (per = distinct values of the column)."""
    chunks = [values[i:i + per] for i in range(0, len(values), per)] or [[]]
    idf, sdos, metas, off = b'', [], b'', 0
    ss = _ss(NULL_ID, NULL_ID, 0, False, 0, 0)
    for ch in chunks:
        v = list(ch) + [0] * (2 - len(ch) % 2 if len(ch) % 2 else 2)
        words = [v[i] | (v[i + 1] << 32) for i in range(0, len(v), 2)]
        sdos.append((off, len(words), None))
        idf += _q(len(words)) + _q(*words)
        off = len(idf)
        metas += _idfmeta_cs(len(ch), 0, RAW32, 1, None, 0, ss, None)
    meta = _tag('CP') + _q(len(chunks)) + metas + _end('CP') + _sdos(sdos)
    return _idfx(idf, meta)


def hierarchy(sort_keys, last_id):
    """sort_keys: {data_id: sortable key} incl. NULL_ID if present -> (pos_to_id, id_to_pos, records per segment)."""
    order = sorted(sort_keys, key=lambda i: sort_keys[i])
    distinct = len(order)
    total = last_id + 1
    pos_to_id = order + [0] * (total - distinct)
    id_to_pos = [0] * total
    id_to_pos[1] = distinct
    for p, i in enumerate(order):
        id_to_pos[i] = p
    return pos_to_id, id_to_pos, max(distinct, 1)


HASH_INFO = {'long': [-1, 8, 64, 6, -1, -1], 'real': [-1, 16, 64, 3, -1, -1], 'string': [0, 8, 64, 6, -1, -1]}
CURRENCY_SCALE = 10000  # fixed decimal: int64 of value * 10^4


def dictionary(kind, values):
    """values in data-id order (id 3 first)."""
    if kind == 'string':
        chars = ''.join(v + '\x00' for v in values)
        handles, off = b'', 0
        for v in values:
            handles += struct.pack('<II', off, 0)
            off += len(v) + 1
        buf = chars.encode('utf-16le')
        longest = max((len(v) for v in values), default=0)
        page = (_q(0) + b'\x00' + _q(0, len(values)) + b'\x00' + b'\xdd\xcc\xbb\xaa'
                + _q(0, len(chars), len(buf)) + buf + b'\xcd\xab\xcd\xab')
        body = _q(len(values)) + b'\x01' + _q(longest, 1) + page + _q(len(values)) + struct.pack('<I', 8) + handles
        return struct.pack('<i', 2) + struct.pack('<6i', *HASH_INFO['string']) + body
    if kind == 'long':
        small = all(-2**31 <= v < 2**31 for v in values)
        fmt, size = ('i', 4) if small else ('q', 8)
        data = struct.pack(f'<{len(values)}{fmt}', *values)
        return struct.pack('<i', 0) + struct.pack('<6i', *HASH_INFO['long']) + _q(len(values)) + struct.pack('<I', size) + data
    if kind == 'currency':
        data = struct.pack(f'<{len(values)}q', *values)
        return struct.pack('<i', 0) + struct.pack('<6i', *HASH_INFO['real']) + _q(len(values)) + struct.pack('<I', 8) + data
    data = struct.pack(f'<{len(values)}d', *values)
    return struct.pack('<i', 1) + struct.pack('<6i', *HASH_INFO['real']) + _q(len(values)) + struct.pack('<I', 8) + data


def raw32_single(values, first):
    """U$ user-hierarchy column: one raw 32-bit segment."""
    v = list(values) + [0] * (2 - len(values) % 2 if len(values) % 2 else 2)
    words = [v[i] | (v[i + 1] << 32) for i in range(0, len(v), 2)]
    idf = _q(len(words)) + _q(*words)
    cs = _idfmeta_cs(len(values), 0, RAW32, 1, None, first, _ss(NULL_ID, NULL_ID, 0, False, 0, 0), None)
    meta = _tag('CP') + _q(1) + cs + _end('CP') + _sdos([(0, len(words), None)])
    return _idfx(idf, meta)


def bitpacked_idfx(values):
    """R$ relationship INDEX column: pure bit-packing (no RLE), class 703030 + width."""
    width, cls = bit_class(max(values, default=0))
    words = bitpack(values, width)
    idf = _q(len(words)) + _q(*words)
    cs = _idfmeta_cs(len(values), 0, cls, 1, None, 0xFFFFFFFF, _ss(NULL_ID, NULL_ID, 0, False, 0, 0), None)
    meta = _tag('CP') + _q(1) + cs + _end('CP') + _sdos([(0, len(words), None)])
    return _idfx(idf, meta)


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
