"""A minimal tapered-wing solid — a flat-plate stand-in for a real airfoil profile
(no camber, no proper aerodynamic section), enough to validate mass/BOM/the project
pipeline for a structurally different vehicle class than the boat domain. A real
airfoil-section loft (NACA/Clark-Y profiles via spline sketches) is a named
phase-2/3 item in IMPLEMENTATION_PLAN.md, not attempted here — this domain exists to
prove the *seam* works, not to design a flyable wing.
"""

from __future__ import annotations

from build123d import BuildPart, BuildSketch, Plane, Rectangle, loft

from lab.core.domain import BuildResult, PartSpec


def build_wing(params: dict):
    span = params["wingspan_mm"]
    root_chord = params["root_chord_mm"]
    tip_chord = params["tip_chord_mm"]
    thickness_ratio = params.get("thickness_ratio", 0.12)

    with BuildPart() as wing:
        for y_offset, chord in ((-span / 2, tip_chord), (0, root_chord), (span / 2, tip_chord)):
            with BuildSketch(Plane.XZ.offset(y_offset)):
                Rectangle(chord, chord * thickness_ratio)
        loft(ruled=True)

    return wing.part


def build(params: dict) -> BuildResult:
    wing = build_wing(params)

    return BuildResult(
        parts={
            "wing": PartSpec(
                part=wing,
                material=params.get("wing_material", "balsa"),
                mode="solid",
                note="Крыло — плоская пластина-плейсхолдер вместо профиля (см. docstring модуля)",
            )
        }
    )
