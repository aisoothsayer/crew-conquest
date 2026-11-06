"""Load daily price history from CSV files."""

from __future__ import annotations

import csv
from pathlib import Path


def load_closes(path: str | Path) -> tuple[list[str], list[float]]:
    """Return (dates, closes) from a CSV.

    Accepts either a price file with a Close (or Adj Close) column, or a
    returns file with a return column, which is compounded into an index
    starting at 100. The date is the column named date, or the first column.
    """
    with open(path, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 2:
        raise ValueError(f"{path}: no data rows")
    header = [h.strip().lower() for h in rows[0]]
    date_col = header.index("date") if "date" in header else 0
    if "adj close" in header:
        mode, col = "price", header.index("adj close")
    elif "close" in header:
        mode, col = "price", header.index("close")
    elif "return" in header:
        mode, col = "return", header.index("return")
    else:
        raise ValueError(f"{path}: need a Close, Adj Close or return column")

    dates: list[str] = []
    closes: list[float] = []
    level = 100.0
    for row in rows[1:]:
        if not row or not row[col].strip():
            continue
        value = float(row[col])
        if mode == "return":
            level *= 1.0 + value
            value = level
        dates.append(row[date_col].strip()[:10])
        closes.append(value)
    return dates, closes
