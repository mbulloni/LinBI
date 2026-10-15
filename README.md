# LinBI

Clone **educativo** di Power BI Desktop per Linux: stessa struttura dell'interfaccia
(ribbon, viste Report/Tabella/Modello, riquadri Filtri · Visualizzazioni · Dati) e
stesso flusso di lavoro (Ottieni dati → Strumento di navigazione → trascina i campi → report).

Non è affiliato a Microsoft; nome e logo sono volutamente diversi.

## Avvio

```bash
npm install
npm run setup:pbix                      # opzionale: lettura dei file .pbix (Python + pbixray)
node node_modules/electron/install.js   # solo se npm ha bloccato lo script di Electron
npm run dev      # Vite + Electron con hot reload
npm start        # build di produzione + Electron
npm run dist     # pacchetti AppImage/.deb in dist/
```

## Architettura

| Power BI          | LinBI                                                         |
|-------------------|---------------------------------------------------------------|
| VertiPaq          | DuckDB in-memory (`electron/db.cjs`)                           |
| Query DAX dei visual | SQL generato da `src/query.ts` (GROUP BY + filtri)          |
| Visual            | Apache ECharts + componenti React (`src/visuals/`)             |
| File .pbix        | `.lbix` (JSON: report + percorsi origini, dati ricaricati all'apertura) |

Flusso: `Data pane` → drag/checkbox → `store.addField` (posizionamento automatico nei
contenitori) → `buildVisualQuery` → IPC `db:query` → render.

Filtri applicati a ogni visual: report → pagina → visual → filtri dei dati (slicer) → filtro
incrociato (click su barra/fetta/riga).

### Relazioni e semantica delle query (fase 3)

- Relazioni normalizzate come in Power BI: `from` = lato molti, `to` = lato uno; cardinalità `*:1`, `1:1`, `*:*`; direzione filtro *Singola* / *Entrambe*; attiva / inattiva.
- Ogni misura viene valutata sulla **propria tabella** (base); dimensioni e filtri vengono uniti con `LEFT JOIN` lungo il percorso più breve di relazioni attive.
- Il filtro scorre dal lato uno al lato molti; al contrario solo con direzione *Entrambe* (o `1:1`, `*:*`). Un filtro su una tabella non raggiungibile viene ignorato, come in Power BI.
- Se il percorso attraversa un salto uno→molti, la base viene deduplicata (`DISTINCT rowid`) per non contare due volte le righe.
- Misure di tabelle diverse nello stesso visual: una sottoquery per tabella, allineate con `FULL JOIN … IS NOT DISTINCT FROM`.
- Rilevamento automatico all'importazione: stesso nome di colonna, tipo compatibile, valori univoci su un lato; i percorsi ambigui vengono creati inattivi.

### Power Query (fase 4)

**Home › Trasforma dati** (o *Trasforma dati* nello Strumento di navigazione, o *Modifica query* nel riquadro Dati) apre
l'**Editor di Power Query**: elenco query, griglia di anteprima (prime 1000 righe, qualità colonna), barra della formula
con il codice M del passaggio selezionato, *Impostazioni query* con i **passaggi applicati** (selezionabili ed eliminabili).

| Gruppo | Trasformazioni |
|---|---|
| Colonne | Scegli colonne, Rimuovi colonne / altre colonne, Rinomina (doppio clic sull'intestazione), Duplica, Tipo di dati |
| Righe | Filtro con elenco valori e filtri per testo/numero/data, Rimuovi vuoti, Mantieni/Rimuovi prime o ultime righe, Rimuovi duplicati, Ordinamento |
| Trasforma | Sostituisci valori, Riempi in basso/in alto, Dividi colonna per delimitatore, Formato (maiuscolo, minuscolo, iniziali maiuscole, taglia, lunghezza), Arrotonda, Valore assoluto, Anno/Trimestre/Mese/Giorno, Trasforma (altre) colonne in valori (unpivot), Raggruppa per |
| Aggiungi colonna | Colonna personalizzata (formula M: `[Col]`, aritmetica, `&`, `if … then … else`, `Text.*`, `Number.*`, `Date.*`), Colonna indice |
| Combina | Unisci query (join esterno sx/dx/completo, interno, anti), Accoda query, Duplica / Riferimento query, Nuova origine |

Ogni passaggio è salvato nella tabella (`steps`, anche nel `.lbix`) e compilato da `src/pq/compile.ts` in una
**pipeline SQL**: una CTE per passaggio, con una colonna nascosta `__r` che conserva l'ordine delle righe come fa
Power Query. Le query referenziate (Riferimento, Unisci, Accoda) vengono incorporate come sottoquery, quindi le bozze
dell'editor si vedono a vicenda prima di *Chiudi e applica*. Lo stesso elenco di passaggi genera il codice M
(`src/pq/m.ts`) mostrato nella barra della formula e nell'*Editor avanzato* ed esportato nel `.pbit`.
*Visualizza › SQL generato* mostra la query DuckDB equivalente: utile per confrontare M e SQL.

Rinominare una query rinomina la tabella anche nel report (campi, filtri, relazioni, misure); rinominare una
colonna con un passaggio non aggiorna gli oggetti visivi che la usano, come in Power BI.
Differenze note: *Modifica tipo* usa `TRY_CAST` (i valori non convertibili diventano `null` invece di *Error*);
l'Editor avanzato è in sola lettura; i passaggi si eliminano ma non si modificano (rifarli dopo averli eliminati).

## File Power BI

| Operazione | Supporto |
|---|---|
| **Aprire `.pbix`** | Sì: tabelle con dati, relazioni, misure DAX, query M, "ordina per colonna", pagine, visual, filtri, slicer, immagini e sfondi. Il modello VertiPaq (compresso XPress9) è decodificato da [pbixray](https://github.com/Hugoberry/pbixray) in `electron/pbix/read_pbix.py` ed esportato in Parquet per DuckDB. |
| **Aprire `.pbit`** | Sì: schema, misure, relazioni e report. I dati vengono ricaricati se la query M punta a un file locale, altrimenti le tabelle restano vuote. |
| **Salvare `.pbit`** | Sì (File › Esporta modello Power BI): modello TOM, query M per ogni tabella, misure, relazioni, layout e immagini. Power BI Desktop ricarica i dati dalle origini, poi si salva come `.pbix`. |
| **Salvare `.pbix`** | No: richiederebbe la scrittura del backup di Analysis Services con colonne VertiPaq e compressione XPress9 proprietaria; non esiste un writer open source. |

Limiti dell'import: visual personalizzati, mappe, Q&A e simili diventano segnaposto; pulsanti e forme non vengono importati;
i report in connessione dinamica (Power BI Service/SSAS) non contengono dati; il formato PBIR non è ancora letto.
Le misure DAX passano dal compilatore minimo di `src/dax.ts`: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT(A)`, `COUNTBLANK`,
`DISTINCTCOUNT`, `COUNTROWS`, `DIVIDE`, `IF`, aritmetica, riferimenti ad altre misure e `CALCULATE`/`FILTER` con condizioni
sulla stessa tabella. Le altre funzioni (`ALL`, `RANKX`, time intelligence, iteratori…) mostrano un messaggio esplicito nel visual.
Nota: i filtri di `CALCULATE` si sommano al contesto del visual invece di sostituire quelli sulla stessa colonna.

## Funzionalità (fasi 1–4)

- Barra del titolo personalizzata, ribbon Home/Inserisci/Modellazione/Visualizza/Ottimizza/Guida, menu File
- Import Testo/CSV, Excel (estensione DuckDB `excel`, richiede rete al primo uso), JSON, Parquet, dati di esempio *Financials*
- Strumento di navigazione con anteprima
- 20 tipi di visual: barre/istogrammi (raggruppati, in pila, 100%), linee, aree, dispersione,
  torta, anello, mappa ad albero, imbuto, misuratore, scheda, tabella, matrice, filtro dei dati, casella di testo
- Contenitori campi con aggregazioni (Somma, Media, Min, Max, Conteggio, Conteggio distinto, Non riepilogare)
- Riquadro Formato (assi, legenda, etichette dati, colori, titolo, sfondo, bordo, posizione)
- Filtri di base per visual / pagina / tutte le pagine, filtro incrociato, modalità messa a fuoco, ordinamento
- Pagine multiple (aggiungi, rinomina, duplica, elimina), zoom, griglia, allinea alla griglia
- Vista tabella con ordinamento
- Vista modello: tabelle trascinabili, linee di relazione con cardinalità (1 / *) e direzione del filtro, trascina colonna → colonna per creare una relazione, Canc per eliminarla
- Gestisci relazioni, Nuova/Modifica relazione con anteprima, validazione della cardinalità e dei percorsi attivi, rilevamento automatico
- Dati di esempio a stella: `financials` + `products` + `countries`
- Annulla/Ripeti, copia/incolla/duplica visual, salva/apri `.lbix`
- Scorciatoie: Ctrl+S/O/Z/Y/C/V/D, Canc, frecce (Shift = 10px)
- Editor di Power Query con passaggi applicati, codice M e SQL equivalente (vedi sopra)

## Roadmap

4. ~~**Power Query**~~ ✔ — prossimi passi: modifica dei passaggi esistenti, Editor avanzato modificabile (parser M), *Usa la prima riga come intestazione*, colonne condizionali, profilo colonna
5. **DAX completo**: `ALL`/`REMOVEFILTERS` con sostituzione del contesto, time intelligence, iteratori (`SUMX`…), misure su più tabelle, editor misure e vista query DAX
6. **File**: `.lbix` con dati incorporati (export DuckDB/Parquet), lettura PBIR, temi, esportazione PDF

## Test di fumo

`LINBI_SHOT=out.png LINBI_SCRIPT=passi.js npx electron . --no-sandbox` esegue `passi.js`
nella pagina (lo store è esposto come `window.__linbi`, il query builder come `window.__linbiQuery`),
stampa il valore restituito dallo script (`SCRIPT_RESULT {...}`), cattura uno screenshot ed esce.
`LINBI_PBIT_OUT=out.pbit` salva l'esportazione `.pbit` senza finestra di dialogo. File `.pbix` di prova: cartella `data/`
del repository di pbixray (sample Microsoft).
