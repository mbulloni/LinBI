"""Generate the o4 model (2 tables + relationship, measures, calculated column/table, hierarchy, role) from its TMSL."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'electron', 'pbix'))
from pbixwrite import model
from pbixwrite.abf import write_abf
db = json.load(open(sys.argv[1]))['createOrReplace']['database']
db['name'] = 'g4'
K = list(range(1, 301))
data = {
    'F': {'K': K, 'P': [k % 4 + 1 for k in K], 'Q': [k * 2.0 for k in K], 'Q2': [k * 20.0 for k in K]},
    'D': {'P': [1, 2, 3, 4, 5], 'Name': ['uno', 'due', 'tre', 'quattro', 'cinque'], 'Cat': ['A', 'A', 'B', 'B', 'C']},
    'CT': {'Cat': ['A', 'B'], 'S': [45150.0, 45150.0]},
}
db_id, files, dbxml = model.build(db, data, db_id='g4')
open(sys.argv[2], 'wb').write(write_abf(db_id, files, dbxml))
print('written', sys.argv[2], len(files), 'files')
