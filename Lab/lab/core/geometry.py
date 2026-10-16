"""Generic geometry → mass/export math. Everything here operates on a `PartSpec`
(a build123d solid plus a material + mass mode) and `Material` — never on anything a
domain invented, which is what lets a boat's hull and an aircraft's wing share this
file unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from build123d import Drawing, ExportDXF, Keep, LineType, Plane, Unit, export_step, export_stl, section

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


@dataclass(frozen=True)
class DrawingView:
    """One view direction for a technical drawing. `look_up` must not be parallel to
    `look_from` — build123d's own hidden-line-removal projector degenerates (a
    zero-length cross product) when they are, e.g. looking straight down with
    `look_up=(0, 0, 1)`.
    """

    name: str
    look_from: tuple[float, float, float]
    look_up: tuple[float, float, float]


# Three standard orthographic views, enough to read a part's overall shape and
# proportions — not a substitute for a dimensioned, annotated drawing a human signs
# off manufacturing from (no dimension lines, no title block; see
# IMPLEMENTATION_PLAN.md). A domain can pass its own `views` to `export_drawing` for a
# more natural set (e.g. a hull's "profile"/"plan"/"body plan" under different names)
# without this module changing.
STANDARD_VIEWS: tuple[DrawingView, ...] = (
    DrawingView("side", (0, -1, 0), (0, 0, 1)),
    DrawingView("top", (0, 0, 1), (1, 0, 0)),
    DrawingView("front", (1, 0, 0), (0, 0, 1)),
)

DRAWING_MARGIN_MM = 20.0


def export_drawing(spec: PartSpec, out_dir: Path, name: str, views: Sequence[DrawingView] = STANDARD_VIEWS) -> str:
    """A multi-view technical drawing — hidden-line-removed orthographic projections
    of the part, laid out left to right on one sheet (DXF, visible/hidden on separate
    layers) — generated straight from the same solid that produces the STEP/STL, so it
    can never silently drift from the model's current parameters the way a hand-drawn
    sketch could. Each view is normalized to its own bounding box before being placed,
    so the layout only depends on the views' sizes, not on where the part happens to
    sit in its own modeling coordinates.
    """

    exporter = ExportDXF(unit=Unit.MM)
    exporter.add_layer("visible", line_weight=0.35)
    exporter.add_layer("hidden", line_type=LineType.DASHED, line_weight=0.18)

    cursor_x = 0.0
    for view in views:
        drawing = Drawing(spec.part, look_from=view.look_from, look_up=view.look_up)
        bbox = drawing.visible_lines.bounding_box()
        offset = (cursor_x - bbox.min.X, -bbox.min.Y, 0.0)

        exporter.add_shape(drawing.visible_lines.translate(offset), layer="visible")
        exporter.add_shape(drawing.hidden_lines.translate(offset), layer="hidden")

        cursor_x += (bbox.max.X - bbox.min.X) + DRAWING_MARGIN_MM

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.dxf"
    exporter.write(str(path))

    return str(path)


@dataclass(frozen=True)
class StationAreaProfile:
    """Submerged cross-sectional area (mm²) at one station along a hull's length, sampled at
    `z_samples_mm` (interpolated linearly in between) — the precomputed, CAD-kernel-expensive
    half of a trim-solving hydrostatics calculation. Measured once per station, from this
    project's real hull: a live 3D split per solver trial costs ~70ms (unworkable for the
    ~1,000-trial nested bisection a draft+trim solve needs — see
    `domains/boat/calculators.py`); a 2D split of a precomputed cross-section costs ~1ms.
    This mirrors boat-rc's own approach (a half-width table ray-cast once in Fusion, then pure
    Python math against it) — just built from a live solid instead of a ray-cast.
    """

    x_mm: float
    z_samples_mm: tuple[float, ...]
    area_mm2: tuple[float, ...]

    def area_at(self, z_mm: float) -> float:
        if z_mm <= self.z_samples_mm[0]:
            return 0.0
        if z_mm >= self.z_samples_mm[-1]:
            return self.area_mm2[-1]

        for i in range(1, len(self.z_samples_mm)):
            z1 = self.z_samples_mm[i]
            if z_mm <= z1:
                z0 = self.z_samples_mm[i - 1]
                a0, a1 = self.area_mm2[i - 1], self.area_mm2[i]
                t = (z_mm - z0) / (z1 - z0) if z1 > z0 else 0.0

                return a0 + (a1 - a0) * t

        return self.area_mm2[-1]  # pragma: no cover — z_mm < z_samples_mm[-1] already handled above


def station_area_profiles(
    part, x_stations_mm: Sequence[float], z_max_mm: float, z_samples: int = 25
) -> list[StationAreaProfile]:
    """Builds the table `StationAreaProfile`/a trim solve needs: one 2D cross-section per
    station (`section`), each sliced at `z_samples` heights (`split` + `.area`). A station
    outside the part's own extent along its sectioning axis yields an empty cross-section —
    recorded as all-zero area rather than raising, so a caller can pick stations without first
    checking the part's own bounding box.
    """

    z_grid = tuple(z_max_mm * i / (z_samples - 1) for i in range(z_samples))
    profiles: list[StationAreaProfile] = []

    for x in x_stations_mm:
        try:
            cross_section = section(part, section_by=Plane.YZ.offset(x))
        except Exception:
            cross_section = None

        areas: list[float] = []
        for z in z_grid:
            if cross_section is None or z <= 0:
                areas.append(0.0)
                continue

            try:
                below = cross_section.split(Plane.XY.offset(z), keep=Keep.BOTTOM)
                areas.append(below.area if below else 0.0)
            except Exception:
                areas.append(areas[-1] if areas else 0.0)

        profiles.append(StationAreaProfile(x_mm=x, z_samples_mm=z_grid, area_mm2=tuple(areas)))

    return profiles
