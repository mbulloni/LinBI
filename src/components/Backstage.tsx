import { useStore } from '../store';
import { Icon } from './icons';

export function Backstage() {
  const s = useStore();
  if (!s.fileMenu) return null;
  const close = () => s.set({ fileMenu: false });
  return (
    <div className="backstage">
      <nav>
        <button className="back" onClick={close}>← </button>
        <button onClick={() => s.newReport()}>Nuovo</button>
        <button onClick={() => { close(); s.open(); }}>Apri report</button>
        <button onClick={() => s.save()}>Salva</button>
        <button onClick={() => s.save(true)}>Salva con nome</button>
        <button disabled>Ottieni dati</button>
        <button onClick={async () => { const f = await window.api.openFile('powerbi'); if (f) s.importPowerBI(f.path); }}>Importa da Power BI (.pbix, .pbit, .pbip)</button>
        <button onClick={() => s.exportPbit()} disabled={!s.tables.length}>Esporta modello Power BI (.pbit)</button>
        <button onClick={() => s.exportPbip()} disabled={!s.tables.length}>Salva come progetto Power BI (.pbip)</button>
        <button onClick={() => s.exportPdf()} disabled={!s.report.pages.some((p) => p.visuals.length)}>Esporta in PDF</button>
        <button onClick={() => s.set({ publishDialog: true, fileMenu: false })}>Pubblica</button>
        <div style={{ flex: 1 }} />
        <button disabled>Opzioni e impostazioni</button>
        <button onClick={() => window.api.win.close()}>Esci</button>
      </nav>
      <main>
        <h1>Buongiorno</h1>
        <div className="tiles">
          <button className="tile" onClick={() => s.newReport()}><Icon name="newPage" size={36} />Report vuoto</button>
          <button className="tile" onClick={() => { close(); s.open(); }}><Icon name="docs" size={36} />Apri report</button>
          <button className="tile" onClick={() => s.loadSample()}><Icon name="sample" size={36} />Dati di esempio</button>
          <button className="tile" onClick={() => s.openNavigator('any')}><Icon name="getData" size={36} />Ottieni dati</button>
          <button className="tile" onClick={async () => { const f = await window.api.openFile('powerbi'); if (f) s.importPowerBI(f.path); }}><Icon name="sample" size={36} />Apri file Power BI</button>
        </div>
      </main>
    </div>
  );
}
