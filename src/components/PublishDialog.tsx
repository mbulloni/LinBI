import { useStore } from '../store';
import { Icon } from './icons';

/** "Pubblica": Power BI Service needs a real .pbix (VertiPaq data) and a Microsoft account, so LinBI
 *  offers the routes that do work: a template for Power BI Desktop, a Git/Fabric project, a PDF. */
export function PublishDialog() {
  const s = useStore();
  if (!s.publishDialog) return null;
  const close = () => s.set({ publishDialog: false });
  const go = (fn: () => void) => () => { close(); fn(); };
  const empty = !s.tables.length;
  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 640 }}>
        <div className="dh"><h2>Pubblica</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db pq-db">
          <div className="pq-error" style={{ margin: 0 }}>
            <Icon name="info" size={18} box={32} />
            <div>
              <b>Pubblicazione diretta su Power BI Service non disponibile</b>
              <div>Il servizio accetta solo file .pbix con i dati nel formato VertiPaq (compressione XPress9 proprietaria) e
                richiede l'accesso con un account Microsoft. Si può pubblicare il report in uno di questi modi:</div>
            </div>
          </div>
          <button className="publish-opt" disabled={empty} onClick={go(() => s.exportPbit())}>
            <Icon name="publish" size={28} box={32} />
            <span className="txt"><b>Modello Power BI (.pbit) → Power BI Desktop</b><span>Aprire il file in Power BI Desktop (Windows), aggiornare i dati e scegliere <i>Pubblica</i>.</span></span>
          </button>
          <button className="publish-opt" disabled={empty} onClick={go(() => s.exportPbip())}>
            <Icon name="docs" size={28} box={32} />
            <span className="txt"><b>Progetto Power BI (.pbip) → Git / Microsoft Fabric</b><span>Cartelle di testo con file <code>.platform</code>: caricarle in un repository Git collegato a un'area di lavoro Fabric (integrazione Git) per pubblicare report e modello semantico.</span></span>
          </button>
          <button className="publish-opt" disabled={!s.report.pages.some((p) => p.visuals.length)} onClick={go(() => s.exportPdf())}>
            <Icon name="newPage" size={28} box={32} />
            <span className="txt"><b>PDF da condividere</b><span>Un documento con tutte le pagine del report.</span></span>
          </button>
          <button className="publish-opt" onClick={go(() => s.save(true))}>
            <Icon name="save" size={28} />
            <span className="txt"><b>File LinBI (.lbix) con i dati</b><span>Chi ha LinBI può aprirlo senza accedere alle origini dati.</span></span>
          </button>
        </div>
        <div className="df"><button className="btn" onClick={close}>Chiudi</button></div>
      </div>
    </div>
  );
}
