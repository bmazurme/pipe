"""The one seam a vehicle class (boat, aircraft, ...) has to implement. Nothing in
`lab.core` imports a domain module by name — `lab.core.cli` only ever talks to whatever
`lab.core.registry.get(name)` returns, through this interface. Adding a new vehicle
class never touches a single file under `lab/core/`; see the README's "adding a new
domain" section.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from .bom import BomLine


@dataclass
class PartSpec:
    """One named solid a domain's geometry produces, plus how core should turn it into
    mass and cost. The geometry/material decision (is this part printed as a thin
    shell, or is it solid?) is a manufacturing judgment specific to that part, so it
    lives here, next to the part — `core.geometry` just executes whichever mode is
    named, it never guesses.
    """

    part: Any  # a build123d Part/Solid — typed Any so core never imports build123d types it doesn't need to touch directly
    material: str  # key into lab.core.materials.MATERIALS
    mode: str = "solid"  # "solid" | "shell"
    shell_thickness_mm: float | None = None
    note: str = ""


@dataclass
class BuildResult:
    """What `Domain.build()` hands back: every named part of the vehicle. Geometry
    export and mass/cost roll-up both iterate this dict without caring what the parts
    mean domain-wise.
    """

    parts: dict[str, PartSpec]


@dataclass
class CalcContext:
    """Assembled by core before any domain calculator runs, so a calculator never has
    to re-derive mass/cost itself — it only adds domain-specific physics on top
    (hydrostatics, wing loading, ...).
    """

    params: dict
    build: BuildResult
    mass_kg: dict[str, float]  # part name -> kg, filled in by core
    cost_rub: dict[str, float]  # part name -> RUB, filled in by core
    total_mass_kg: float
    total_cost_rub: float


# A calculator takes the assembled context and returns a flat dict of named metrics
# (value may be a number, string or None — None for "could not be computed", surfaced
# as-is in the report rather than raising, so one failing calculator doesn't blank the
# whole run).
Calculator = Callable[[CalcContext], dict[str, Any]]


class Domain(ABC):
    """Base class every vehicle-class module subclasses once and registers a single
    instance of, via `lab.core.registry.register`.
    """

    name: str

    @abstractmethod
    def build(self, params: dict) -> BuildResult:
        """Turn this project's `params` (from project.yaml) into named solids."""

    @property
    @abstractmethod
    def calculators(self) -> dict[str, Calculator]:
        """Named domain calculators, run in dict order against the assembled context."""

    def default_bom(self, params: dict) -> list[BomLine]:
        """Purchased components a project doesn't already list in its own
        `purchased_bom` — most projects will just list their own in project.yaml, so
        the base implementation is empty rather than abstract.
        """

        return []
