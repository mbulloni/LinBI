const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r.error) throw new Error(r.error);
  return r.ok;
};

contextBridge.exposeInMainWorld('api', {
  query: (sql) => call('db:query', sql),
  preview: (file, sheet) => call('db:preview', file, sheet),
  importFile: (file, table, sheet) => call('db:import', file, table, sheet),
  dropTable: (table) => call('db:drop', table),
  materialize: (table, sql) => call('db:materialize', table, sql),
  sourceExpr: (source) => call('db:sourceExpr', source),
  dbConnect: (c, password, remember) => call('db:connect', c, password, remember),
  dbForget: (c) => call('db:forget', c),
  addCalcColumn: (table, column, expr, replace) => call('db:calcColumn', table, column, expr, replace),
  dropColumn: (table, column) => call('db:dropColumn', table, column),
  sampleData: () => call('data:sample'),
  openDataDialog: (kind) => call('dialog:openData', kind),
  saveFile: (content, path, embed) => call('file:save', content, path, embed),
  openFile: (kind) => call('file:open', kind),
  readText: (kind) => call('file:readText', kind),
  saveText: (content, defaultPath, kind) => call('file:saveText', content, defaultPath, kind),
  readPowerBI: (file) => call('pbix:read', file),
  savePbit: (parts, suggested) => call('pbit:save', parts, suggested),
  printPdf: (suggested) => call('pdf:print', suggested),
  savePbip: (parts, suggested) => call('pbip:save', parts, suggested),
  createEmptyTable: (table, columns) => call('db:createEmpty', table, columns),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    setTitle: (t) => ipcRenderer.send('win:title', t),
    onState: (cb) => {
      const listener = (_e, max) => cb(max);
      ipcRenderer.on('win:state', listener);
      return () => ipcRenderer.removeListener('win:state', listener);
    },
  },
});
