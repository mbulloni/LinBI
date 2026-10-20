"""Extract a Power BI .pbix/.pbit into a folder LinBI can load.

Usage: read_pbix.py <file> <outdir>
Writes <outdir>/model.json and one Parquet file per imported table.
.pbix data model (XPress9-compressed VertiPaq) is decoded with pbixray;
.pbit only carries the schema (DataModelSchema), so no data is extracted.
"""
import base64
import json
import mimetypes
import os
import re
import sys
import zipfile

SKIP_TABLE = re.compile(r"^(LocalDateTable_|DateTableTemplate_)")
MAX_RESOURCE = 6 * 1024 * 1024


def utf16(z, name):
    raw = z.read(name)
    for enc in ("utf-16-le", "utf-8-sig"):
        try:
            text = raw.decode(enc)
            if text.lstrip("﻿").lstrip().startswith(("{", "[")):
                return text.lstrip("﻿")
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-16-le", errors="replace").lstrip("﻿")


def safe_name(name, used):
    base = re.sub(r"[^\w.-]+", "_", name) or "table"
    out, i = base, 2
    while out in used:
        out, i = f"{base}_{i}", i + 1
    used.add(out)
    return out


def card(c):
    return {"M:1": "manyToOne", "1:M": "oneToMany", "1:1": "oneToOne", "M:M": "manyToMany"}.get(str(c), "manyToOne")


def from_pbixray(path, outdir, out):
    try:
        from pbixray import PBIXRay
    except ImportError:
        raise SystemExit("PBIXRAY_MISSING")
    import pandas as pd
    import decimal

    model = PBIXRay(path)
    pq = {}
    try:
        for _, r in model.power_query.iterrows():
            pq[r["TableName"]] = r["Expression"]
    except Exception:
        pass
    used = set()
    for name in [str(t) for t in model.tables]:
        if SKIP_TABLE.match(name):
            continue
        try:
            df = model.get_table(name)
        except Exception as e:  # noqa: BLE001 - keep importing other tables
            out["warnings"].append(f"Tabella {name}: {e}")
            continue
        for col in df.columns:
            s = df[col]
            if s.dtype == object:
                sample = next((v for v in s.head(200) if v is not None and v == v), None)
                if isinstance(sample, decimal.Decimal):
                    df[col] = pd.to_numeric(s.map(lambda v: float(v) if v is not None else None), errors="coerce")
                elif sample is not None and not isinstance(sample, str):
                    df[col] = s.map(lambda v: None if v is None else str(v))
        file = os.path.join(outdir, safe_name(name, used) + ".parquet")
        df.to_parquet(file, index=False)
        out["tables"].append({"name": name, "parquet": file, "rows": int(len(df)), "m": pq.get(name)})

    # Model metadata not exposed by pbixray's public API: "sort by column" and measure formats.
    sort_by, fmt = {}, {}
    try:
        db = model._metadata.source._db
        q = db.query("SELECT t.Name AS T, c.ExplicitName AS C, s.ExplicitName AS S FROM [Column] c "
                     "JOIN [Table] t ON c.TableID = t.ID JOIN [Column] s ON c.SortByColumnID = s.ID")
        for _, r in q.iterrows():
            sort_by.setdefault(r["T"], {})[r["C"]] = r["S"]
        q = db.query("SELECT t.Name AS T, m.Name AS M, m.FormatString AS F FROM [Measure] m JOIN [Table] t ON m.TableID = t.ID")
        for _, r in q.iterrows():
            if isinstance(r["F"], str) and r["F"]:
                fmt[(r["T"], r["M"])] = r["F"]
    except Exception as e:  # noqa: BLE001 - metadata is optional
        out["warnings"].append(f"Metadati del modello parziali: {e}")
    for t in out["tables"]:
        t["sortBy"] = sort_by.get(t["name"], {})

    names = {t["name"] for t in out["tables"]}
    for _, r in model.relationships.iterrows():
        if r["FromTableName"] not in names or r["ToTableName"] not in names:
            continue
        out["relationships"].append({
            "fromTable": r["FromTableName"], "fromColumn": r["FromColumnName"],
            "toTable": r["ToTableName"], "toColumn": r["ToColumnName"],
            "cardinality": card(r["Cardinality"]),
            "crossFilter": "both" if str(r["CrossFilteringBehavior"]).lower().startswith("both") else "single",
            "active": bool(r["IsActive"]),
        })
    for _, r in model.dax_measures.iterrows():
        out["measures"].append({
            "table": r["TableName"], "name": r["Name"],
            "expression": r["Expression"] if isinstance(r["Expression"], str) else "",
            "formatString": fmt.get((r["TableName"], r["Name"]), ""),
        })


def from_schema(z, out):
    schema = json.loads(utf16(z, "DataModelSchema"))
    model = schema.get("model", {})
    for t in model.get("tables", []):
        name = t["name"]
        if SKIP_TABLE.match(name):
            continue
        m = dax = None
        for p in t.get("partitions", []):
            src = p.get("source", {})
            expr = src.get("expression")
            if expr is not None:
                text = "\n".join(expr) if isinstance(expr, list) else expr
                if src.get("type") == "calculated":
                    dax = text  # calculated table (DAX)
                else:
                    m = text
        calc = [{"name": c["name"], "expression": "\n".join(c["expression"]) if isinstance(c.get("expression"), list) else c.get("expression", "")}
                for c in t.get("columns", []) if c.get("type") == "calculated"]
        cols = [{"name": c["name"], "dataType": c.get("dataType", "string")}
                for c in t.get("columns", []) if c.get("type") not in ("rowNumber", "calculated") and not c["name"].startswith("RowNumber-")]
        all_hidden = all(c.get("isHidden") for c in t.get("columns", []) if c.get("type") != "rowNumber")
        measure_table = bool(t.get("measures")) and all_hidden
        sort_by = {c["name"]: c["sortByColumn"] for c in t.get("columns", []) if c.get("sortByColumn")}
        if not measure_table:  # measure tables only carry measures
            out["tables"].append({"name": name, "parquet": None, "rows": 0, "m": m, "columns": cols, "sortBy": sort_by,
                                  **({"dax": dax} if dax else {}), **({"calcColumns": calc} if calc else {})})
        for ms in t.get("measures", []):
            expr = ms.get("expression", "")
            out["measures"].append({"table": name, "name": ms["name"],
                                    "expression": "\n".join(expr) if isinstance(expr, list) else expr,
                                    "formatString": ms.get("formatString", "")})
    names = {t["name"] for t in out["tables"]}
    for r in model.get("relationships", []):
        if r["fromTable"] not in names or r["toTable"] not in names:
            continue
        fc, tc = r.get("fromCardinality", "many"), r.get("toCardinality", "one")
        cardinality = "oneToOne" if fc == "one" and tc == "one" else "manyToMany" if tc == "many" else "manyToOne"
        out["relationships"].append({
            "fromTable": r["fromTable"], "fromColumn": r["fromColumn"], "toTable": r["toTable"], "toColumn": r["toColumn"],
            "cardinality": cardinality,
            "crossFilter": "both" if r.get("crossFilteringBehavior") == "bothDirections" else "single",
            "active": r.get("isActive", True),
        })


CV_PART = re.compile(r"^Report/CustomVisuals/([^/]+)/(package\.json|resources/[^/]+\.pbiviz\.json)$")


def custom_visuals(z, names):
    """Custom visuals embedded in the report: Report/CustomVisuals/<guid>/package.json + resources/<guid>.pbiviz.json."""
    found = {}
    for n in names:
        m = CV_PART.match(n)
        if not m:
            continue
        try:
            data = json.loads(z.read(n).decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            continue
        found.setdefault(m.group(1), {"guid": m.group(1)})["package" if m.group(2) == "package.json" else "pbiviz"] = data
    return [v for v in found.values() if "pbiviz" in v]


def main():
    path, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    out = {"file": path, "kind": None, "tables": [], "relationships": [], "measures": [],
           "layout": None, "resources": {}, "customVisuals": [], "warnings": []}
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if "Report/Layout" in names:
            out["layout"] = utf16(z, "Report/Layout")
        elif any(n.startswith("Report/definition/") for n in names):
            # Enhanced report format (PBIR): JSON files per page/visual, converted in src/pbix/pbir.ts.
            out["pbir"] = {n[len("Report/definition/"):]: z.read(n).decode("utf-8-sig")
                           for n in names if n.startswith("Report/definition/") and n.endswith(".json")}
        for n in names:
            if n.startswith("Report/StaticResources/RegisteredResources/") and z.getinfo(n).file_size <= MAX_RESOURCE:
                mime = mimetypes.guess_type(n)[0] or "application/octet-stream"
                if mime.startswith("image/") or mime == "application/json":
                    out["resources"][n.rsplit("/", 1)[1]] = f"data:{mime};base64," + base64.b64encode(z.read(n)).decode()
        out["customVisuals"] = custom_visuals(z, names)
        if "DataModel" in names:
            out["kind"] = "pbix"
            from_pbixray(path, outdir, out)
        elif "DataModelSchema" in names:
            out["kind"] = "pbit"
            from_schema(z, out)
        else:
            out["kind"] = "live"
            out["warnings"].append("Il file usa una connessione dinamica a un modello remoto (Power BI Service / Analysis Services): non contiene dati.")
    with open(os.path.join(outdir, "model.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, allow_nan=False, default=str)
    print(os.path.join(outdir, "model.json"))


if __name__ == "__main__":
    main()
