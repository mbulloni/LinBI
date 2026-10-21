"""Generate o7 (parameters, calculation group, local date table + variation, inactive/both/m2m/date relationships)."""
import datetime, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite import model
from pbixwrite.abf import write_abf
db = json.load(open(sys.argv[1]))['createOrReplace']['database']
db['name'] = 'g7'
days = [datetime.datetime(2024, 1, 1) + datetime.timedelta(days=i) for i in range(366)]
data = {
    'F': {'K': [1, 2, 3, 4], 'P': [1, 2, 9, 1], 'Q': [10.0, 20.0, 30.0, 40.0],
          'D': [datetime.datetime(2024, 1, 5), datetime.datetime(2024, 2, 5), datetime.datetime(2024, 3, 5), None]},
    'Dm': {'P': [1, 2, 3], 'Name': ['uno', 'due', 'tre']},
    'T': {'Name': ['uno', 'uno', 'due'], 'Tag': ['x', 'y', 'x']},
    'LocalDateTable_1': {'Date': days, 'Year': [d.year for d in days], 'MonthNo': [d.month for d in days],
                         'Month': [d.strftime('%B') for d in days]},
    'CG': {'Voce': ['Corrente', 'Doppio'], 'Ordinal': [0, 1]},
}
db_id, files, dbxml = model.build(db, data, db_id='g7')
open(sys.argv[2], 'wb').write(write_abf(db_id, files, dbxml))
print('written', sys.argv[2], len(files), 'files')
