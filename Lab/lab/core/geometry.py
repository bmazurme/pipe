"""Generic geometry → mass/export math. Everything here operates on a `PartSpec`
(a build123d solid plus a material + mass mode) and `Material` — never on anything a
domain invented, which is what lets a boat's hull and an aircraft's wing share this
file unchanged.
"""

from __future__ import annotations

from pathlib import Path

from build123d import export_step, export_stl

from . import materials
from .domain import PartSpec

MM3_PER_M3 = 1_000_000_000.0


def volume_mm3(spec: PartSpec) -> float:
    """The volume core actually bills as material: the solid's own volume for a solid
    part, or surface-area × wall-thickness for a thin printed shell. Hydrostatics and
    other envelope calculations should use `spec.part.volume`/`spec.part` directly
    instead — displacement is about the outer envelope regardless of wall thickness,
    this function is specifically "how much material is there".
    """

    if spec.mode == "solid":
        return spec.part.volume

    if spec.mode == "shell":
        if not spec.shell_thickness_mm:
            raise ValueError(f"shell-часть {spec.note or ''!r} не задала shell_thickness_mm")
        return spec.part.area * spec.shell_thickness_mm

    raise ValueError(f"Неизвестный mode {spec.mode!r} — ожидался 'solid' или 'shell'")


def mass_kg(spec: PartSpec) -> float:
    material = materials.get(spec.material)
    return volume_mm3(spec) / MM3_PER_M3 * material.density_kg_m3


def material_cost_rub(spec: PartSpec, mass_kg_value: float) -> float:
    return mass_kg_value * materials.get(spec.material).cost_per_kg_rub


def export_part(spec: PartSpec, out_dir: Path, name: str) -> dict[str, str]:
    """Writes STEP (exact, for CAM/inspection) and STL (for slicing/printing) and
    returns their paths. Only ever called by the CLI, deliberately not by a
    calculator — a calculator computes numbers, it does not touch the filesystem.
    """

    out_dir.mkdir(parents=True, exist_ok=True)
    step_path = out_dir / f"{name}.step"
    stl_path = out_dir / f"{name}.stl"
    export_step(spec.part, str(step_path))
    export_stl(spec.part, str(stl_path))

    return {"step": str(step_path), "stl": str(stl_path)}
