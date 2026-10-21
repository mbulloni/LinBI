"""2.5M-row fact table (3 segments, 300k distinct strings, nulls) with special-character names + dimension,
relationship, measure, hierarchy. Prints expected aggregates (pandas) to compare with DAX on the restored database."""
import os, sys, time
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite import model
from pbixwrite.abf import write_abf
n = 2_500_000
K = np.arange(1, n + 1)
F = 'Vendite / 2026: "q"'
D = 'Prodotti [€] è'
fact = pd.DataFrame({
    'K': K, 'P': K % 1000,
    'S': pd.Series([f'valore numero {k % 300000}' for k in K], dtype=object).where(K % 1000 != 0, None),
    'V': pd.Series(K * 0.5).where(K % 7 != 0, np.nan),
    'D': pd.Timestamp('2020-01-01') + pd.to_timedelta(K % 1500, unit='D'),
    'B': K % 2 == 0,
})
dim = pd.DataFrame({'P': np.arange(1000), 'Name': [f'Prodotto {p:03d}' for p in range(1000)], 'Cat': [chr(65 + p % 5) for p in range(1000)]})
col = lambda name, t: {'name': name, 'dataType': t, 'sourceColumn': name}
db = {'name': 'gbig', 'compatibilityLevel': 1550, 'model': {'culture': 'en-US', 'defaultPowerBIDataSourceVersion': 'powerBI_V3',
    'tables': [
        {'name': F, 'columns': [col('K', 'int64'), col('P', 'int64'), col('S', 'string'), col('V', 'double'), col('D', 'dateTime'), col('B', 'boolean')],
         'partitions': [{'name': 'Vendite-1', 'mode': 'import', 'source': {'type': 'm', 'expression': 'let Source = 1 in Source'}}],
         'measures': [{'name': 'Tot', 'expression': f"SUM('{F}'[V])"}]},
        {'name': D, 'columns': [col('P', 'int64'), col('Name', 'string'), col('Cat', 'string')],
         'partitions': [{'name': 'p', 'mode': 'import', 'source': {'type': 'm', 'expression': 'let Source = 1 in Source'}}],
         'hierarchies': [{'name': 'Cat › Name', 'levels': [{'name': 'Cat', 'ordinal': 0, 'column': 'Cat'}, {'name': 'Name', 'ordinal': 1, 'column': 'Name'}]}]}],
    'relationships': [{'name': 'a1b2-c3', 'fromTable': F, 'fromColumn': 'P', 'toTable': D, 'toColumn': 'P'}]}}
t = time.time()
data = {F: {c: fact[c] for c in fact}, D: {c: dim[c] for c in dim}}
db_id, files, dbxml = model.build(db, data, db_id='gbig')
abf = write_abf(db_id, files, dbxml)
open(sys.argv[1], 'wb').write(abf)
print('written', len(abf) // 1_000_000, 'MB in', round(time.time() - t, 1), 's')
fact['Cat'] = fact['P'].map(dim.set_index('P')['Cat'])
print('expected rows', n, 'sumV', round(fact['V'].sum(), 2), 'blankV', int(fact['V'].isna().sum()), 'distinctS', fact['S'].nunique(), 'blankS', int(fact['S'].isna().sum()),
      'trueB', int(fact['B'].sum()), 'minD', fact['D'].min().date(), 'maxD', fact['D'].max().date())
print(fact.groupby('Cat')['V'].sum().round(2).to_dict())
