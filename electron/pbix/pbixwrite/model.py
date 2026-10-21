"""Build a tabular database (metadata.sqlitedb + VertiPaq files) from a TMSL database and its data.

build(database, data) where `database` is a TMSL database object ({"name", "compatibilityLevel", "model": {...}}, the
shape of a .pbit DataModelSchema / model.bim) and `data` = {table: {column: [values]}} for every import, calculated
table and calculated column (values already computed). Row templates (templates.json, template.sqlitedb) come from
databases written by the Analysis Services engine; every column is hash encoded (see vertipaq.py).
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import tempfile
import uuid

from . import vertipaq as V

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = json.load(open(os.path.join(HERE, 'templates.json')))
RN_NAME = 'RowNumber-2662979B-1795-4F74-8F37-6A1BA8059B61'
NEVER = 31240512000000000  # engine's "not refreshed" timestamp
OLE_EPOCH = datetime.datetime(1899, 12, 30)

# TOM dataType -> (DataType id, dictionary kind, DBType, XMType)
TYPES = {
    'string': (2, 'string', 130, 2),
    'int64': (6, 'long', 20, 0),
    'double': (8, 'real', 5, 1),
    'dateTime': (9, 'real', 7, 1),
    'decimal': (10, 'currency', 6, 0),
    'boolean': (11, 'long', 11, 0),
}
SUMMARIZE = {'default': 1, 'none': 2, 'sum': 3, 'min': 4, 'max': 5, 'count': 6, 'average': 7, 'distinctCount': 8}
OBJ = {'model': 1, 'table': 3, 'column': 4, 'partition': 6, 'relationship': 7, 'measure': 8, 'hierarchy': 9,
       'level': 10, 'role': 34, 'expression': 41}
CROSS = {'oneDirection': 1, 'bothDirections': 2, 'automatic': 3}
CARD = {'none': 0, 'one': 1, 'many': 2}
PERM = {'none': 1, 'read': 2, 'readRefresh': 3, 'refresh': 4, 'administrator': 5}


def _filetime(dt=None):
    dt = dt or datetime.datetime.utcnow()
    return int((dt - datetime.datetime(1601, 1, 1)).total_seconds() * 10_000_000)


def _text(v):
    """TMSL allows multi-line expressions as string arrays."""
    if isinstance(v, list):
        return '\n'.join(v)
    return v or ''


def _isnull(v):
    return v is None or (isinstance(v, float) and v != v)


def _ole(v):
    if isinstance(v, str):
        v = datetime.datetime.fromisoformat(v.replace('Z', ''))
    if isinstance(v, datetime.datetime):
        return (v - OLE_EPOCH).total_seconds() / 86400.0
    if isinstance(v, datetime.date):
        return float((v - OLE_EPOCH.date()).days)
    return float(v)


def _norm(v, typ):
    if typ in ('dateTime',):
        return _ole(v)
    if typ == 'double':
        return float(v)
    if typ == 'decimal':
        return int(round(float(v) * V.CURRENCY_SCALE))
    if typ == 'int64':
        return int(v)
    if typ == 'boolean':
        return 1 if (v is True or v in (1, 'true', 'True')) else 0
    return str(v)


def _fmt(v, typ):
    if typ == 'dateTime':
        d = OLE_EPOCH + datetime.timedelta(days=v)
        return f'{d.month}/{d.day}/{d.year}' + ('' if d.time() == datetime.time() else d.strftime(' %-I:%M:%S %p'))
    if typ == 'decimal':
        v = v / V.CURRENCY_SCALE
    if typ in ('double', 'decimal'):
        return str(int(v)) if v == int(v) else repr(v)
    if typ == 'boolean':
        return 'TRUE' if v else 'FALSE'
    return str(v)


class Encoded:
    """One column: per-row data ids, dictionary values in id order, null flag."""

    def __init__(self, typ, values):
        self.typ = typ
        self.ids, self.values, index = [], [], {}
        self.has_null = False
        for v in values:
            if _isnull(v):
                self.ids.append(V.NULL_ID)
                self.has_null = True
                continue
            v = _norm(v, typ)
            i = index.get(v)
            if i is None:
                i = index[v] = V.FIRST_ID + len(self.values)
                self.values.append(v)
            self.ids.append(i)
        self.index = index
        self.last = V.FIRST_ID + len(self.values) - 1

    def sort_keys(self, by=None):
        """{data id: key}; `by` = Encoded of the sort-by column (same rows)."""
        if by is None:
            keys = {i: (1, v) for v, i in self.index.items()}
        else:
            keys = {}
            for i, j in zip(self.ids, by.ids):
                if i not in keys and i != V.NULL_ID:
                    keys[i] = (1, by.values[j - V.FIRST_ID] if j != V.NULL_ID else None, i)
            keys = {i: (k[0], (0, 0) if k[1] is None else (1, k[1]), k[2]) for i, k in keys.items()}
        if self.has_null:
            keys[V.NULL_ID] = (0,)
        return keys


class Db:
    def __init__(self, path):
        self.con = sqlite3.connect(path)
        self.next = 10
        self.now = _filetime()

    def id(self):
        i = self.next
        self.next += 1
        return i

    def ins(self, table, tpl, **over):
        row = dict(TPL[tpl])
        for k, v in over.items():
            assert k in row, (tpl, k)
            row[k] = None if v == '' else v
        cols = ','.join(f'[{k}]' for k in row)
        self.con.execute(f'insert into [{table}] ({cols}) values ({",".join("?" * len(row))})', list(row.values()))
        return row['ID']

    def set(self, table, id_, **values):
        sets = ','.join(f'[{k}]=?' for k in values)
        self.con.execute(f'update [{table}] set {sets} where ID=?', list(values.values()) + [id_])


class Builder:
    def __init__(self, database, data):
        self.dbjson = database
        self.model = database.get('model', {})
        self.data = data
        self.tmp = tempfile.mkdtemp()
        self.meta = os.path.join(self.tmp, 'metadata.sqlitedb')
        shutil.copy(os.path.join(HERE, 'template.sqlitedb'), self.meta)
        self.db = Db(self.meta)
        self.files = []
        self.tables = {}   # name -> info dict
        self.origins = []  # (calculated table column id, 'Table[Column]' it comes from)
        self.rel_ids = {}
        self.hier_ids = {}

    # ---- helpers -------------------------------------------------------------------------------------------
    def annotations(self, obj, obj_id, kind):
        for a in obj.get('annotations', []):
            self.db.ins('Annotation', 'Annotation', ID=self.db.id(), ObjectID=obj_id, ObjectType=OBJ[kind],
                        Name=a['name'], Value=_text(a.get('value')), ModifiedTime=self.db.now)

    def folder(self, owner, owner_type, path):
        fid = self.db.id()
        self.db.ins('StorageFolder', 'StorageFolder', ID=fid, OwnerID=owner, OwnerType=owner_type, Path=path)
        return fid

    def file(self, owner, owner_type, folder_id, folder_path, name, data):
        fid = self.db.id()
        self.db.ins('StorageFile', 'StorageFile', ID=fid, OwnerID=owner, OwnerType=owner_type, StorageFolderID=folder_id, FileName=name)
        self.files.append((f'{folder_path}\\{name}', data))
        return fid

    def system_table(self, kind, name, tpl_table, tpl_ts, tpl_part, tpl_smap, records, columns):
        """H$/R$/U$ table: columns = [(name, column tpl, columnstorage tpl, idfx bytes, records per segment)]."""
        db, now = self.db, self.db.now
        tid, ts, pid, ps, sm = db.id(), db.id(), db.id(), db.id(), db.id()
        db.ins('Table', tpl_table, ID=tid, Name=name, TableStorageID=ts, ModifiedTime=now, StructureModifiedTime=now)
        tfolder = f'{name}$({tid}).tbl'
        tf = self.folder(ts, 18, tfolder)
        db.ins('TableStorage', tpl_ts, ID=ts, TableID=tid, Name=name, StorageFolderID=tf)
        db.ins('Partition', tpl_part, ID=pid, TableID=tid, Name=name, PartitionStorageID=ps, ModifiedTime=now)
        pfolder = f'{tfolder}\\{pid}.prt'
        pf = self.folder(ps, 20, pfolder)
        db.ins('PartitionStorage', 'PartitionStorage', ID=ps, PartitionID=pid, Name=name, SegmentMapStorageID=sm, StorageFolderID=pf)
        smap = {'RecordCount': records[0], 'SegmentCount': records[1], 'RecordsPerSegment': records[2]}
        db.ins('SegmentMapStorage', tpl_smap, ID=sm, PartitionStorageID=ps, **smap)
        for pos, (cname, ctpl, cstpl, data, segs) in enumerate(columns):
            col, cs, ds, cps, seg = db.id(), db.id(), db.id(), db.id(), db.id()
            db.ins('Column', ctpl, ID=col, TableID=tid, ExplicitName=cname, ColumnStorageID=cs,
                   ModifiedTime=now, StructureModifiedTime=now, RefreshedTime=NEVER)
            over = {'Settings': 7 if pos == 0 else 5} if ctpl == 'Column_H' else {}
            db.ins('ColumnStorage', cstpl, ID=cs, ColumnID=col, Name=cname, StoragePosition=pos, DictionaryStorageID=ds, **over)
            db.ins('DictionaryStorage', 'DictionaryStorage_H', ID=ds, ColumnStorageID=cs)
            f = self.file(cps, 23, pf, pfolder, f'0.{name}.{cname}.0.idfx', data)
            db.ins('ColumnPartitionStorage', 'ColumnPartitionStorage_H', ID=cps, ColumnStorageID=cs, PartitionStorageID=ps,
                   SegmentStorageID=seg, StorageFileID=f)
            db.ins('SegmentStorage', 'SegmentStorage_H', ID=seg, ColumnPartitionStorageID=cps, SegmentCount=segs)
        return tid

    # ---- tables --------------------------------------------------------------------------------------------
    def table(self, t):
        db, now = self.db, self.db.now
        name = t['name']
        part = (t.get('partitions') or [{}])[0]
        src = part.get('source', {})
        calc_table = src.get('type') == 'calculated'
        calc_group = 'calculationGroup' in t
        cols = [c for c in t.get('columns', []) if c.get('type') != 'rowNumber']
        values = self.data.get(name, {})
        n = len(next(iter(values.values()))) if values else 0
        if not values:
            values = {c['name']: [] for c in cols}
        # free row order inside a segment: group rows by null pattern so null runs stay few
        order = sorted(range(n), key=lambda r: tuple(not _isnull(values.get(c['name'], [None] * n)[r]) for c in cols))
        enc = {}
        for c in cols:
            vals = values.get(c['name'])
            if vals is None or len(vals) != n:
                raise ValueError(f"missing data for {name}[{c['name']}]")
            enc[c['name']] = Encoded(c.get('dataType', 'string'), [vals[r] for r in order])

        tid = db.id()
        tname = f'{name} ({tid})'
        info = {'id': tid, 'tname': tname, 'cols': {}, 'enc': enc, 'n': n, 'json': t}
        self.tables[name] = info
        rn_id, rn_ah = db.id(), db.id()
        col_ids = {c['name']: (db.id(), db.id()) for c in cols}
        for c in cols:
            info['cols'][c['name']] = col_ids[c['name']][0]
        pid = db.id()
        ts_id, ps_id, smap_id = db.id(), db.id(), db.id()
        db.ins('Table', 'Table_CT' if calc_table else ('Table_CG' if calc_group else 'Table'), ID=tid, CalculationGroupID=0, Name=name, TableStorageID=ts_id,
               ModifiedTime=now, StructureModifiedTime=now, IsHidden=1 if t.get('isHidden') else 0,
               Description=_text(t.get('description')), LineageTag=t.get('lineageTag', ''),
               IsPrivate=1 if t.get('isPrivate') else 0, ShowAsVariationsOnly=1 if t.get('showAsVariationsOnly') else 0)
        self.annotations(t, tid, 'table')
        mode = {'import': 0, 'directQuery': 1, 'default': 2}.get(part.get('mode', 'import'), 0)
        db.ins('Partition', 'Partition_CT' if calc_table else ('Partition_CG' if calc_group else 'Partition'), ID=pid, TableID=tid,
               Name=part.get('name', name), QueryDefinition=_text(src.get('expression')),
               PartitionStorageID=ps_id, ModifiedTime=now, RefreshedTime=now, Mode=mode)
        tfolder = f'{tname}.tbl'
        pfolder = f'{tfolder}\\{pid}.prt'
        tf_id = self.folder(ts_id, 18, tfolder)
        db.ins('TableStorage', 'TableStorage', ID=ts_id, TableID=tid, Name=tname, StorageFolderID=tf_id)
        pf_id = self.folder(ps_id, 20, pfolder)
        db.ins('PartitionStorage', 'PartitionStorage', ID=ps_id, PartitionID=pid, Name=f"{part.get('name', name)} ({pid})",
               SegmentMapStorageID=smap_id, StorageFolderID=pf_id)
        db.ins('SegmentMapStorage', 'SegmentMapStorage', ID=smap_id, PartitionStorageID=ps_id, RecordCount=n,
               SegmentCount=1, RecordsPerSegment=n)
        info.update(tf_id=tf_id, tfolder=tfolder, pf_id=pf_id, pfolder=pfolder, ps_id=ps_id)

        # RowNumber
        self.column_storage(info, rn_id, rn_ah, RN_NAME.replace('-', ' '), 0, V.rownumber_idfx(n),
                            ctpl='Column_RN_CT' if calc_table else 'Column_RN', cover={'ExplicitName': RN_NAME},
                            cstpl='ColumnStorage_RN', dstpl='DictionaryStorage_RN', ahtpl='AttributeHierarchy_RN',
                            ahstpl='AttributeHierarchyStorage_RN',
                            ahs_over={'DistinctDataCount': n, 'MinValue': '0', 'MaxValue': str(max(n - 1, 0))},
                            cs_over={'Statistics_DistinctStates': n, 'Statistics_MaxDataID': n + 2, 'Statistics_RowCount': n})
        for pos, c in enumerate(cols, start=1):
            self.data_column(info, c, pos, *col_ids[c['name']], calc_table)
        if calc_group:
            cg = t['calculationGroup']
            cgid = db.id()
            db.ins('CalculationGroup', 'CalculationGroup', ID=cgid, TableID=tid, Description=_text(cg.get('description')),
                   Precedence=cg.get('precedence', 0), ModifiedTime=now)
            db.set('Table', tid, CalculationGroupID=cgid)
            for k, it in enumerate(cg.get('calculationItems', [])):
                iid = db.id()
                fsd = self.format_string_definition(it, iid, 47)
                db.ins('CalculationItem', 'CalculationItem', ID=iid, CalculationGroupID=cgid, FormatStringDefinitionID=fsd,
                       Name=it['name'], Description=_text(it.get('description')), Expression=_text(it.get('expression')),
                       Ordinal=it.get('ordinal', k), ModifiedTime=now)
        return info

    def format_string_definition(self, obj, obj_id, obj_type):
        fs = obj.get('formatStringDefinition')
        if not fs:
            return 0
        fid = self.db.id()
        self.db.ins('FormatStringDefinition', 'FormatStringDefinition', ID=fid, ObjectID=obj_id, ObjectType=obj_type,
                    Expression=_text(fs.get('expression')), ModifiedTime=self.db.now)
        return fid

    def column_storage(self, info, col_id, ah_id, csname, pos, idfx, ctpl, cover, cstpl, dstpl, ahtpl, ahstpl,
                       ahs_over, cs_over, ds_over=None):
        db, now = self.db, self.db.now
        cs_id, ds_id, cps_id, seg_id, ahs_id = db.id(), db.id(), db.id(), db.id(), db.id()
        db.ins('Column', ctpl, ID=col_id, TableID=info['id'], ColumnStorageID=cs_id, AttributeHierarchyID=ah_id,
               ModifiedTime=now, StructureModifiedTime=now, RefreshedTime=NEVER, **cover)
        db.ins('AttributeHierarchy', ahtpl, ID=ah_id, ColumnID=col_id, AttributeHierarchyStorageID=ahs_id,
               ModifiedTime=now, RefreshedTime=now)
        db.ins('ColumnStorage', cstpl, ID=cs_id, ColumnID=col_id, Name=csname, StoragePosition=pos,
               DictionaryStorageID=ds_id, Locale=1033, **cs_over)
        if info['n'] == 0:
            # empty table: the engine keeps the old separate .idf/.idfmeta files (meta owned by the segment storage)
            idf, idfmeta = V.empty_column(rownumber=pos == 0)
            f_id = self.file(cps_id, 23, info['pf_id'], info['pfolder'], f"1.{info['tname']}.{csname}.0.idf", idf)
            m_id = self.file(seg_id, 24, info['pf_id'], info['pfolder'], f"1.{info['tname']}.{csname}.0.idfmeta", idfmeta)
        else:
            f_id = self.file(cps_id, 23, info['pf_id'], info['pfolder'], f"1.{info['tname']}.{csname}.0.idfx", idfx)
            m_id = 0
        db.ins('ColumnPartitionStorage', 'ColumnPartitionStorage', ID=cps_id, ColumnStorageID=cs_id,
               PartitionStorageID=info['ps_id'], SegmentStorageID=seg_id, StorageFileID=f_id)
        db.ins('SegmentStorage', 'SegmentStorage', ID=seg_id, ColumnPartitionStorageID=cps_id, StorageFileID=m_id)
        if info['n'] == 0:
            db.set('ColumnStorage', cs_id, Statistics_DistinctStates=1, Statistics_MinDataID=2, Statistics_MaxDataID=2, Statistics_RowCount=0)
            db.set('AttributeHierarchyStorage', ahs_id, MaterializationType=2, DistinctDataCount=0, SystemTableID=0, MinValue=None, MaxValue=None)
        db.ins('DictionaryStorage', dstpl, ID=ds_id, ColumnStorageID=cs_id, **(ds_over or {}))
        db.ins('AttributeHierarchyStorage', ahstpl, ID=ahs_id, AttributeHierarchyID=ah_id, **ahs_over)
        return cs_id, ds_id, ahs_id

    def data_column(self, info, c, pos, col_id, ah_id, calc_table):
        db = self.db
        typ = c.get('dataType', 'string')
        edt, kind, dbtype, xmtype = TYPES[typ]
        e = info['enc'][c['name']]
        vals = e.values
        dict_bytes = V.dictionary(kind, vals)
        small = kind == 'long' and typ != 'decimal' and all(-2**31 <= v < 2**31 for v in vals)
        ctype = c.get('type', 'data')
        is_calc_col = ctype == 'calculated'
        is_ct_col = ctype == 'calculatedTableColumn'
        csname = f"{c['name']} ({col_id})"
        cover = {
            'ExplicitName': '' if c.get('isNameInferred') else c['name'],
            'InferredName': c['name'] if c.get('isNameInferred') else '',
            'ExplicitDataType': 1 if c.get('isDataTypeInferred') else edt,
            'InferredDataType': edt if (c.get('isDataTypeInferred') or is_calc_col) else 19,
            'IsHidden': 1 if c.get('isHidden') else 0,
            'FormatString': c.get('formatString', ''),
            'SummarizeBy': SUMMARIZE.get(c.get('summarizeBy', 'default'), 1),
            'DataCategory': c.get('dataCategory', ''),
            'Description': _text(c.get('description')),
            'DisplayFolder': c.get('displayFolder', ''),
            'IsKey': 1 if c.get('isKey') else 0,
            'LineageTag': c.get('lineageTag', ''),
            'SourceColumn': '' if is_calc_col else c.get('sourceColumn', c['name']),
            'Expression': _text(c.get('expression')) if is_calc_col else '',
            'EncodingHint': 1,
            'ColumnOriginID': 0,
        }
        if is_ct_col:
            self.origins.append((col_id, c.get('sourceColumn', '')))
        ctpl = ('Column_CC_CT' if calc_table else 'Column_CC') if is_calc_col else ('Column_CTC' if is_ct_col else 'Column')
        nonnull = sorted(vals)
        info.setdefault('pending_sort', []).append((col_id, c.get('sortByColumn')))
        cs_id, ds_id, ahs_id = self.column_storage(
            info, col_id, ah_id, csname, pos, V.column_idfx(e.ids, e.has_null), ctpl=ctpl, cover=cover,
            cstpl='ColumnStorage_CC' if is_calc_col else 'ColumnStorage', dstpl='DictionaryStorage',
            ahtpl='AttributeHierarchy', ahstpl='AttributeHierarchyStorage',
            ahs_over={'DistinctDataCount': len(vals) + (1 if e.has_null else 0), 'SystemTableID': 0,
                      'StringValueMaxLength': max((len(v) for v in vals), default=0) if kind == 'string' else 0},
            cs_over={'Statistics_DistinctStates': len(vals), 'Statistics_MaxDataID': e.last, 'Statistics_RowCount': info['n'],
                     'Statistics_HasNulls': 1 if e.has_null else 0, 'Statistics_RLERuns': 0,
                     'Statistics_DBType': dbtype, 'Statistics_XMType': xmtype},
            ds_over={'DataType': {9: 8, 10: 6, 11: 6}.get(edt, edt), 'LastId': e.last, 'IsNullable': 1 if e.has_null else 0,
                     'IsOperatingOn32': 1 if small else 0, 'DictionaryFlags': 3 if kind == 'string' else 0,
                     'Size': len(dict_bytes)})
        info.setdefault('storage', {})[c['name']] = (cs_id, ds_id, ahs_id, csname)
        self.annotations(c, col_id, 'column')
        if info['n'] == 0:
            db.set('DictionaryStorage', ds_id, LastId=2, Size=16904 if kind == 'string' else 144)
            return
        df_id = self.file(ds_id, 22, info['tf_id'], info['tfolder'], f"1.{info['tname']}.{csname}.dictionary", dict_bytes)
        db.set('DictionaryStorage', ds_id, StorageFileID=df_id)

    def finish_table(self, info):
        """Sort-by ids, min/max, H$ attribute hierarchy tables (need every column of the table encoded)."""
        db = self.db
        t = info['json']
        for col_id, sort_by in info.get('pending_sort', []):
            if sort_by:
                db.set('Column', col_id, SortByColumnID=info['cols'][sort_by])
        if info['n'] == 0:
            info['keys'] = {c: {} for c in info['enc']}
            return
        for c in [c for c in t.get('columns', []) if c.get('type') != 'rowNumber']:
            e = info['enc'][c['name']]
            by = info['enc'].get(c.get('sortByColumn')) if c.get('sortByColumn') else None
            keys = e.sort_keys(by)
            ordered = [i for i in sorted(keys, key=lambda i: keys[i]) if i != V.NULL_ID]
            cs_id, ds_id, ahs_id, csname = info['storage'][c['name']]
            typ = c.get('dataType', 'string')
            if ordered:
                db.set('AttributeHierarchyStorage', ahs_id, MinValue=_fmt(e.values[ordered[0] - V.FIRST_ID], typ),
                       MaxValue=_fmt(e.values[ordered[-1] - V.FIRST_ID], typ))
            pos_to_id, id_to_pos, per = V.hierarchy(keys, e.last)
            segs = -(-(e.last + 1) // per)
            hname = f"H${info['tname']}${csname}"
            hid = self.system_table('H', hname, 'Table_H', 'TableStorage_H', 'Partition_H', 'SegmentMapStorage_H',
                                    (e.last + 1, segs, per),
                                    [('POS_TO_ID', 'Column_H', 'ColumnStorage_H', V.raw32_idfx(pos_to_id, per), segs),
                                     ('ID_TO_POS', 'Column_H', 'ColumnStorage_H', V.raw32_idfx(id_to_pos, per), segs)])
            db.set('AttributeHierarchyStorage', ahs_id, SystemTableID=hid)
            info.setdefault('keys', {})[c['name']] = keys

    def measures(self, info):
        db, now = self.db, self.db.now
        for m in info['json'].get('measures', []):
            mid = db.id()
            db.ins('Measure', 'Measure', ID=mid, TableID=info['id'], Name=m['name'], Expression=_text(m.get('expression')),
                   FormatString=m.get('formatString', ''), IsHidden=1 if m.get('isHidden') else 0,
                   Description=_text(m.get('description')), DisplayFolder=m.get('displayFolder', ''),
                   DataCategory=m.get('dataCategory', ''), LineageTag=m.get('lineageTag', ''),
                   ModifiedTime=now, StructureModifiedTime=now)
            fsd = self.format_string_definition(m, mid, 8)
            if fsd:
                db.set('Measure', mid, FormatStringDefinitionID=fsd)
            self.annotations(m, mid, 'measure')

    def hierarchies(self, info):
        db, now = self.db, self.db.now
        for h in info['json'].get('hierarchies', []):
            levels = [lv for lv in sorted(h['levels'], key=lambda lv: lv.get('ordinal', 0)) if lv.get('column') in info['cols']]
            if not levels:
                continue  # every level points at a column the table does not have
            hid = db.id()
            hs = db.id()
            db.ins('Hierarchy', 'Hierarchy', ID=hid, TableID=info['id'], Name=h['name'], HierarchyStorageID=hs,
                   IsHidden=1 if h.get('isHidden') else 0, DisplayFolder=h.get('displayFolder', ''),
                   Description=_text(h.get('description')), LineageTag=h.get('lineageTag', ''),
                   ModifiedTime=now, StructureModifiedTime=now, RefreshedTime=now)
            self.annotations(h, hid, 'hierarchy')
            self.hier_ids[(info['json']['name'], h['name'])] = hid
            for k, lv in enumerate(levels):
                lid = db.id()
                db.ins('Level', 'Level', ID=lid, HierarchyID=hid, Ordinal=k, Name=lv['name'],
                       ColumnID=info['cols'][lv['column']], LineageTag=lv.get('lineageTag', ''), ModifiedTime=now)
            # members level by level, children grouped under their parent in parent order
            encs = [info['enc'][lv['column']] for lv in levels]
            keys = [info['keys'][lv['column']] for lv in levels]
            paths = sorted({tuple(e.ids[r] for e in encs) for r in range(info['n'])})
            members, pos_of, starts = [], {}, []
            for depth in range(len(levels)):
                starts.append(len(members))
                prefixes = {p[:depth + 1] for p in paths}
                parent_pos = (lambda pre: pos_of[pre[:-1]]) if depth else (lambda pre: 0)
                for pre in sorted(prefixes, key=lambda pre: (parent_pos(pre), keys[depth][pre[-1]])):
                    members.append(pre)
                    pos_of[pre] = len(members)          # 1-based
            first_child, child_count = {}, {}
            for pre in members:
                if len(pre) > 1:
                    par = pre[:-1]
                    first_child.setdefault(par, pos_of[pre])
                    child_count[par] = child_count.get(par, 0) + 1
            mlid = [pre[-1] for pre in members]
            parent = [pos_of[pre[:-1]] if len(pre) > 1 else 0 for pre in members]
            fcp = [first_child.get(pre, 0) for pre in members]
            cc = [child_count[pre] + 1 if pre in child_count else 0 for pre in members]
            n = len(members)
            uname = f"U${info['tname']}${h['name']} ({hid})"
            cols = [(c, 'Column_U_' + c, 'ColumnStorage_U_' + c, V.raw32_single(vals, first), 1)
                    for c, vals, first in (('MULTI_LEVEL_ID', mlid, 0), ('PARENT_POS', parent, 0xFFFFFFFF),
                                           ('FIRST_CHILD_POS', fcp, 0xFFFFFFFF), ('CHILD_COUNT', cc, 0xFFFFFFFF))]
            uid = self.system_table('U', uname, 'Table_U', 'TableStorage_U', 'Partition_U', 'SegmentMapStorage_U', (n, 1, n), cols)
            cs_names = [info['storage'][lv['column']][3] for lv in levels]
            leveldef = '$' + ''.join(f'{nm}${s}$' for nm, s in zip(cs_names, starts))
            db.ins('HierarchyStorage', 'HierarchyStorage', ID=hs, HierarchyID=hid, Name=f"{h['name']} ({hid})",
                   LevelDefinition=leveldef, SystemTableID=uid)

    def relationships(self):
        db, now = self.db, self.db.now
        for r in self.model.get('relationships', []):
            if r['fromTable'] not in self.tables or r['toTable'] not in self.tables:
                raise ValueError(f"relazione {r['fromTable']} → {r['toTable']}: tabella mancante")
            ft, tt = self.tables[r['fromTable']], self.tables[r['toTable']]
            for tb, col in ((ft, r['fromColumn']), (tt, r['toColumn'])):
                if col not in tb['cols']:
                    raise ValueError(f"relazione: colonna {tb['json']['name']}[{col}] mancante")
            fe, te = ft['enc'][r['fromColumn']], tt['enc'][r['toColumn']]
            rid, rs, ris = db.id(), db.id(), db.id()
            db.ins('Relationship', 'Relationship', ID=rid, Name=r.get('name', str(uuid.uuid4())),
                   IsActive=0 if r.get('isActive') is False else 1,
                   CrossFilteringBehavior=CROSS.get(r.get('crossFilteringBehavior', 'oneDirection'), 1),
                   JoinOnDateBehavior=2 if r.get('joinOnDateBehavior') == 'datePartOnly' else 1,
                   FromTableID=ft['id'], FromColumnID=ft['cols'][r['fromColumn']],
                   FromCardinality=CARD[r.get('fromCardinality', 'many')],
                   ToTableID=tt['id'], ToColumnID=tt['cols'][r['toColumn']],
                   ToCardinality=CARD[r.get('toCardinality', 'one')],
                   SecurityFilteringBehavior=2 if r.get('securityFilteringBehavior') == 'bothDirections' else 1,
                   RelationshipStorageID=rs, ModifiedTime=now, RefreshedTime=now)
            self.annotations(r, rid, 'relationship')
            self.rel_ids[r.get('name')] = rid
            if r.get('fromCardinality', 'many') == 'many' and r.get('toCardinality', 'one') == 'many':
                db.set('Relationship', rid, RelationshipStorageID=0, RefreshedTime=NEVER)
                continue  # many-to-many: resolved at query time, no index
            date_only = r.get('joinOnDateBehavior') == 'datePartOnly'
            key = (lambda v: float(int(v))) if date_only else (lambda v: v)
            # INDEX: data id of the from column -> row of the to table + 1 (0 = no match / blank)
            row_of = {}
            for row, i in enumerate(te.ids):
                if i != V.NULL_ID:
                    row_of.setdefault(key(te.values[i - V.FIRST_ID]), row + 1)
            index = [0] * (fe.last + 1)
            for v, i in fe.index.items():
                index[i] = row_of.get(key(v), 0)
            unmatched = fe.has_null or any(index[i] == 0 for i in fe.index.values())
            rname = f"R${ft['tname']}${r.get('name')} ({rid})"
            rtid = self.system_table('R', rname, 'Table_R', 'TableStorage_R', 'Partition_R', 'SegmentMapStorage_R',
                                     (len(index), 1, len(index)),
                                     [('INDEX', 'Column_R', 'ColumnStorage_R', V.bitpacked_idfx(index), 1)])
            db.ins('RelationshipStorage', 'RelationshipStorage', ID=rs, RelationshipID=rid, Name=f"{r.get('name')} ({rid})",
                   DefinitionType=2 if date_only else 0, RelationshipIndexStorageID=ris)
            db.ins('RelationshipIndexStorage', 'RelationshipIndexStorage', ID=ris, RelationshipStorageID=rs,
                   RecordCount=len(index), SystemTableID=rtid, Flags=1 if unmatched else 0)
            # the one side is unique
            db.set('DictionaryStorage', tt['storage'][r['toColumn']][1], IsUnique=1)

    def variations(self):
        for info in self.tables.values():
            for c in info['json'].get('columns', []):
                for v in c.get('variations', []):
                    dh = v.get('defaultHierarchy') or {}
                    hid = self.hier_ids.get((dh.get('table'), dh.get('hierarchy')), 0)
                    dcol = v.get('defaultColumn') or {}
                    cid = self.tables[dcol['table']]['cols'].get(dcol.get('column'), 0) if dcol.get('table') in self.tables else 0
                    self.db.ins('Variation', 'Variation', ID=self.db.id(), ColumnID=info['cols'][c['name']], Name=v.get('name', 'Variation'),
                                Description=_text(v.get('description')), RelationshipID=self.rel_ids.get(v.get('relationship'), 0),
                                DefaultHierarchyID=hid, DefaultColumnID=cid, IsDefault=1 if v.get('isDefault') else 0)

    def expressions(self):
        kinds = {'m': 0, 'calculated': 1}
        for e in self.model.get('expressions', []):
            eid = self.db.id()
            self.db.ins('Expression', 'Expression', ID=eid, Name=e['name'], Description=_text(e.get('description')),
                        Kind=kinds.get(e.get('kind', 'm'), 0), Expression=_text(e.get('expression')),
                        LineageTag=e.get('lineageTag', ''), ModifiedTime=self.db.now)
            self.annotations(e, eid, 'expression')

    def roles(self):
        db, now = self.db, self.db.now
        for role in self.model.get('roles', []):
            rid = db.id()
            db.ins('Role', 'Role', ID=rid, Name=role['name'], Description=_text(role.get('description')),
                   ModelPermission=PERM.get(role.get('modelPermission', 'read'), 2), ModifiedTime=now)
            self.annotations(role, rid, 'role')
            for tp in role.get('tablePermissions', []):
                db.ins('TablePermission', 'TablePermission', ID=db.id(), RoleID=rid, TableID=self.tables[tp['name']]['id'],
                       FilterExpression=_text(tp.get('filterExpression')), ModifiedTime=now)

    def build(self):
        db, now = self.db, self.db.now
        m = self.model
        db.ins('Model', 'Model', Culture=m.get('culture', 'en-US'), ModifiedTime=now, StructureModifiedTime=now,
               DiscourageImplicitMeasures=1 if m.get('discourageImplicitMeasures') else 0,
               SourceQueryCulture=m.get('sourceQueryCulture', ''))
        self.annotations(m, 1, 'model')
        infos = [self.table(t) for t in m.get('tables', [])]
        for info in infos:
            self.finish_table(info)
            self.measures(info)
            self.hierarchies(info)
        for col_id, src in self.origins:
            m = re.fullmatch(r"'?(.+?)'?\[(.+)\]", src or '')
            if m and m.group(1) in self.tables and m.group(2) in self.tables[m.group(1)]['cols']:
                db.set('Column', col_id, ColumnOriginID=self.tables[m.group(1)]['cols'][m.group(2)])
        self.relationships()
        self.variations()
        self.expressions()
        self.roles()
        db.con.execute("update DBPROPERTIES set VALUE=? where NAME='MAXID'", (db.next,))
        for k in ('LASTCUBEDATACHANGE', 'LASTCUBESCHEMACHANGE', 'LASTCOMMITTED', 'LASTMETADATACHANGEFORSYNCCOMMITTED'):
            db.con.execute('update DBPROPERTIES set VALUE=? where NAME=?', (now, k))
        db.con.commit()
        db.con.close()
        self.files.append(('metadata.sqlitedb', open(self.meta, 'rb').read()))
        shutil.rmtree(self.tmp)
        return self.files


def build(database, data, db_id=None):
    """-> (db_id, [(relative path, bytes)] incl. 0.CryptKey.bin and metadata.sqlitedb, db.xml bytes)"""
    files = Builder(database, data).build()
    files.insert(0, ('0.CryptKey.bin', open(os.path.join(HERE, 'CryptKey.bin'), 'rb').read()))
    db_id = db_id or str(uuid.uuid4())
    return db_id, files, db_xml(db_id, database.get('name', db_id), database.get('compatibilityLevel', 1550))


def db_xml(db_id, name, compat):
    tpl = open(os.path.join(HERE, 'db.xml'), 'rb').read().decode('utf-8')
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')
    esc = name.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    tpl = re.sub(r'<Name>[^<]*</Name>', lambda _: f'<Name>{esc}</Name>', tpl, count=1)
    tpl = re.sub(r'<ID>[^<]*</ID>', lambda _: f'<ID>{db_id}</ID>', tpl, count=1)
    tpl = re.sub(r'<CreatedTimestamp>[^<]*<', f'<CreatedTimestamp>{ts}<', tpl)
    tpl = re.sub(r'<LastSchemaUpdate>[^<]*<', f'<LastSchemaUpdate>{ts}<', tpl)
    tpl = re.sub(r'<ObjectID>[^<]*<', f'<ObjectID>{str(uuid.uuid4()).upper()}<', tpl)
    tpl = re.sub(r'<ddl800:DbUniqueId>[^<]*<', f'<ddl800:DbUniqueId>{str(uuid.uuid4()).upper()}<', tpl)
    tpl = re.sub(r'<ddl200:CompatibilityLevel>[^<]*<', f'<ddl200:CompatibilityLevel>{compat}<', tpl)
    return tpl.encode('utf-8')
