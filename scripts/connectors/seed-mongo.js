// node scripts/connectors/seed-mongo.js mongodb://lettore:pw@localhost:27018/?authSource=admin
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(process.argv[2]); await c.connect();
  const db = c.db('negozio'); await db.collection('clienti').deleteMany({});
  const docs = Array.from({ length: 20000 }, (_, i) => ({ codice: i + 1, nome: `Cliente ${i + 1}`, citta: ['Milano', 'Roma', 'Città di Castello'][i % 3],
    indirizzo: { via: `Via ${i}`, cap: String(20100 + (i % 50)) }, saldo: i % 7 ? i * 2.5 : null, attivo: i % 2 === 0, iscritto: new Date(Date.UTC(2020, 0, 1 + (i % 1000))), tag: i % 5 ? ['a', 'b'] : [] }));
  await db.collection('clienti').insertMany(docs);
  console.log('clienti', await db.collection('clienti').countDocuments());
  await c.close();
})();
