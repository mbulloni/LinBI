// Runs inside the sandboxed iframe of a custom visual (opaque origin, no Node, no access to LinBI).
// Provides the `powerbi` global and the IVisualHost a .pbiviz bundle expects, receives the DataView
// from CustomVisual.tsx and sends back selections, persisted properties, JSON filters and URLs.
(function () {
  'use strict';
  var send = function (m) { parent.postMessage(m, '*'); };
  var root = document.getElementById('v');
  var pkg = null, visual = null, palette = null, strings = {}, last = null, selection = [], selectCbs = [];
  var noop = function () {};

  // Asynchronous errors (timers, promises, libraries) stay in the console like in Power BI;
  // only failures of create/update replace the visual with an error.
  window.onerror = function (msg, src, line, col, err) { send({ type: 'warn', message: String(err && err.message || msg) }); return true; };
  window.addEventListener('unhandledrejection', function (e) { send({ type: 'warn', message: String(e.reason && e.reason.message || e.reason) }); e.preventDefault(); });

  var enumType = function (members) {
    var list = members || [];
    return { members: function () { return list; }, hasValue: function (v) { return list.some(function (m) { return m.value === v; }); } };
  };
  var pbi = window.powerbi = window.powerbi || {};
  pbi.visuals = pbi.visuals || {};
  pbi.visuals.plugins = pbi.visuals.plugins || {};
  pbi.extensibility = pbi.extensibility || {};
  pbi.extensibility.visual = pbi.extensibility.visual || {};
  pbi.extensibility.utils = pbi.extensibility.utils || {};
  pbi.createEnumType = enumType;
  pbi.VisualUpdateType = { Data: 2, Resize: 4, ViewMode: 8, Style: 16, ResizeEnd: 32, FormattingSubSelectionChange: 64, FormatModeChange: 128, FilterOptionsChange: 256, All: 62 };
  pbi.VisualDataRoleKind = { Grouping: 0, Measure: 1, GroupingOrMeasure: 2 };
  pbi.ViewMode = { View: 0, Edit: 1, InFocusEdit: 2 };
  pbi.EditMode = { Default: 0, Advanced: 1 };
  pbi.SortDirection = { Ascending: 1, Descending: 2 };
  pbi.ResizeMode = { Resizing: 1, Resized: 2 };
  pbi.FilterAction = { merge: 0, remove: 1 };
  pbi.VisualEventType = { Render: 0 };
  pbi.VisualDataChangeOperationKind = { Create: 0, Append: 1, Segment: 2 };
  pbi.common = pbi.common || { cultureInfo: 'it-IT' };
  // Host API versions; a bundle may install `overloads(visual, host)` to wrap its visual (applied after create).
  pbi.extensibility.visualApiVersions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0',
    '2.1.0', '2.2.0', '2.3.0', '2.5.0', '2.6.0', '3.0.0', '3.2.0', '3.4.0', '3.6.0', '3.8.0', '4.0.0', '4.2.0', '4.6.0', '5.1.0', '5.3.0', '5.4.0', '5.8.0', '5.9.0', '5.10.0', '5.11.0']
    .map(function (v) { return { version: v }; });
  pbi.DataViewObjectPropertyType = {};

  /* ----------------------------- selection ids ----------------------------- */
  function SelectionId(sel, measures) {
    this.sel = sel || [];
    this.measures = measures || [];
    this.key = JSON.stringify([this.sel, this.measures]);
  }
  SelectionId.prototype.getKey = function () { return this.key; };
  SelectionId.prototype.equals = function (o) { return !!o && o.key === this.key; };
  SelectionId.prototype.includes = function (o) {
    var self = this;
    return !!o && (o.sel || []).every(function (p) { return self.sel.some(function (q) { return q.t === p.t && q.c === p.c && q.v === p.v; }); });
  };
  SelectionId.prototype.hasIdentity = function () { return this.sel.length > 0; };
  SelectionId.prototype.getSelector = function () {
    var lit = function (v) { return v === null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'"; };
    if (!this.sel.length) return this.measures.length ? { metadata: this.measures[0] } : null;
    return { data: this.sel.map(function (p) { return { scopeId: { Comparison: { ComparisonKind: 0, Left: { Column: { Expression: { SourceRef: { Entity: p.t } }, Property: p.c } }, Right: { Literal: { Value: lit(p.v) } } } } }; }) };
  };
  SelectionId.prototype.getSelectorsByColumn = function () {
    var m = {};
    this.sel.forEach(function (p) { m[p.t + '.' + p.c] = p.v; });
    return { dataMap: m };
  };
  SelectionId.prototype.toString = function () { return this.key; };

  var idSel = function (identity) { return identity && identity.sel ? identity.sel : []; };
  function Builder() { this.sel = []; this.measures = []; }
  Builder.prototype.withCategory = function (cat, index) { if (cat && cat.identity) this.sel = this.sel.concat(idSel(cat.identity[index])); return this; };
  Builder.prototype.withSeries = function (values, group) { var id = group && group.identity; this.sel = this.sel.concat(idSel(id)); return this; };
  Builder.prototype.withMeasure = function (qn) { if (qn) this.measures.push(qn); return this; };
  Builder.prototype.withMatrixNode = function (node) { this.sel = this.sel.concat(idSel(node && node.identity)); return this; };
  Builder.prototype.withTable = function (table, rowIndex) { if (table && table.identity) this.sel = this.sel.concat(idSel(table.identity[rowIndex])); return this; };
  Builder.prototype.createSelectionId = function () {
    var seen = {}, sel = this.sel.filter(function (p) { var k = JSON.stringify(p); if (seen[k]) return false; seen[k] = 1; return true; });
    return new SelectionId(sel, this.measures);
  };

  var notifySelection = function () {
    send({ type: 'select', sel: selection.map(function (s) { return s.sel; }) });
    selectCbs.forEach(function (cb) { try { cb(selection.slice()); } catch (e) { /* visual callback */ } });
  };
  var selectionManager = {
    select: function (ids, multi) {
      var list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
      var only = selection.length === list.length && list.every(function (id) { return selection.some(function (s) { return s.equals(id); }); });
      if (multi) list.forEach(function (id) {
        var i = selection.findIndex(function (s) { return s.equals(id); });
        if (i >= 0) selection.splice(i, 1); else selection.push(id);
      });
      else selection = only ? [] : list.slice(); // clicking the selected point again clears it, like Power BI
      notifySelection();
      return Promise.resolve(selection.slice());
    },
    hasSelection: function () { return selection.length > 0; },
    clear: function () { selection = []; notifySelection(); return Promise.resolve({}); },
    getSelectionIds: function () { return selection.slice(); },
    registerOnSelectCallback: function (cb) { selectCbs.push(cb); },
    showContextMenu: function () { return Promise.resolve({}); },
    toggleExpandCollapse: function () { return Promise.resolve({}); },
    applySelectionFilter: noop,
    // Pre-1.x internal host some bundles still read (sandbox flag, paging).
    hostServices: { messageProxy: true, loadMoreData: noop, canDrill: function () { return false; } },
  };

  /* -------------------------------- tooltip -------------------------------- */
  var tip = document.createElement('div');
  tip.id = 'linbi-tt';
  document.body.appendChild(tip);
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var showTip = function (o) {
    if (!o) return;
    var items = o.dataItems || [];
    if (!items.length) { tip.style.display = 'none'; return; }
    var head = items[0] && items[0].header ? '<div class="h">' + esc(items[0].header) + '</div>' : '';
    tip.innerHTML = head + items.map(function (d) {
      return '<div class="r">' + (d.color ? '<i style="background:' + esc(d.color) + '"></i>' : '') + '<span>' + esc(d.displayName) + '</span><b>' + esc(d.value) + '</b></div>';
    }).join('');
    var c = o.coordinates || [0, 0];
    tip.style.display = 'block';
    var x = Math.min(c[0] + 12, innerWidth - tip.offsetWidth - 4), y = Math.min(c[1] + 12, innerHeight - tip.offsetHeight - 4);
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  };
  var tooltipService = { enabled: function () { return true; }, show: showTip, move: showTip, hide: function () { tip.style.display = 'none'; } };

  /* --------------------------------- colors -------------------------------- */
  var colorPalette = function () {
    var map = {}, n = 0, dc = palette.dataColors;
    var c = function (v) { return { value: v }; };
    var fg = palette.foreground, bg = palette.background;
    return {
      getColor: function (key) { key = String(key); if (!map[key]) map[key] = dc[n++ % dc.length]; return c(map[key]); },
      reset: function () { map = {}; n = 0; return this; },
      isHighContrast: false,
      foreground: c(fg), foregroundLight: c('#605E5C'), foregroundDark: c('#252423'), foregroundNeutralLight: c('#C8C6C4'), foregroundNeutralDark: c('#323130'),
      foregroundNeutralSecondary: c('#605E5C'), foregroundNeutralSecondaryAlt: c('#8A8886'), foregroundNeutralSecondaryAlt2: c('#A19F9D'), foregroundNeutralTertiary: c('#B3B0AD'),
      foregroundNeutralTertiaryAlt: c('#C8C6C4'), foregroundSelected: c(fg), foregroundButton: c(fg), background: c(bg), backgroundLight: c('#F3F2F1'), backgroundNeutral: c('#C8C6C4'),
      backgroundDark: c('#252423'), hyperlink: c('#0078D4'), visitedHyperlink: c('#0078D4'), mapPushpin: c('#FF5F00'), shapeStroke: c(dc[0]), selection: c(dc[0]), separator: c('#E1DFDD'),
      negative: c('#D64554'), neutral: c('#D9B300'), positive: c('#1AAB40'),
    };
  };

  /* ---------------------------------- host --------------------------------- */
  var makeHost = function () {
    var palette0 = colorPalette();
    var host = {
      createSelectionIdBuilder: function () { return new Builder(); },
      createSelectionManager: function () { return selectionManager; },
      colorPalette: palette0,
      tooltipService: tooltipService,
      locale: 'it-IT',
      allowInteractions: true,
      instanceId: pkg.guid + '-' + Math.random().toString(36).slice(2),
      hostEnv: 1,
      hostCapabilities: { allowInteractions: true, allowModalDialog: false },
      persistProperties: function (changes) { send({ type: 'persist', changes: JSON.parse(JSON.stringify(changes || {})) }); },
      applyJsonFilter: function (filter, objectName, propertyName, action) {
        send({ type: 'filter', key: objectName + '.' + propertyName, filter: filter ? JSON.parse(JSON.stringify(filter)) : null, remove: action === 1 });
      },
      launchUrl: function (url) { send({ type: 'url', url: String(url) }); },
      fetchMoreData: function () { return false; },
      refreshHostData: noop,
      displayWarningIcon: noop,
      createLocalizationManager: function () {
        return { getDisplayName: function (key) {
          var langs = ['it-IT', 'it', 'en-US', 'en'];
          for (var i = 0; i < langs.length; i++) if (strings[langs[i]] && strings[langs[i]][key] !== undefined) return strings[langs[i]][key];
          return key;
        } };
      },
      eventService: { renderingStarted: noop, renderingFinished: function () { send({ type: 'rendered' }); }, renderingFailed: function (o, reason) { send({ type: 'rendered', failed: String(reason || '') }); } },
      storageService: { get: function () { return Promise.reject(new Error('not available')); }, set: function () { return Promise.resolve(0); }, remove: noop },
      storageV2Service: { get: function () { return Promise.resolve(undefined); }, set: function () { return Promise.resolve(); }, remove: function () { return Promise.resolve(); }, status: function () { return Promise.resolve(0); } },
      licenseManager: {
        getAvailableServicePlans: function () { return Promise.resolve({ plans: [], isLicenseUnsupportedEnvironment: false, isLicenseInfoAvailable: false }); },
        notifyLicenseRequired: function () { return Promise.resolve(false); },
        notifyFeatureBlocked: function () { return Promise.resolve(false); },
        clearLicenseNotification: function () { return Promise.resolve(false); },
      },
      downloadService: { exportVisualsContent: function () { return Promise.resolve(false); }, exportStatus: function () { return Promise.resolve(0); } },
      authenticationService: { getAADToken: function () { return Promise.resolve(null); } },
      webAccessService: { webAccessStatus: function () { return Promise.resolve(pkg.net === 'none' ? 1 : 0); } },
      acquireAADTokenService: { acquireAADToken: function () { return Promise.resolve(null); }, acquireAADTokenstatus: function () { return Promise.resolve(1); } },
      openModalDialog: function () { return Promise.reject(new Error('Finestre di dialogo non supportate')); },
      telemetry: { trace: noop },
      subSelectionService: { subSelect: noop, updateRegionOutlines: noop },
      drill: noop, setCanDrill: noop, switchFocusModeState: noop, setTitle: noop,
    };
    // Unknown services of newer API versions: harmless no-ops instead of "is not a function".
    return new Proxy(host, { get: function (t, p) { if (p in t || typeof p !== 'string' || p === 'then' || p === 'toJSON') return t[p]; return noop; } });
  };

  /* ------------------------------- data view ------------------------------- */
  var dataView = function (d) {
    var dv = { metadata: d.metadata, table: d.table, tree: d.tree };
    if (d.single) dv.single = d.single;
    if (d.matrix) dv.matrix = d.matrix;
    if (d.categorical) {
      var c = d.categorical, values = c.values;
      if (values) {
        var groups = c.series ? c.series.groups.map(function (g) {
          return { name: g.name, identity: g.identity, objects: g.objects, values: g.values.map(function (i) { return values[i]; }) };
        }) : [{ values: values.slice() }];
        values.grouped = function () { return groups; };
        if (c.series) { values.source = c.series.source; values.identityFields = [c.series.source.expr]; }
      }
      dv.categorical = c;
      delete c.series;
    }
    return dv;
  };

  var update = function (type) {
    if (!visual || !last) return;
    var o = { viewport: { width: innerWidth, height: innerHeight, scale: 1 }, dataViews: last.dv ? [dataView(structuredClone(last.dv))] : [], type: type,
      viewMode: last.edit ? 1 : 0, editMode: 0, operationKind: 0, jsonFilters: last.jsonFilters || [], isInFocus: false };
    try { visual.update(o); }
    catch (e) { send({ type: 'error', message: String(e && e.message || e) }); }
  };

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || e.source !== parent) return;
    if (m.type === 'init') {
      pkg = m.pkg; palette = m.palette; strings = m.strings || {};
      if (m.css) { var st = document.createElement('style'); st.textContent = m.css; document.head.appendChild(st); }
      (m.libs || []).forEach(function (code) { var s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); });
      var loadError = null;
      var trap = function (ev) { if (!loadError) loadError = ev.error || ev.message; };
      window.addEventListener('error', trap);
      var sc = document.createElement('script');
      sc.textContent = m.js;
      document.head.appendChild(sc);
      window.removeEventListener('error', trap);
      var plugins = pbi.visuals.plugins;
      var plugin = plugins[pkg.guid] || plugins[pkg.guid + '_DEBUG'] || Object.keys(plugins).map(function (k) { return plugins[k]; }).find(function (p) { return p && p.create; });
      if (!plugin) { send({ type: 'error', message: loadError ? String(loadError.message || loadError) : 'Il pacchetto non registra un oggetto visivo (powerbi.visuals.plugins).' }); return; }
      try {
        var host = makeHost();
        visual = plugin.create({ element: root, host: host, module: plugin });
        var apiEntry = pbi.extensibility.visualApiVersions.find(function (a) { return a.version === (plugin.apiVersion || pkg.apiVersion); });
        if (apiEntry && typeof apiEntry.overloads === 'function') visual = apiEntry.overloads(visual, host) || visual;
        send({ type: 'ready' });
      } catch (err) { send({ type: 'error', message: String(err && err.message || err) }); }
    } else if (m.type === 'update') {
      last = m;
      tip.style.display = 'none';
      update(m.resize ? 4 : 62);
    } else if (m.type === 'clearSelection') {
      selection = [];
      selectCbs.forEach(function (cb) { try { cb([]); } catch (err) { /* visual callback */ } });
    }
  });
  var timer = 0;
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { update(4); }, 60); });
  document.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  send({ type: 'loaded' });
})();
