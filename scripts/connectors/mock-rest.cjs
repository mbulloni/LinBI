// Mock of Azure Data Explorer (Kusto REST v1) and Dataverse Web API (OData v4) for the connector tests.
// node scripts/connectors/mock-rest.cjs 18090   then  LINBI_MS_TOKEN=x node scripts/connectors/test-driver.cjs ...
const http = require('http');
const rows = Array.from({ length: 12000 }, (_, i) => [i + 1, `Evento ${i + 1}`, new Date(Date.UTC(2024, 0, 1) + i * 60000).toISOString(), i % 5 ? i * 0.5 : null, i % 2 === 0, { k: i }]);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const send = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/rest/mgmt') return send({ Tables: [{ TableName: 'Table_0', Columns: [{ ColumnName: 'TableName', DataType: 'String' }, { ColumnName: 'DatabaseName', DataType: 'String' }], Rows: [['Eventi', 'Telemetria']] }] });
    if (req.url === '/v1/rest/query') {
      const take = /take (\d+)/.exec(JSON.parse(body).csl);
      return send({ Tables: [{ TableName: 'Table_0', Columns: [{ ColumnName: 'Id', DataType: 'Int64' }, { ColumnName: 'Nome', DataType: 'String' }, { ColumnName: 'Quando', DataType: 'DateTime' }, { ColumnName: 'Valore', DataType: 'Double' }, { ColumnName: 'Ok', DataType: 'Boolean' }, { ColumnName: 'Extra', DataType: 'Object' }],
        Rows: take ? rows.slice(0, +take[1]) : rows }] });
    }
    if (req.url.startsWith('/api/data/v9.2/EntityDefinitions')) return send({ value: [{ LogicalName: 'account', EntitySetName: 'accounts' }, { LogicalName: 'contact', EntitySetName: 'contacts' }] });
    const m = /^\/api\/data\/v9\.2\/accounts(?:\?\$top=(\d+))?(?:.*page=(\d+))?/.exec(req.url);
    if (m) {
      const page = +(m[2] || 0), size = 5000, total = m[1] ? +m[1] : 12000;
      const value = Array.from({ length: Math.max(0, Math.min(size, total - page * size)) }, (_, i) => { const k = page * size + i; return { '@odata.etag': 'W/"1"', accountid: `00000000-0000-0000-0000-${String(k).padStart(12, '0')}`, name: `Cliente ${k} città`, revenue: k % 4 ? k * 10.5 : null, createdon: new Date(Date.UTC(2023, 0, 1) + k * 3600000).toISOString(), 'revenue@OData.Community.Display.V1.FormattedValue': 'x' }; });
      return send({ value, ...((page + 1) * size < total ? { '@odata.nextLink': `http://localhost:${port}/api/data/v9.2/accounts?page=${page + 1}` } : {}) });
    }
    res.statusCode = 404; send({ error: { message: 'not found ' + req.url } });
  });
}).listen(+process.argv[2] || 18090);
const port = +process.argv[2] || 18090;
