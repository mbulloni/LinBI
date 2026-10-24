// Minimal .xlsx writer (Esporta dati): one worksheet, header row in bold, numbers as numbers,
// dates as Excel serials with a date format, everything else as inline strings.
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  // XML 1.0 forbids most control characters.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
/** yyyy-mm-dd[ hh:mm:ss] → Excel serial, or null. */
function serial(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return { value: (t - EPOCH) / DAY_MS, time: m[4] !== undefined };
}

/** columns: [{ name, kind: 'number' | 'date' | 'text' }], rows: arrays of values. */
async function buildXlsx(sheetName, columns, rows) {
  const out = [];
  const header = columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${esc(c.name)}</t></is></c>`).join('');
  out.push(`<row r="1">${header}</row>`);
  rows.forEach((row, r) => {
    const cells = row.map((v, i) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colName(i)}${r + 2}`;
      const kind = columns[i]?.kind;
      if (kind === 'number' && typeof v !== 'boolean' && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
      if (kind === 'date') { const d = serial(String(v)); if (d) return `<c r="${ref}" s="${d.time ? 3 : 2}"><v>${d.value}</v></c>`; }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    out.push(`<row r="${r + 2}">${cells}</row>`);
  });
  const widths = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, c.name.length + 2))}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${widths ? `<cols>${widths}</cols>` : ''}<sheetData>${out.join('')}</sheetData>${columns.length ? `<autoFilter ref="A1:${colName(columns.length - 1)}${rows.length + 1}"/>` : ''}</worksheet>`;
  const name = esc(String(sheetName || 'Dati').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Dati');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${columns.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colName(columns.length - 1)}$${rows.length + 1}</definedName></definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** CSV like Power BI's export: UTF-8 with BOM, comma separated, quoted when needed. */
function buildCsv(columns, rows) {
  const q = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [columns.map((c) => q(c.name)).join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n') + '\r\n';
}

module.exports = { buildXlsx, buildCsv };
