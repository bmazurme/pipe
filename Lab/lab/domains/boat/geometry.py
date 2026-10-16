"""Parametric planing-hull geometry: a loft through 5 V-bottom cross-section
stations. The station proportions below are a fixed "shape archetype" (narrow raised
bow, full beam reached quickly, slight taper to a transom) — not meant to fit every
hull style. Swapping this for a shape driven by more/parametrized stations is exactly
the kind of change that should stay inside this one file; see
IMPLEMENTATION_PLAN.md's "Lab phase 2" notes.
"""

from __future__ import annotations

import math

from build123d import BuildLine, BuildPart, BuildSketch, Plane, Polyline, loft, make_face

from lab.core.domain import BuildResult, PartSpec

# Fraction along the hull (0 = bow, 1 = stern) of each station, and that station's
# half-beam/height as a fraction of the project's max beam/height.
STATION_X_FRACTIONS = (0.0, 0.12, 0.35, 0.7, 1.0)
HALF_BEAM_FRACTIONS = (0.03, 0.55, 1.0, 1.0, 0.82)
HEIGHT_FRACTIONS = (0.70, 0.92, 1.0, 0.95, 0.88)


def _station_profile(half_beam_mm: float, height_mm: float, deadrise_deg: float) -> list[tuple[float, float]]:
    """A symmetric V-bottom cross-section, closed across the deck (a simplification:
    the real boat is open-cockpit, which would reduce both displacement and printed
    mass a little — left for phase 2, see module docstring): keel -> chine -> deck
    corner, mirrored.
    """

    rise = half_beam_mm * math.tan(math.radians(deadrise_deg))

    return [
        (-half_beam_mm, height_mm),
        (-half_beam_mm, rise),
        (0, 0),
        (half_beam_mm, rise),
        (half_beam_mm, height_mm),
        (-half_beam_mm, height_mm),
    ]


def build_hull(params: dict):
    length = params["length_mm"]
    beam = params["beam_mm"]
    height = params["height_mm"]
    deadrise = params.get("deadrise_deg", 12)

    with BuildPart() as hull:
        for x_frac, beam_frac, height_frac in zip(STATION_X_FRACTIONS, HALF_BEAM_FRACTIONS, HEIGHT_FRACTIONS):
            with BuildSketch(Plane.YZ.offset(length * x_frac)):
                with BuildLine():
                    Polyline(*_station_profile(beam / 2 * beam_frac, height * height_frac, deadrise), close=True)
                make_face()
        loft()

    return hull.part


def build(params: dict) -> BuildResult:
    hull = build_hull(params)

    return BuildResult(
        parts={
            "hull": PartSpec(
                part=hull,
                material=params.get("hull_material", "pla"),
                mode="shell",
                shell_thickness_mm=params.get("wall_thickness_mm", 2.4),
                note="Корпус — V-образное дно, лофт по 5 сечениям, печатается как тонкостенная оболочка",
            )
        }
    )
