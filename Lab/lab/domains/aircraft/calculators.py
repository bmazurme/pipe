"""The aircraft domain's one calculator — wing loading, the standard first-order
sanity check for whether an RC aircraft's wing is plausibly sized for its weight.
Planform area is computed analytically from the trapezoid params (the usual
convention for wing loading — projected area, not the wetted/surface area a solid
would give), independent of the geometry module's own flat-plate simplification.
"""

from __future__ import annotations

from lab.core.domain import CalcContext

# Rough reference bands for a traditionally-built (not 3D-printed) small RC
# aircraft — included as context for the number, not a hard pass/fail.
WING_LOADING_BANDS_G_DM2 = {
    "тренер/парковый": (15, 35),
    "спортивный": (35, 60),
    "скоростной/пилотажный": (60, 90),
}


def _classify(wing_loading_g_dm2: float) -> str:
    for label, (lo, hi) in WING_LOADING_BANDS_G_DM2.items():
        if lo <= wing_loading_g_dm2 <= hi:
            return label

    return "скоростной/пилотажный (выше типичного)" if wing_loading_g_dm2 > 90 else "очень легкий (ниже типичного)"


def wing_loading(context: CalcContext) -> dict:
    span_mm = context.params["wingspan_mm"]
    root_chord_mm = context.params["root_chord_mm"]
    tip_chord_mm = context.params["tip_chord_mm"]

    planform_area_mm2 = span_mm * (root_chord_mm + tip_chord_mm) / 2
    planform_area_dm2 = planform_area_mm2 / 10_000.0
    mass_g = context.total_mass_kg * 1000.0

    loading = mass_g / planform_area_dm2

    return {
        "planform_area_dm2": round(planform_area_dm2, 2),
        "all_up_mass_g": round(mass_g, 1),
        "wing_loading_g_dm2": round(loading, 1),
        "category": _classify(loading),
    }
