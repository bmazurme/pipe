"""The material catalog — shared by every domain. Nothing here knows what a hull or a
wing is; a domain only ever refers to a material by its key (e.g. "pla") and the core
geometry/printing/BOM math looks the properties up from here.

Costs are placeholder RUB/kg figures for MVP evaluation, not a quoted supplier price —
flagged in IMPLEMENTATION_PLAN.md as something phase 2 should replace with a real,
maintained catalog (and, for printing, a real slicer profile instead of `process`).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    label: str
    density_kg_m3: float
    cost_per_kg_rub: float
    # How core.printing should treat a part made of this material. "fdm_print" gets a
    # time/cost estimate from core.printing; "cnc_mill" and "purchased_bulk" currently
    # only get a material-cost line (CNC time estimation is out of scope for this MVP —
    # see IMPLEMENTATION_PLAN.md, CNC is the rare case).
    process: str


MATERIALS: dict[str, Material] = {
    "pla": Material("PLA", 1240, 1800, "fdm_print"),
    "petg": Material("PETG", 1270, 2200, "fdm_print"),
    "abs": Material("ABS", 1040, 2000, "fdm_print"),
    "nylon_cf": Material("Nylon-CF", 1100, 4500, "fdm_print"),
    "plywood_birch": Material("Фанера берёза", 650, 250, "cnc_mill"),
    "aluminum_6061": Material("Алюминий 6061", 2700, 350, "cnc_mill"),
    "eps_foam": Material("Пенопласт EPS", 20, 300, "hand_cut"),
    "balsa": Material("Бальза", 160, 900, "hand_cut"),
}


def get(key: str) -> Material:
    try:
        return MATERIALS[key]
    except KeyError as exc:
        raise KeyError(f"Неизвестный материал {key!r}. Известные: {sorted(MATERIALS)}") from exc
