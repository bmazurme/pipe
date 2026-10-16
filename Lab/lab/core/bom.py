"""Bill-of-materials lines and their cost roll-up — domain-agnostic: a line doesn't
care whether it's a printed hull, a milled bracket or a purchased motor.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BomLine:
    part: str
    source: str  # "printed" | "machined" | "purchased"
    qty: int = 1
    unit_cost_rub: float = 0.0
    unit_mass_kg: float = 0.0
    note: str = ""

    @property
    def total_cost_rub(self) -> float:
        return self.qty * self.unit_cost_rub

    @property
    def total_mass_kg(self) -> float:
        return self.qty * self.unit_mass_kg


@dataclass
class BomRollup:
    lines: list[BomLine] = field(default_factory=list)

    @property
    def total_cost_rub(self) -> float:
        return sum(line.total_cost_rub for line in self.lines)

    @property
    def total_mass_kg(self) -> float:
        return sum(line.total_mass_kg for line in self.lines)

    def as_dict(self) -> dict:
        return {
            "total_cost_rub": round(self.total_cost_rub, 2),
            "total_mass_kg": round(self.total_mass_kg, 4),
            "lines": [
                {
                    "part": line.part,
                    "source": line.source,
                    "qty": line.qty,
                    "unit_cost_rub": line.unit_cost_rub,
                    "unit_mass_kg": round(line.unit_mass_kg, 4),
                    "total_cost_rub": round(line.total_cost_rub, 2),
                    "note": line.note,
                }
                for line in self.lines
            ],
        }
