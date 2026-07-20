"""
portfolio_service.py
====================
All backend logic for the Holdings Upload & Portfolio Analysis feature.

Four responsibilities:
1. File Parser      — CSV/XLSX with header-row auto-detection, broker detection
2. Symbol Resolver  — ISIN / fuzzy-name → Yahoo ticker
3. Portfolio CRUD   — wraps supabase_service with portfolio-specific helpers
4. Analysis Engine  — computes allocation, concentration risk, technicals, fundamentals
"""

from app.services.yfinance_service import yf_session
import csv
import io
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import get_close_matches
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# STATIC DATA PATHS
# ─────────────────────────────────────────────────────────────────────────────
_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

# ─────────────────────────────────────────────────────────────────────────────
# SECTOR + MARKET-CAP CLASSIFICATION (mirrored from main.py for reuse)
# ─────────────────────────────────────────────────────────────────────────────
SECTOR_MAP: Dict[str, str] = {
    # IT & Software
    "TCS.NS": "IT & Software", "INFY.NS": "IT & Software", "WIPRO.NS": "IT & Software",
    "HCLTECH.NS": "IT & Software", "LTIM.NS": "IT & Software", "TECHM.NS": "IT & Software",
    "MPHASIS.NS": "IT & Software", "PERSISTENT.NS": "IT & Software", "COFORGE.NS": "IT & Software",
    "KPITTECH.NS": "IT & Software", "LATENTVIEW.NS": "IT & Software", "OFSS.NS": "IT & Software",
    "TATAELXSI.NS": "IT & Software",
    # Financial Services
    "HDFCBANK.NS": "Financial Services", "ICICIBANK.NS": "Financial Services",
    "SBIN.NS": "Financial Services", "AXISBANK.NS": "Financial Services",
    "KOTAKBANK.NS": "Financial Services", "INDUSINDBK.NS": "Financial Services",
    "BAJFINANCE.NS": "Financial Services", "BAJAJFINSV.NS": "Financial Services",
    "HDFCLIFE.NS": "Financial Services", "SBILIFE.NS": "Financial Services",
    "CHOLAFIN.NS": "Financial Services", "MUTHOOTFIN.NS": "Financial Services",
    "PFC.NS": "Financial Services", "RECLTD.NS": "Financial Services",
    "BANKBARODA.NS": "Financial Services", "CANBK.NS": "Financial Services",
    "PNB.NS": "Financial Services", "IDFCFIRSTB.NS": "Financial Services",
    "FEDERALBNK.NS": "Financial Services", "RBLBANK.NS": "Financial Services",
    "AUBANK.NS": "Financial Services", "SBICARD.NS": "Financial Services",
    "SHRIRAMFIN.NS": "Financial Services", "LICHSGFIN.NS": "Financial Services",
    "MANAPPURAM.NS": "Financial Services", "POONAWALLA.NS": "Financial Services",
    "ICICIGI.NS": "Financial Services", "ICICIPRULI.NS": "Financial Services",
    "HDFCAMC.NS": "Financial Services", "BANDHANBNK.NS": "Financial Services",
    "YESBANK.NS": "Financial Services", "L&TFH.NS": "Financial Services",
    "MFSL.NS": "Financial Services", "ABCAPITAL.NS": "Financial Services",
    "CANFINHOME.NS": "Financial Services", "ANGELONE.NS": "Financial Services",
    "IDBI.NS": "Financial Services", "UTIAMC.NS": "Financial Services",
    "CDSL.NS": "Financial Services", "LICI.NS": "Financial Services",
    "JIOFIN.NS": "Financial Services", "STARHEALTH.NS": "Financial Services",
    # Healthcare & Pharma
    "SUNPHARMA.NS": "Healthcare & Pharma", "DRREDDY.NS": "Healthcare & Pharma",
    "CIPLA.NS": "Healthcare & Pharma", "DIVISLAB.NS": "Healthcare & Pharma",
    "APOLLOHOSP.NS": "Healthcare & Pharma", "LUPIN.NS": "Healthcare & Pharma",
    "AUROPHARMA.NS": "Healthcare & Pharma", "BIOCON.NS": "Healthcare & Pharma",
    "ALKEM.NS": "Healthcare & Pharma", "IPCALAB.NS": "Healthcare & Pharma",
    "NATCOPHARM.NS": "Healthcare & Pharma", "ABBOTINDIA.NS": "Healthcare & Pharma",
    "GLENMARK.NS": "Healthcare & Pharma", "TORNTPHARM.NS": "Healthcare & Pharma",
    "MAXHEALTH.NS": "Healthcare & Pharma", "FORTIS.NS": "Healthcare & Pharma",
    "SYNGENE.NS": "Healthcare & Pharma", "GRANULES.NS": "Healthcare & Pharma",
    # Automobile
    "MARUTI.NS": "Automobile", "TATAMOTORS.NS": "Automobile", "M&M.NS": "Automobile",
    "BAJAJ-AUTO.NS": "Automobile", "HEROMOTOCO.NS": "Automobile", "EICHERMOT.NS": "Automobile",
    "ASHOKLEY.NS": "Automobile", "TVSMOTOR.NS": "Automobile", "BOSCHLTD.NS": "Automobile",
    "APOLLOTYRE.NS": "Automobile", "BALKRISIND.NS": "Automobile", "CUMMINSIND.NS": "Automobile",
    "MOTHERSON.NS": "Automobile", "BHARATFORG.NS": "Automobile", "MRF.NS": "Automobile",
    "ESCORTS.NS": "Automobile",
    # FMCG
    "HINDUNILVR.NS": "FMCG", "ITC.NS": "FMCG", "NESTLEIND.NS": "FMCG",
    "DABUR.NS": "FMCG", "MARICO.NS": "FMCG", "BRITANNIA.NS": "FMCG",
    "COLPAL.NS": "FMCG", "GODREJCP.NS": "FMCG", "UBL.NS": "FMCG",
    "MCDOWELL-N.NS": "FMCG", "VBL.NS": "FMCG", "TATACONSUM.NS": "FMCG",
    "PATANJALI.NS": "FMCG",
    # Energy & Power
    "RELIANCE.NS": "Energy & Power", "ONGC.NS": "Energy & Power", "BPCL.NS": "Energy & Power",
    "IOC.NS": "Energy & Power", "COALINDIA.NS": "Energy & Power", "NTPC.NS": "Energy & Power",
    "POWERGRID.NS": "Energy & Power", "GAIL.NS": "Energy & Power", "HINDPETRO.NS": "Energy & Power",
    "TORNTPOWER.NS": "Energy & Power", "NHPC.NS": "Energy & Power", "PETRONET.NS": "Energy & Power",
    "IGL.NS": "Energy & Power", "MGL.NS": "Energy & Power", "GUJGASLTD.NS": "Energy & Power",
    "SUZLON.NS": "Energy & Power", "ATGL.NS": "Energy & Power", "OIL.NS": "Energy & Power",
    "NMDC.NS": "Energy & Power",
    # Metals & Mining
    "TATASTEEL.NS": "Metals & Mining", "JSWSTEEL.NS": "Metals & Mining",
    "HINDALCO.NS": "Metals & Mining", "VEDL.NS": "Metals & Mining", "SAIL.NS": "Metals & Mining",
    "JINDALSTEL.NS": "Metals & Mining",
    # Infrastructure & Construction
    "LT.NS": "Infrastructure", "ADANIPORTS.NS": "Infrastructure", "ULTRACEMCO.NS": "Infrastructure",
    "GRASIM.NS": "Infrastructure", "AMBUJACEM.NS": "Infrastructure", "DALBHARAT.NS": "Infrastructure",
    "SHREECEM.NS": "Infrastructure", "RAMCOCEM.NS": "Infrastructure", "NBCC.NS": "Infrastructure",
    "NCC.NS": "Infrastructure", "KEC.NS": "Infrastructure", "GMRINFRA.NS": "Infrastructure",
    "IRB.NS": "Infrastructure", "CONCOR.NS": "Infrastructure", "SIEMENS.NS": "Infrastructure",
    "ABB.NS": "Infrastructure", "HAL.NS": "Infrastructure", "BEL.NS": "Infrastructure",
    "BHEL.NS": "Infrastructure", "POLYCAB.NS": "Infrastructure", "CGPOWER.NS": "Infrastructure",
    "HAVELLS.NS": "Infrastructure", "ADANIENT.NS": "Infrastructure", "LODHA.NS": "Real Estate",
    # Real Estate
    "DLF.NS": "Real Estate", "GODREJPROP.NS": "Real Estate", "PRESTIGE.NS": "Real Estate",
    "OBEROIRLTY.NS": "Real Estate", "ANANTRAJ.NS": "Real Estate",
    # Consumer Discretionary
    "TITAN.NS": "Consumer Discretionary", "DMART.NS": "Consumer Discretionary",
    "TRENT.NS": "Consumer Discretionary", "JUBLFOOD.NS": "Consumer Discretionary",
    "DEVYANI.NS": "Consumer Discretionary", "PVRINOX.NS": "Consumer Discretionary",
    "BATA.NS": "Consumer Discretionary", "BATAINDIA.NS": "Consumer Discretionary",
    "PAGEIND.NS": "Consumer Discretionary", "INDHOTEL.NS": "Consumer Discretionary",
    "ASIANPAINT.NS": "Consumer Discretionary", "VOLTAS.NS": "Consumer Discretionary",
    "CROMPTON.NS": "Consumer Discretionary", "DIXON.NS": "Consumer Discretionary",
    "SUPREMEIND.NS": "Consumer Discretionary", "ASTRAL.NS": "Consumer Discretionary",
    "PIDILITIND.NS": "Consumer Discretionary",
    # Telecom
    "BHARTIARTL.NS": "Telecom", "INDUSTOWER.NS": "Telecom",
    # Chemicals
    "DEEPAKNTR.NS": "Chemicals", "NAVINFLUOR.NS": "Chemicals", "AARTIIND.NS": "Chemicals",
    "SRF.NS": "Chemicals", "PIIND.NS": "Chemicals", "UPL.NS": "Chemicals",
    "COROMANDEL.NS": "Chemicals", "CHAMBLFERT.NS": "Chemicals",
    "TATACHEM.NS": "Chemicals", "ALKYLAMINE.NS": "Chemicals",
    # Logistics / Travel
    "IRCTC.NS": "Logistics & Travel", "IRFC.NS": "Logistics & Travel",
    "INDIGO.NS": "Logistics & Travel", "TATACOMM.NS": "Logistics & Travel",
    "ALLCARGO.NS": "Logistics & Travel",
    # Media & Entertainment
    "ZEEL.NS": "Media & Entertainment",
    # New-age / Internet
    "ZOMATO.NS": "New-age & Internet", "NAUKRI.NS": "New-age & Internet",
    "JIOFIN.NS": "New-age & Internet", "LATENTVIEW.NS": "New-age & Internet",
    "ANGELONE.NS": "New-age & Internet",
}

# Nifty 50 + Next 50 = large cap; Midcap 150 = mid cap; else small
_NIFTY_50 = {
    "ADANIENT.NS","ADANIPORTS.NS","APOLLOHOSP.NS","ASIANPAINT.NS","AXISBANK.NS",
    "BAJAJ-AUTO.NS","BAJFINANCE.NS","BAJAJFINSV.NS","BPCL.NS","BHARTIARTL.NS",
    "BRITANNIA.NS","CIPLA.NS","COALINDIA.NS","DIVISLAB.NS","DRREDDY.NS",
    "EICHERMOT.NS","GRASIM.NS","HCLTECH.NS","HDFCBANK.NS","HDFCLIFE.NS",
    "HEROMOTOCO.NS","HINDALCO.NS","HINDUNILVR.NS","ICICIBANK.NS","ITC.NS",
    "INDUSINDBK.NS","INFY.NS","JSWSTEEL.NS","KOTAKBANK.NS","LTIM.NS",
    "LT.NS","M&M.NS","MARUTI.NS","NTPC.NS","NESTLEIND.NS",
    "ONGC.NS","POWERGRID.NS","RELIANCE.NS","SBILIFE.NS","SHREECEM.NS",
    "SBIN.NS","SUNPHARMA.NS","TCS.NS","TATACONSUM.NS","TATAMOTORS.NS",
    "TATASTEEL.NS","TECHM.NS","TITAN.NS","ULTRACEMCO.NS","WIPRO.NS"
}

_NIFTY_NEXT_50 = {
    "ABB.NS","AMBUJACEM.NS","AUROPHARMA.NS","DMART.NS","BAJAJHLDNG.NS",
    "BANKBARODA.NS","BEL.NS","BOSCHLTD.NS","CANBK.NS","CHOLAFIN.NS",
    "COLPAL.NS","DLF.NS","DABUR.NS","GAIL.NS","GODREJCP.NS",
    "HDFCAMC.NS","HAVELLS.NS","HAL.NS","ICICIGI.NS","ICICIPRULI.NS",
    "IOC.NS","IRCTC.NS","IRFC.NS","INDIGO.NS","JIOFIN.NS",
    "LICI.NS","LODHA.NS","MARICO.NS","MUTHOOTFIN.NS","NHPC.NS",
    "PIDILITIND.NS","PFC.NS","PNB.NS","RECLTD.NS","SBICARD.NS",
    "SRF.NS","MOTHERSON.NS","SHRIRAMFIN.NS","SIEMENS.NS","TVSMOTOR.NS",
    "TRENT.NS","TORNTPHARM.NS","TORNTPOWER.NS","UBL.NS","VBL.NS",
    "VEDL.NS","ZOMATO.NS","MCDOWELL-N.NS","JINDALSTEL.NS","KALYANKJIL.NS"
}

_MIDCAP_150 = {
    "AARTIIND.NS","ABBOTINDIA.NS","ALKEM.NS","ASHOKLEY.NS","AUBANK.NS",
    "BANDHANBNK.NS","BANKINDIA.NS","BATAINDIA.NS","BHARATFORG.NS","BHEL.NS",
    "BIOCON.NS","CGPOWER.NS","COFORGE.NS","CONCOR.NS","CROMPTON.NS",
    "CUMMINSIND.NS","DALBHARAT.NS","DEEPAKNTR.NS","DIXON.NS","ESCORTS.NS",
    "FEDERALBNK.NS","FORTIS.NS","GMRINFRA.NS","GLENMARK.NS","GUJGASLTD.NS",
    "HINDPETRO.NS","IDBI.NS","IDFCFIRSTB.NS","IGL.NS","INDHOTEL.NS",
    "INDUSTOWER.NS","IPCALAB.NS","JUBLFOOD.NS","L&TFH.NS","LICHSGFIN.NS",
    "LUPIN.NS","MRF.NS","MGL.NS","MAXHEALTH.NS","MFSL.NS",
    "MPHASIS.NS","NMDC.NS","NAUKRI.NS","NAVINFLUOR.NS","OBEROIRLTY.NS",
    "OFSS.NS","OIL.NS","PIIND.NS","PAGEIND.NS","PATANJALI.NS",
    "PERSISTENT.NS","PETRONET.NS","POLYCAB.NS","PRESTIGE.NS","RAMCOCEM.NS",
    "SAIL.NS","STARHEALTH.NS","SUPREMEIND.NS","SYNGENE.NS","TATACHEM.NS",
    "TATACOMM.NS","TATAELXSI.NS","UPL.NS","VOLTAS.NS","YESBANK.NS","ZEEL.NS",
    "ASTRAL.NS","ABCAPITAL.NS","APOLLOTYRE.NS","BALKRISIND.NS","CANFINHOME.NS",
    "CHAMBLFERT.NS","CUB.NS","COROMANDEL.NS","DEVYANI.NS","KPITTECH.NS",
    "LATENTVIEW.NS","MANAPPURAM.NS","POONAWALLA.NS","RBLBANK.NS","ANGELONE.NS",
    "CDSL.NS","UTIAMC.NS","PVRINOX.NS","SUZLON.NS","TRIDENT.NS",
}

def _get_market_cap_tier(symbol: str) -> str:
    if symbol in _NIFTY_50:
        return "Large Cap"
    if symbol in _NIFTY_NEXT_50:
        return "Large Cap"
    if symbol in _MIDCAP_150:
        return "Mid Cap"
    return "Small Cap"


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: FILE PARSER
# ─────────────────────────────────────────────────────────────────────────────

# Keywords that indicate a header row
_HEADER_KEYWORDS = {
    "isin", "quantity", "qty", "instrument", "stock name", "symbol",
    "avg. cost", "avg cost", "average buy price", "average cost",
    "ltp", "cur. val", "current value", "closing value"
}

# Broker signature detection
_BROKER_SIGNATURES = {
    "zerodha": {"avg. cost", "cur. val", "instrument"},
    "groww":   {"average buy price", "closing value", "stock name"},
    "dhan":    {"average price", "closing balance"},  # provisional
}


def _normalize_header(h: str) -> str:
    return h.strip().lower()


def _score_row_as_header(row: List[str]) -> float:
    """Return fraction of cells in `row` that look like header keywords."""
    if not row:
        return 0.0
    normalized = [_normalize_header(c) for c in row]
    hits = sum(1 for c in normalized if any(kw in c for kw in _HEADER_KEYWORDS))
    return hits / len(row)


def _detect_broker(headers: List[str]) -> Tuple[str, float]:
    """Match header set to known broker signatures. Returns (broker, confidence)."""
    normalized = {_normalize_header(h) for h in headers}
    best_broker = "unknown"
    best_score = 0.0
    for broker, sig in _BROKER_SIGNATURES.items():
        matches = sum(1 for kw in sig if any(kw in nh for nh in normalized))
        score = matches / len(sig)
        if score > best_score:
            best_broker, best_score = broker, score
    if best_score < 0.5:
        best_broker = "unknown"
    return best_broker, best_score


def _map_row_zerodha(headers: List[str], row: Dict[str, str]) -> Optional[Dict]:
    """Map a Zerodha row to normalized fields."""
    def _find(row, *candidates):
        for c in candidates:
            for k, v in row.items():
                if c in _normalize_header(k):
                    return v
        return None

    symbol_raw = _find(row, "instrument", "symbol")
    qty_raw    = _find(row, "qty", "quantity")
    price_raw  = _find(row, "avg. cost", "avg cost", "average cost", "avg")
    isin_raw   = _find(row, "isin")

    if not symbol_raw or not qty_raw or not price_raw:
        return None

    try:
        qty   = float(str(qty_raw).replace(",", "").strip())
        price = float(str(price_raw).replace(",", "").strip())
    except ValueError:
        return None

    # Zerodha exports raw NSE symbols — append .NS if missing
    symbol = str(symbol_raw).strip().upper()
    if "." not in symbol:
        symbol = symbol + ".NS"

    return {
        "symbol":       symbol,
        "isin":         str(isin_raw).strip().upper() if isin_raw else None,
        "company_name": str(symbol_raw).strip(),
        "quantity":     qty,
        "avg_price":    price,
    }


def _map_row_groww(headers: List[str], row: Dict[str, str]) -> Optional[Dict]:
    """Map a Groww row to normalized fields."""
    def _find(row, *candidates):
        for c in candidates:
            for k, v in row.items():
                if c in _normalize_header(k):
                    return v
        return None

    name_raw  = _find(row, "stock name")
    isin_raw  = _find(row, "isin")
    qty_raw   = _find(row, "quantity")
    price_raw = _find(row, "average buy price")

    if not qty_raw or not price_raw:
        return None

    try:
        qty   = float(str(qty_raw).replace(",", "").strip())
        price = float(str(price_raw).replace(",", "").strip())
    except ValueError:
        return None

    isin = str(isin_raw).strip().upper() if isin_raw else None
    name = str(name_raw).strip() if name_raw else None

    return {
        "symbol":       None,   # will be resolved in symbol resolver
        "isin":         isin,
        "company_name": name,
        "quantity":     qty,
        "avg_price":    price,
    }


def _map_row_generic(headers: List[str], row: Dict[str, str],
                     field_map: Dict[str, str]) -> Optional[Dict]:
    """Map an unknown-broker row using a user-supplied field_map."""
    def _get(row, col_name):
        return row.get(col_name, "").strip()

    sym_col   = field_map.get("symbol")
    isin_col  = field_map.get("isin")
    qty_col   = field_map.get("quantity")
    price_col = field_map.get("avg_price")

    if not qty_col or not price_col:
        return None

    qty_raw   = _get(row, qty_col)
    price_raw = _get(row, price_col)

    if not qty_raw or not price_raw:
        return None

    try:
        qty   = float(str(qty_raw).replace(",", "").strip())
        price = float(str(price_raw).replace(",", "").strip())
    except ValueError:
        return None

    symbol_raw = _get(row, sym_col) if sym_col else None
    isin_raw   = _get(row, isin_col) if isin_col else None

    symbol = None
    if symbol_raw:
        symbol = symbol_raw.strip().upper()
        if "." not in symbol:
            symbol = symbol + ".NS"

    return {
        "symbol":       symbol,
        "isin":         isin_raw.strip().upper() if isin_raw else None,
        "company_name": symbol_raw or isin_raw or "",
        "quantity":     qty,
        "avg_price":    price,
    }


def parse_csv_bytes(file_bytes: bytes) -> Tuple[List[str], List[Dict[str, str]], Dict]:
    """Parse CSV bytes. Returns (headers, data_rows, metadata)."""
    try:
        text = file_bytes.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = file_bytes.decode("latin-1")

    reader_rows = list(csv.reader(io.StringIO(text)))
    return _find_header_and_data(reader_rows)


def parse_xlsx_bytes(file_bytes: bytes) -> Tuple[List[str], List[Dict[str, str]], Dict]:
    """Parse XLSX bytes using openpyxl. Returns (headers, data_rows, metadata)."""
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl is required for XLSX parsing. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    ws = wb.active

    raw_rows = []
    for row in ws.iter_rows(values_only=True):
        # Convert everything to strings, preserve None as ""
        raw_rows.append([str(c).strip() if c is not None else "" for c in row])

    wb.close()
    return _find_header_and_data(raw_rows)


def _find_header_and_data(
    rows: List[List[str]]
) -> Tuple[List[str], List[Dict[str, str]], Dict]:
    """
    Scan rows top-to-bottom to find the header row.
    Everything above the header is treated as metadata.
    Returns (headers, data_rows_as_dicts, metadata_dict).
    """
    header_idx = None
    headers: List[str] = []
    metadata: Dict[str, Any] = {}

    # Collect metadata rows above the header
    raw_meta_rows = []

    for i, row in enumerate(rows):
        score = _score_row_as_header(row)
        if score >= 0.35 and len([c for c in row if c.strip()]) >= 3:
            header_idx = i
            headers = [c.strip() for c in row]
            break
        else:
            raw_meta_rows.append(row)

    if header_idx is None:
        return [], [], {}

    # Parse data rows
    data_rows = []
    for row in rows[header_idx + 1:]:
        # Stop at blank row
        if all(c.strip() == "" for c in row):
            break
        row_dict = {}
        for j, h in enumerate(headers):
            row_dict[h] = row[j].strip() if j < len(row) else ""
        # Skip entirely empty rows
        if any(v for v in row_dict.values()):
            data_rows.append(row_dict)

    # Extract Groww-style metadata from rows above header
    for row in raw_meta_rows:
        joined = " ".join(c for c in row if c.strip()).lower()
        if "invested" in joined:
            for c in row:
                try:
                    metadata["invested_value"] = float(c.replace(",", "").strip())
                    break
                except ValueError:
                    pass
        elif "closing value" in joined or "current value" in joined:
            for c in row:
                try:
                    metadata["closing_value"] = float(c.replace(",", "").strip())
                    break
                except ValueError:
                    pass
        elif "unrealised" in joined or "unrealized" in joined:
            for c in row:
                try:
                    metadata["unrealised_pnl"] = float(c.replace(",", "").strip())
                    break
                except ValueError:
                    pass
        elif "holdings statement for stocks as on" in joined:
            # Extract statement date e.g. "Holdings statement for stocks as on 15-07-2026"
            import re
            m = re.search(r"as on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})", joined)
            if m:
                metadata["statement_date"] = m.group(1)

    return headers, data_rows, metadata


def parse_uploaded_file(
    file_bytes: bytes,
    filename: str,
    field_map: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Main entry point for file parsing.
    Returns a ParseResult dict for the frontend preview screen.

    field_map is used for unknown-broker files where the user has manually
    mapped column names: {"symbol": "Script Name", "quantity": "No of Shares", ...}
    """
    fname_lower = filename.lower()

    try:
        if fname_lower.endswith(".csv"):
            headers, data_rows, metadata = parse_csv_bytes(file_bytes)
        elif fname_lower.endswith((".xlsx", ".xls")):
            headers, data_rows, metadata = parse_xlsx_bytes(file_bytes)
        else:
            return {"error": f"Unsupported file type: {filename}. Use CSV or XLSX."}
    except Exception as e:
        logger.error(f"File parse error: {e}")
        return {"error": f"Could not parse file: {str(e)}"}

    if not headers:
        return {"error": "Could not find data table in the uploaded file. Please check the file format."}

    broker, confidence = _detect_broker(headers)

    # Map rows to normalized fields
    parsed_rows = []
    broker_map_fn = None
    if field_map and broker == "unknown":
        broker_map_fn = lambda h, r: _map_row_generic(h, r, field_map)
    elif broker == "zerodha":
        broker_map_fn = _map_row_zerodha
    elif broker == "groww":
        broker_map_fn = _map_row_groww
    # dhan: falls through to unknown for now

    if broker_map_fn:
        for row in data_rows:
            mapped = broker_map_fn(headers, row)
            if mapped:
                parsed_rows.append(mapped)
    else:
        # Unknown broker without field_map — return raw headers for frontend mapping
        return {
            "broker_detected": "unknown",
            "confidence": 0.0,
            "headers": headers,
            "raw_rows": data_rows[:5],  # preview sample
            "parsed_rows": [],
            "metadata": metadata,
            "requires_column_mapping": True,
        }

    # Groww integrity check
    integrity_warning = None
    if broker == "groww" and "invested_value" in metadata and parsed_rows:
        stated = metadata["invested_value"]
        computed = sum(r["quantity"] * r["avg_price"] for r in parsed_rows if r.get("quantity") and r.get("avg_price"))
        if stated > 0 and abs(computed - stated) / stated > 0.02:  # > 2% difference
            integrity_warning = (
                f"Warning: Sum of parsed holdings buy values (₹{computed:,.0f}) differs from "
                f"the stated Invested Value in the file (₹{stated:,.0f}). "
                "Some rows may have been missed or misread. Please review carefully."
            )

    return {
        "broker_detected": broker,
        "confidence": round(confidence, 2),
        "headers": headers,
        "parsed_rows": parsed_rows,
        "metadata": metadata,
        "integrity_warning": integrity_warning,
        "requires_column_mapping": False,
        "row_count": len(parsed_rows),
    }


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: SYMBOL RESOLVER
# ─────────────────────────────────────────────────────────────────────────────

_isin_map_cache: Optional[Dict[str, Dict]] = None
_name_list_cache: Optional[List[Dict]] = None


def _load_isin_map() -> Dict[str, Dict]:
    global _isin_map_cache
    if _isin_map_cache is not None:
        return _isin_map_cache
    path = os.path.join(_DATA_DIR, "isin_map.json")
    if os.path.exists(path):
        with open(path, "r") as f:
            _isin_map_cache = json.load(f)
    else:
        _isin_map_cache = {}
    return _isin_map_cache


def _load_name_list() -> List[Dict]:
    global _name_list_cache
    if _name_list_cache is not None:
        return _name_list_cache
    path = os.path.join(_DATA_DIR, "nse_symbol_list.json")
    if os.path.exists(path):
        with open(path, "r") as f:
            _name_list_cache = json.load(f)
    else:
        _name_list_cache = []
    return _name_list_cache


def resolve_symbol(
    name: Optional[str],
    isin: Optional[str],
    symbol_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve a holding's stock name / ISIN to a Yahoo Finance ticker.

    Priority:
    1. symbol_hint already in .NS format → trust it
    2. ISIN exact match in isin_map
    3. Company name fuzzy-match against name list
    4. Unresolved → return None symbol with candidates list

    Returns { symbol, company_name, confidence, method, candidates }
    """
    isin_map  = _load_isin_map()
    name_list = _load_name_list()

    # 1. Symbol hint
    if symbol_hint and "." in symbol_hint:
        return {
            "symbol":       symbol_hint.upper(),
            "company_name": name or symbol_hint,
            "confidence":   1.0,
            "method":       "symbol_hint",
            "candidates":   [],
        }

    # 2. ISIN match
    if isin and isin.upper() in isin_map:
        entry = isin_map[isin.upper()]
        return {
            "symbol":       entry["yahoo_symbol"],
            "company_name": entry["company_name"],
            "confidence":   1.0,
            "method":       "isin_exact",
            "candidates":   [],
        }

    # 3. Fuzzy name match
    if name:
        all_names = [item["name"] for item in name_list]
        matches = get_close_matches(name, all_names, n=3, cutoff=0.5)
        if matches:
            best_name = matches[0]
            best_entry = next(item for item in name_list if item["name"] == best_name)
            symbol = best_entry["symbol"]
            if "." not in symbol:
                symbol = symbol + ".NS"
            confidence = 0.9 if len(matches) == 1 else 0.65
            candidates = []
            for m in matches[1:]:
                entry = next((item for item in name_list if item["name"] == m), None)
                if entry:
                    candidates.append({"name": m, "symbol": entry["symbol"]})
            return {
                "symbol":       symbol,
                "company_name": best_name,
                "confidence":   confidence,
                "method":       "fuzzy_name",
                "candidates":   candidates,
            }

    # 4. Unresolved
    return {
        "symbol":       None,
        "company_name": name or isin or "Unknown",
        "confidence":   0.0,
        "method":       "unresolved",
        "candidates":   [],
    }


def resolve_parsed_rows(parsed_rows: List[Dict]) -> List[Dict]:
    """
    Run resolve_symbol for each parsed row. Attaches resolution result.
    Rows with symbol=None are flagged as unresolved for frontend review.
    """
    resolved = []
    for row in parsed_rows:
        res = resolve_symbol(
            name=row.get("company_name"),
            isin=row.get("isin"),
            symbol_hint=row.get("symbol"),
        )
        row_out = dict(row)
        row_out["resolved_symbol"]  = res["symbol"]
        row_out["resolved_name"]    = res["company_name"]
        row_out["resolution_confidence"] = res["confidence"]
        row_out["resolution_method"] = res["method"]
        row_out["resolution_candidates"] = res["candidates"]
        row_out["is_unresolved"]    = res["symbol"] is None
        resolved.append(row_out)
    return resolved


def search_symbols(query: str, limit: int = 10) -> List[Dict]:
    """Autocomplete for manual entry stock search."""
    name_list = _load_name_list()
    q = query.lower().strip()
    if not q:
        return []
    results = []
    for item in name_list:
        if q in item["name"].lower() or q in item["symbol"].lower():
            results.append(item)
        if len(results) >= limit:
            break
    # Also run fuzzy match to catch typos
    if len(results) < limit:
        all_names = [item["name"] for item in name_list]
        fuzzy = get_close_matches(query, all_names, n=limit - len(results), cutoff=0.4)
        for name in fuzzy:
            entry = next((item for item in name_list if item["name"] == name), None)
            if entry and entry not in results:
                results.append(entry)
    return results[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: ANALYSIS ENGINE
# ─────────────────────────────────────────────────────────────────────────────

_analysis_cache: Dict[str, Dict] = {}  # key: portfolio_id, value: {result, fetched_at}
_ANALYSIS_CACHE_TTL = 60  # seconds


def _fetch_quote_for_holding(symbol: str) -> Dict[str, Any]:
    """Fetch live quote + RSI + fundamentals for a single holding symbol."""
    try:
        import yfinance as yf
        import numpy as np

        ticker = yf.Ticker(symbol, session=yf_session)
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        fi = ticker.fast_info
        price      = getattr(fi, "last_price", None)
        prev_close = getattr(fi, "previous_close", None)
        year_high  = getattr(fi, "year_high", None)
        year_low   = getattr(fi, "year_low", None)

        def _f(v):
            return round(float(v), 2) if v is not None else None

        change = None
        change_pct = None
        if price and prev_close and prev_close != 0:
            change = round(float(price) - float(prev_close), 2)
            change_pct = round(change / float(prev_close) * 100, 2)

        # RSI(14) from daily history
        rsi = None
        week52_position = None
        try:
            df = ticker.history(period="3mo", interval="1d")
            if not df.empty and len(df) >= 15:
                delta = df["Close"].diff()
                gain  = delta.clip(lower=0)
                loss  = -delta.clip(upper=0)
                avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
                avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()
                rs = avg_gain / np.where(avg_loss == 0, 1e-9, avg_loss)
                rsi_series = 100 - (100 / (1 + rs))
                rsi = round(float(rsi_series.iloc[-1]), 1)
        except Exception:
            pass

        # 52-week position %
        if price and year_high and year_low and year_high != year_low:
            week52_position = round((float(price) - float(year_low)) / (float(year_high) - float(year_low)) * 100, 1)

        return {
            "symbol":           symbol,
            "name":             info.get("longName") or info.get("shortName") or symbol,
            "sector":           info.get("sector") or SECTOR_MAP.get(symbol, "Other"),
            "price":            _f(price),
            "prev_close":       _f(prev_close),
            "change":           change,
            "change_pct":       change_pct,
            "year_high":        _f(year_high),
            "year_low":         _f(year_low),
            "rsi":              rsi,
            "week52_position":  week52_position,
            "pe_ratio":         info.get("trailingPE"),
            "pb_ratio":         info.get("priceToBook"),
            "dividend_yield":   info.get("dividendYield"),
            "market_cap":       info.get("marketCap"),
            "error":            None,
        }
    except Exception as ex:
        return {"symbol": symbol, "error": str(ex), "price": None}


def compute_portfolio_analysis(holdings: List[Dict]) -> Dict[str, Any]:
    """
    Compute full portfolio analysis from a list of holding dicts.
    Each holding must have: symbol, quantity, avg_price, company_name.
    """
    if not holdings:
        return {"error": "No holdings to analyse"}

    symbols = list({h["symbol"] for h in holdings if h.get("symbol")})

    # Batch-fetch live data
    live_data: Dict[str, Dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(symbols), 12)) as executor:
        futures = {executor.submit(_fetch_quote_for_holding, sym): sym for sym in symbols}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                live_data[sym] = future.result()
            except Exception as ex:
                live_data[sym] = {"symbol": sym, "error": str(ex), "price": None}

    # Compute per-holding metrics
    holding_rows = []
    total_invested = 0.0
    total_current  = 0.0

    for h in holdings:
        sym  = h.get("symbol")
        qty  = float(h.get("quantity", 0))
        avg  = float(h.get("avg_price", 0))
        name = h.get("company_name", sym)

        invested = qty * avg
        total_invested += invested

        live = live_data.get(sym, {})
        price = live.get("price")

        current_val = qty * price if price else None
        if current_val:
            total_current += current_val

        pnl_abs = round(current_val - invested, 2) if current_val else None
        pnl_pct = round((current_val - invested) / invested * 100, 2) if current_val and invested > 0 else None
        day_change_abs = round(qty * live.get("change", 0), 2) if live.get("change") is not None else None

        sector = live.get("sector") or SECTOR_MAP.get(sym, "Other")

        holding_rows.append({
            "id":               h.get("id"),
            "symbol":           sym,
            "name":             live.get("name") or name,
            "sector":           sector,
            "market_cap_tier":  _get_market_cap_tier(sym),
            "quantity":         qty,
            "avg_price":        avg,
            "invested_value":   round(invested, 2),
            "current_price":    price,
            "current_value":    round(current_val, 2) if current_val else None,
            "pnl_abs":          pnl_abs,
            "pnl_pct":          pnl_pct,
            "day_change_abs":   day_change_abs,
            "day_change_pct":   live.get("change_pct"),
            "rsi":              live.get("rsi"),
            "week52_position":  live.get("week52_position"),
            "year_high":        live.get("year_high"),
            "year_low":         live.get("year_low"),
            "pe_ratio":         live.get("pe_ratio"),
            "pb_ratio":         live.get("pb_ratio"),
            "dividend_yield":   live.get("dividend_yield"),
            "rsi_flag":         "OVERBOUGHT" if live.get("rsi") and live["rsi"] > 70 else
                                "OVERSOLD"   if live.get("rsi") and live["rsi"] < 30 else None,
            "week52_flag":      "NEAR_52W_LOW" if live.get("week52_position") is not None and live["week52_position"] < 10 else None,
        })

    # Total day change
    total_day_change = sum(r["day_change_abs"] for r in holding_rows if r.get("day_change_abs"))
    total_pnl_abs = round(total_current - total_invested, 2)
    total_pnl_pct = round(total_pnl_abs / total_invested * 100, 2) if total_invested > 0 else 0

    # Stock allocation weights
    for r in holding_rows:
        r["weight_pct"] = round(r["invested_value"] / total_invested * 100, 2) if total_invested > 0 else 0

    # Sector allocation
    sector_map: Dict[str, float] = {}
    for r in holding_rows:
        s = r["sector"] or "Other"
        sector_map[s] = round(sector_map.get(s, 0) + r["weight_pct"], 2)
    sector_allocation = sorted(
        [{"sector": k, "weight_pct": v} for k, v in sector_map.items()],
        key=lambda x: x["weight_pct"], reverse=True
    )

    # Market-cap tier allocation
    cap_map: Dict[str, float] = {}
    for r in holding_rows:
        t = r["market_cap_tier"]
        cap_map[t] = round(cap_map.get(t, 0) + r["weight_pct"], 2)
    cap_allocation = [{"tier": k, "weight_pct": v} for k, v in cap_map.items()]

    # Concentration risk
    STOCK_THRESHOLD  = 15.0
    SECTOR_THRESHOLD = 35.0

    concentration_flags = []
    for r in holding_rows:
        if r["weight_pct"] >= STOCK_THRESHOLD:
            concentration_flags.append({
                "type":    "stock",
                "label":   r["name"] or r["symbol"],
                "symbol":  r["symbol"],
                "weight":  r["weight_pct"],
                "threshold": STOCK_THRESHOLD,
            })
    for s in sector_allocation:
        if s["weight_pct"] >= SECTOR_THRESHOLD:
            concentration_flags.append({
                "type":    "sector",
                "label":   s["sector"],
                "weight":  s["weight_pct"],
                "threshold": SECTOR_THRESHOLD,
            })

    # HHI diversification score (0–100, lower = more diversified)
    weights_frac = [r["weight_pct"] / 100 for r in holding_rows]
    hhi = round(sum(w**2 for w in weights_frac) * 10000, 1)  # 0-10000 scale
    hhi_score = round(max(0, min(100, 100 - hhi / 100)), 1)  # invert to "diversification score"

    # Sort holdings: best performers first for the top section
    holding_rows_sorted = sorted(
        holding_rows, key=lambda r: (r.get("pnl_pct") or -999), reverse=True
    )

    return {
        "summary": {
            "total_invested":    round(total_invested, 2),
            "total_current":     round(total_current, 2),
            "total_pnl_abs":     total_pnl_abs,
            "total_pnl_pct":     total_pnl_pct,
            "total_day_change":  round(total_day_change, 2),
            "num_holdings":      len(holding_rows),
            "num_sectors":       len(sector_map),
        },
        "holdings":             holding_rows_sorted,
        "stock_allocation":     sorted(holding_rows, key=lambda r: r["weight_pct"], reverse=True),
        "sector_allocation":    sector_allocation,
        "cap_allocation":       cap_allocation,
        "concentration_flags":  concentration_flags,
        "diversification_score": hhi_score,
        "hhi":                  hhi,
        "computed_at":          time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
