"""Write the DataModel part of a .pbix for LinBI (run by electron/main.cjs with the pbixray venv python).

usage: write_pbix.py job.json
job = {"schema": <TMSL database from pbit.ts#buildModelSchema>, "tables": {name: parquet path}, "out": DataModel path,
       "monthNames": [12 names], "quarterPrefix": "Trim "}
Tables without data: LinBI's auto date tables (computed here from their Calendar expression) and measure-only tables.
"""
import datetime
import json
import os
import re
import sys

import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pbixwrite import model  # noqa: E402
from pbixwrite.abf import write_abf  # noqa: E402

CAL_MINMAX = re.compile(r"Calendar\(Date\(Year\(MIN\((.+?)\)\), 1, 1\), Date\(Year\(MAX\((.+?)\)\), 12, 31\)\)")
CAL_FIXED = re.compile(r"Calendar\(Date\((\d+),\s*(\d+),\s*(\d+)\),\s*Date\((\d+),\s*(\d+),\s*(\d+)\)\)")
COLREF = re.compile(r"^'?(.+?)'?\[(.+)\]$")


def text(v):
    return '\n'.join(v) if isinstance(v, list) else (v or '')


def read_parquet(path, columns):
    t = pq.read_table(path)
    out = {}
    for c in columns:
        if c not in t.column_names:
            raise ValueError(f'colonna mancante nei dati: {c}')
        out[c] = t.column(c).to_pylist()
    return out


def date_table(tom, expr, data, job):
    m = CAL_MINMAX.search(expr)
    if m:
        ref = COLREF.match(m.group(1).strip())
        values = [v for v in data.get(ref.group(1), {}).get(ref.group(2), []) if v is not None] if ref else []
        years = [v.year for v in values]
        y0, y1 = (min(years), max(years)) if years else (datetime.date.today().year,) * 2
        start, end = datetime.date(y0, 1, 1), datetime.date(y1, 12, 31)
    else:
        f = CAL_FIXED.search(expr)
        if not f:
            return None
        a = [int(x) for x in f.groups()]
        start, end = datetime.date(a[0], a[1], a[2]), datetime.date(a[3], a[4], a[5])
    days = [start + datetime.timedelta(days=i) for i in range((end - start).days + 1)]
    months = job.get('monthNames') or [datetime.date(2000, k, 1).strftime('%B') for k in range(1, 13)]
    qp = job.get('quarterPrefix', 'Qtr ')
    cols = {
        'Date': [datetime.datetime(d.year, d.month, d.day) for d in days],
        'Year': [d.year for d in days], 'MonthNo': [d.month for d in days], 'Month': [months[d.month - 1] for d in days],
        'QuarterNo': [(d.month + 2) // 3 for d in days], 'Quarter': [f'{qp}{(d.month + 2) // 3}' for d in days],
        'Day': [d.day for d in days],
    }
    return {c['name']: cols[c['name']] for c in tom['columns'] if c['name'] in cols}


def main():
    job = json.load(open(sys.argv[1], encoding='utf-8'))
    schema = job['schema']
    data = {}
    for t in schema['model']['tables']:
        path = job['tables'].get(t['name'])
        if path:
            data[t['name']] = read_parquet(path, [c['name'] for c in t.get('columns', [])])
    for t in schema['model']['tables']:
        if t['name'] in data:
            continue
        src = (t.get('partitions') or [{}])[0].get('source', {})
        if src.get('type') == 'calculated':
            d = date_table(t, text(src.get('expression')), data, job)
            if d is None:
                raise ValueError(f"dati mancanti per la tabella calcolata {t['name']}")
            data[t['name']] = d
    db_id, files, dbxml = model.build(schema, data)
    with open(job['out'], 'wb') as f:
        f.write(write_abf(db_id, files, dbxml))
    print(json.dumps({'ok': True, 'tables': len(data)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # message read by main.cjs
        print('ERRORE: ' + str(e), file=sys.stderr)
        raise
