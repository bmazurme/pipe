"""Loads a project directory's `project.yaml` — the one file a project author (human
or, later, a worker agent) edits. Everything in it is plain data; core does not
validate domain-specific `params` against a schema in this MVP (see
IMPLEMENTATION_PLAN.md) — an unknown/missing param surfaces as a plain KeyError from
inside the domain's own `build()`, not a nicer pre-validated message, yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .bom import BomLine

PROJECT_FILE = "project.yaml"


@dataclass
class Project:
    dir: Path
    name: str
    domain: str
    params: dict
    targets: dict
    purchased_bom: list[BomLine] = field(default_factory=list)


def load(project_dir: Path | str) -> Project:
    project_dir = Path(project_dir)
    raw = yaml.safe_load((project_dir / PROJECT_FILE).read_text(encoding="utf-8"))

    purchased = [
        BomLine(
            part=line["part"],
            source=line.get("source", "purchased"),
            qty=line.get("qty", 1),
            unit_cost_rub=line.get("unit_cost_rub", 0.0),
            unit_mass_kg=line.get("unit_mass_kg", 0.0),
            note=line.get("note", ""),
        )
        for line in raw.get("purchased_bom", [])
    ]

    return Project(
        dir=project_dir,
        name=raw["name"],
        domain=raw["domain"],
        params=raw.get("params", {}),
        targets=raw.get("targets", {}),
        purchased_bom=purchased,
    )
