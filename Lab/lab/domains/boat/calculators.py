"""The boat domain's physics: hydrostatics (does it float, and how deep) and a speed
estimate from power/weight. Both are deliberately simple, named, open methods — not
CFD — because the goal of this MVP is a fast predict/iterate loop, not maximum
accuracy; see IMPLEMENTATION_PLAN.md for what phase 2 should replace each with.
"""

from __future__ import annotations

import math

from build123d import Keep, Plane

from lab.core.domain import CalcContext
from lab.core.solve import bisect

MM3_PER_M3 = 1_000_000_000.0
KG_TO_LB = 2.20462
WATT_TO_HP = 1 / 745.7
MPH_TO_KMH = 1.60934


def hydrostatics(context: CalcContext) -> dict:
    """At what waterline height does the submerged volume of the hull displace
    exactly the vehicle's all-up weight? A straight application of Archimedes' —
    the only naval-architecture-specific judgment call is treating the hull's outer
    *solid* envelope (not the printed shell) as what displaces water, which is
    correct: a hull's buoyancy comes from the volume its outer surface encloses,
    regardless of how thick its wall actually is.
    """

    hull = context.build.parts["hull"].part
    water_density = context.params.get("water_density_kg_m3", 1000.0)
    target_volume_mm3 = context.total_mass_kg / water_density * MM3_PER_M3

    bbox = hull.bounding_box()
    z_min, z_max = bbox.min.Z, bbox.max.Z
    hull_volume_mm3 = hull.volume

    if target_volume_mm3 > hull_volume_mm3:
        return {
            "swamped": True,
            "note": (
                f"Корпус тонет: для плавучести нужно вытеснить {target_volume_mm3 / MM3_PER_M3 * 1000:.2f} л, "
                f"а весь корпус вмещает только {hull_volume_mm3 / MM3_PER_M3 * 1000:.2f} л. "
                "Увеличьте габариты корпуса или снизьте массу."
            ),
        }

    def submerged_volume(z: float) -> float:
        if z <= z_min:
            return 0.0
        if z >= z_max:
            return hull_volume_mm3

        return hull.split(Plane.XY.offset(z), keep=Keep.BOTTOM).volume

    waterline_mm = bisect(submerged_volume, z_min, z_max, target_volume_mm3)
    height_mm = context.params["height_mm"]

    return {
        "swamped": False,
        "all_up_mass_kg": round(context.total_mass_kg, 3),
        "waterline_mm": round(waterline_mm, 1),
        "freeboard_mm": round(height_mm - waterline_mm, 1),
        "percent_depth_submerged": round(waterline_mm / height_mm * 100, 1),
        "length_beam_ratio": round(context.params["length_mm"] / context.params["beam_mm"], 2),
    }


def planing_speed(context: CalcContext) -> dict:
    """A power/weight speed estimate using Crouch's planing-speed formula
    (`V_mph = C * sqrt(HP / weight_lb)`) — a long-standing, simple empirical rule of
    thumb for planing powerboats, not the (iterative, trim-angle-solving) Savitsky
    method. Good enough to compare design iterations against each other and against
    a target; not a substitute for a tow-tank or a real prototype run.
    """

    motor_power_w = context.params.get("motor_power_w")
    if not motor_power_w:
        return {"error": "params.motor_power_w не задан — оценка скорости невозможна"}

    efficiency = context.params.get("drivetrain_efficiency", 0.55)
    planing_constant_c = context.params.get("planing_constant_c", 150.0)

    propulsive_power_w = motor_power_w * efficiency
    horsepower = propulsive_power_w * WATT_TO_HP
    weight_lb = context.total_mass_kg * KG_TO_LB

    speed_mph = planing_constant_c * math.sqrt(horsepower / weight_lb)
    speed_kmh = speed_mph * MPH_TO_KMH

    return {
        "method": "Crouch's planing speed formula (эмпирика, порядок величины)",
        "input_power_w": motor_power_w,
        "drivetrain_efficiency": efficiency,
        "propulsive_power_w": round(propulsive_power_w, 1),
        "all_up_mass_kg": round(context.total_mass_kg, 3),
        "planing_constant_c": planing_constant_c,
        "estimated_speed_kmh": round(speed_kmh, 1),
    }
