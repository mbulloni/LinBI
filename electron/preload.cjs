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
  sourceExpr: (file, sheet) => call('db:sourceExpr', file, sheet),
  sampleData: () => call('data:sample'),
  openDataDialog: (kind) => call('dialog:openData', kind),
  saveFile: (content, path) => call('file:save', content, path),
  openFile: (kind) => call('file:open', kind),
  readPowerBI: (file) => call('pbix:read', file),
  savePbit: (parts, suggested) => call('pbit:save', parts, suggested),
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
