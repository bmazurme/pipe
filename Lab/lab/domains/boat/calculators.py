"""The boat domain's physics.

Both calculators below are ports of working, on-water-calibrated scripts from a real RC-boat
project (`boat-rc` — not part of this repo) rather than written from scratch: `hydrostatics()`
from its `hydrostatics_v13.py`, `planing_speed()` from `planing_v13.py` + `speed_powertrain.py`.
The physics and the bisection structure are kept faithful to the source; what changed is making
every constant a `params` value instead of a module-level number, and sourcing geometry from a
`CalcContext`'s live solid (via `core.geometry.station_area_profiles`) instead of a half-width
table ray-cast once in Fusion. See each function's docstring for the specific source file.
"""

from __future__ import annotations

import math

from lab.core.domain import CalcContext
from lab.core.geometry import station_area_profiles
from lab.core.solve import bisect

MM3_PER_M3 = 1_000_000_000.0
G = 9.81
RHO_WATER_DEFAULT = 1000.0  # kg/m3 — fresh water; boat-rc's own scripts use 998 (pool/lake temp)

# How many stations/height-samples the precomputed area table gets — a trade-off between the
# solve's accuracy and the one-time cost of building it (see StationAreaProfile's docstring:
# ~1ms per sample measured on real hull geometry, so 20×25 is comfortably sub-second).
STATIONS = 20
Z_SAMPLES = 25


def _hydro(profiles, z_transom_mm: float, trim_deg: float, length_mm: float) -> tuple[float, float]:
    """Displaced volume (mm³) and its X centroid — LCB, mm from the bow — at a given transom
    draft and trim. Ported from `hydrostatics_v13.py`'s `hydro()`: same waterline-height
    function `z(x) = z_transom - (length - x) * tan(trim)` (positive trim = stern down), same
    trapezoidal station weighting (endpoints at half weight). `area(x, zw)` there (a Riemann
    sum over the half-width table) is `profile.area_at(zw)` here (linear interpolation over a
    precomputed exact-split table) — the two play the same role.
    """

    trim_tan = math.tan(math.radians(trim_deg))
    dx = profiles[1].x_mm - profiles[0].x_mm if len(profiles) > 1 else length_mm
    volume = 0.0
    moment = 0.0

    for i, profile in enumerate(profiles):
        local_z = z_transom_mm - (length_mm - profile.x_mm) * trim_tan
        area = profile.area_at(local_z)
        weight = 0.5 if i in (0, len(profiles) - 1) else 1.0
        volume += weight * area * dx
        moment += weight * area * dx * profile.x_mm

    return volume, (moment / volume if volume else 0.0)


def hydrostatics(context: CalcContext) -> dict:
    """Finds the draft and trim at which the hull simultaneously (a) displaces the vehicle's
    all-up weight and (b) has its centre of buoyancy under the centre of gravity — a proper
    floating-equilibrium solve, not just "how deep does it sit assuming it floats level".
    Ported from boat-rc's `hydrostatics_v13.py` (`solve()`): same nested bisection (outer over
    trim, matching LCB to `params['lcg_mm']`; inner over transom draft, matching displaced
    volume to the target), generalized from that script's fixed half-width table to a
    `station_area_profiles` table built from this project's own hull solid.

    Requires `params['lcg_mm']` — this calculator does not compute a centre of gravity itself
    (neither does the script it is ported from: boat-rc's own `cg_v13.py` is a separate,
    standalone calculation over the BOM, not wired into `hydrostatics_v13.py` either).
    """

    if "lcg_mm" not in context.params:
        return {"error": "params.lcg_mm не задан — без центра тяжести решить дифферент невозможно (см. docstring)"}

    hull = context.build.parts["hull"].part
    length_mm = context.params["length_mm"]
    height_mm = context.params["height_mm"]
    lcg_mm = context.params["lcg_mm"]
    water_density = context.params.get("water_density_kg_m3", RHO_WATER_DEFAULT)

    z_max_mm = height_mm * 1.1  # a little headroom above the hull's own top, for a heavily-trimmed probe
    stations_x = [length_mm * i / (STATIONS - 1) for i in range(STATIONS)]
    profiles = station_area_profiles(hull, stations_x, z_max_mm, Z_SAMPLES)

    target_volume_mm3 = context.total_mass_kg / water_density * MM3_PER_M3
    max_volume_mm3, _ = _hydro(profiles, z_max_mm, 0.0, length_mm)

    if target_volume_mm3 > max_volume_mm3:
        return {
            "swamped": True,
            "note": (
                f"Корпус тонет: для плавучести нужно вытеснить {target_volume_mm3 / MM3_PER_M3 * 1000:.0f} мл, "
                f"а корпус до условной верхней границы ({z_max_mm:.0f} мм) вмещает только "
                f"{max_volume_mm3 / MM3_PER_M3 * 1000:.0f} мл."
            ),
        }

    def draft_for_trim(trim_deg: float) -> float:
        return bisect(lambda z: _hydro(profiles, z, trim_deg, length_mm)[0], 0.0, z_max_mm, target_volume_mm3)

    trim_lo, trim_hi = -context.params.get("trim_search_deg", 10.0), context.params.get("trim_search_deg", 10.0)
    z_transom = draft_for_trim(0.0)

    for _ in range(30):
        trim = (trim_lo + trim_hi) / 2
        z_transom = draft_for_trim(trim)
        _, lcb = _hydro(profiles, z_transom, trim, length_mm)
        trim_lo, trim_hi = (trim, trim_hi) if lcb < lcg_mm else (trim_lo, trim)

    trim = (trim_lo + trim_hi) / 2
    z_transom = draft_for_trim(trim)
    _, lcb = _hydro(profiles, z_transom, trim, length_mm)
    z_bow = z_transom - length_mm * math.tan(math.radians(trim))

    return {
        "swamped": False,
        "all_up_mass_kg": round(context.total_mass_kg, 3),
        "lcg_mm": lcg_mm,
        "lcb_mm": round(lcb, 1),
        "trim_deg": round(trim, 2),
        "waterline_transom_mm": round(z_transom, 1),
        "waterline_bow_mm": round(z_bow, 1),
        "freeboard_transom_mm": round(height_mm - z_transom, 1),
        "length_beam_ratio": round(length_mm / context.params["beam_mm"], 2),
    }


# --- planing (ported from planing_v13.py + speed_powertrain.py) -----------------------------


def _wetted_length_ratio(load_n: float, velocity_ms: float, trim_deg: float, halfbeam_m: float, deadrise_deg: float) -> tuple[float, float]:
    """Savitsky (1964) lift coefficient, solved for the wetted-length-to-beam ratio λ that
    carries `load_n` at this speed/trim — ported from `planing_v13.py`'s `CLb_from`/`lam_for`
    verbatim (same bisection, same equation, same deadrise correction).
    """

    cv = velocity_ms / math.sqrt(G * halfbeam_m)
    needed_cl = load_n / (0.5 * 1000.0 * velocity_ms * velocity_ms * halfbeam_m * halfbeam_m)

    def cl_beta(lam: float) -> float:
        # Increasing in lam (a longer wetted length carries more lift) — core.solve.bisect
        # assumes exactly that monotonicity, same as planing_v13.py's own hand-rolled loop did.
        cl0 = trim_deg**1.1 * (0.012 * lam**0.5 + 0.0055 * lam**2.5 / cv**2)
        return cl0 - 0.0065 * deadrise_deg * cl0**0.6

    lam = bisect(cl_beta, 0.01, 20.0, needed_cl)
    return lam, cv


def _planing_balance(context: CalcContext, velocity_ms: float, trim_deg: float) -> dict:
    """Load split between a bow planing surface (forward of the redan) and a flat stern
    surface, by moment balance about the centre of gravity — ported from `planing_v13.py`'s
    `solve()`. Without `params['redan_x_mm']` there is no step: the whole hull is treated as
    one planing surface and the stern carries nothing (`fa = 0`), which is the ordinary,
    non-stepped case Savitsky's method was written for in the first place.
    """

    length_mm = context.params["length_mm"]
    halfbeam_m = context.params.get("planing_halfbeam_mm", context.params["beam_mm"] / 2) / 1000.0
    deadrise_deg = context.params.get("planing_deadrise_deg", context.params.get("deadrise_deg", 12.0))
    weight_n = context.total_mass_kg * G
    xcg = context.params["lcg_mm"]
    x_step = context.params.get("redan_x_mm", length_mm)
    x_cpa = context.params.get("stern_cp_x_mm", length_mm - 25.0)

    has_redan = x_step < length_mm
    fa = 0.0
    lam = cv = xcpf = 0.0

    # No redan: one surface carries the whole weight — solve lam/cv once, fa stays 0, skip the
    # moment-balance loop below entirely (it has nothing to balance against).
    iterations = 60 if has_redan else 1

    for _ in range(iterations):
        lam, cv = _wetted_length_ratio((1 - fa) * weight_n, velocity_ms, trim_deg, halfbeam_m, deadrise_deg)
        wetted_length_m = lam * halfbeam_m * (0.75 - 1 / (5.21 * cv**2 / lam**2 + 2.39))
        xcpf = x_step - wetted_length_m * 1000.0

        if not has_redan:
            break

        fa_new = max(0.0, (xcg - xcpf) / (x_cpa - xcpf)) if x_cpa != xcpf else fa
        fa = 0.5 * fa + 0.5 * fa_new

    return {"lam": lam, "cv": cv, "xcpf": xcpf, "fa": fa, "halfbeam_m": halfbeam_m, "deadrise_deg": deadrise_deg}


def _hull_drag_n(context: CalcContext, velocity_ms: float, trim_deg: float, balance: dict) -> float:
    """Total hull resistance at speed — ported from `speed_powertrain.py`'s `drag()`: induced
    drag from trim, skin friction over the wetted bow+stern patches (ITTC-57-style friction
    line), appendage drag (rudder, deadwood, hub) and air drag, all as flat per-project
    coefficients rather than this one hull's specific numbers.
    """

    weight_n = context.total_mass_kg * G
    halfbeam_m, deadrise_deg = balance["halfbeam_m"], balance["deadrise_deg"]
    wetted_bow_m2 = balance["lam"] * halfbeam_m * halfbeam_m / math.cos(math.radians(deadrise_deg))
    wetted_stern_m2 = context.params.get("planing_stern_wetted_factor", 0.35) * wetted_bow_m2 + context.params.get(
        "planing_stern_wetted_floor_m2", 0.0012
    )

    reynolds = max(velocity_ms * balance["lam"] * halfbeam_m / 1.0e-6, 1.0e5)
    friction_coeff = 0.075 / (math.log10(reynolds) - 2) ** 2 + 0.0004
    drag_friction_n = 0.5 * 1000.0 * velocity_ms**2 * (wetted_bow_m2 + wetted_stern_m2) * friction_coeff
    drag_induced_n = weight_n * math.tan(math.radians(trim_deg))
    drag_appendage_n = 0.5 * 1000.0 * velocity_ms**2 * context.params.get("planing_appendage_cda_m2", 2.0e-5)
    drag_air_n = (
        0.5
        * 1.2
        * velocity_ms**2
        * context.params.get("planing_air_drag_coefficient", 0.6)
        * context.params.get("planing_frontal_area_m2", 0.0083)
    )

    return drag_induced_n + drag_friction_n / math.cos(math.radians(trim_deg)) + drag_appendage_n + drag_air_n


def _motor_operating_point(context: CalcContext, current_a: float) -> tuple[float, float]:
    """Shaft RPM and shaft power at a given current — ported from `speed_powertrain.py`'s
    `motor()`: a simple Kv/internal-resistance model for the motor, ESC and battery, no load
    curve beyond that.
    """

    battery_v = context.params["battery_voltage_v"]
    battery_r = context.params.get("battery_resistance_ohm", 0.03)
    motor_r = context.params["motor_resistance_ohm"]
    esc_r = context.params.get("esc_resistance_ohm", 0.0)
    no_load_current_a = context.params.get("motor_no_load_current_a", 0.0)
    kv = context.params["motor_kv"]

    bus_v = battery_v - current_a * (battery_r + esc_r)
    back_emf_v = bus_v - current_a * motor_r
    rpm = kv * back_emf_v
    shaft_power_w = back_emf_v * (current_a - no_load_current_a)

    return rpm, shaft_power_w


def planing_speed(context: CalcContext) -> dict:
    """Top speed from the powertrain's available power and the hull's own planing drag, by
    bisecting on velocity until drag×velocity equals shaft power delivered through the
    driveline — ported from `speed_powertrain.py`'s `vmax()`. The load-split between bow and
    stern (`_planing_balance`) is solved at each trial speed from the real moment balance
    instead of that script's flat assumed constant (`fa=0.15`) — the one place this port
    tightens the original rather than just relocating it, using machinery (`_planing_balance`)
    this file already has for `hydrostatics`'s sibling concern.

    Requires `params['lcg_mm']` (reused from the same source as `hydrostatics`) and a motor
    spec (`motor_kv`, `motor_resistance_ohm`, `battery_voltage_v`, `motor_max_current_a`).
    """

    required = ("lcg_mm", "motor_kv", "motor_resistance_ohm", "battery_voltage_v", "motor_max_current_a")
    missing = [key for key in required if key not in context.params]
    if missing:
        return {"error": f"не заданы params: {', '.join(missing)} — см. docstring planing_speed"}

    trim_deg = context.params.get("planing_trim_deg", 3.0)
    shaft_efficiency = context.params.get("planing_shaft_efficiency", 0.90)
    propeller_efficiency = context.params.get("planing_propeller_efficiency", 0.55)
    slip = context.params.get("planing_propeller_slip", 0.20)

    _, shaft_power_w = _motor_operating_point(context, context.params["motor_max_current_a"])
    propulsive_power_w = shaft_power_w * shaft_efficiency * propeller_efficiency

    def power_needed(velocity_ms: float) -> float:
        balance = _planing_balance(context, velocity_ms, trim_deg)
        return _hull_drag_n(context, velocity_ms, trim_deg, balance) * velocity_ms

    velocity_ms = bisect(power_needed, 1.0, 40.0, propulsive_power_w)
    balance = _planing_balance(context, velocity_ms, trim_deg)
    rpm, _ = _motor_operating_point(context, context.params["motor_max_current_a"])
    pitch_mm = velocity_ms / ((rpm / 60) * (1 - slip)) * 1000 if rpm else None

    return {
        "method": "Savitsky (1964) + баланс моментов нос/редан/корма — порт из boat-rc, не CFD (см. docstring)",
        "all_up_mass_kg": round(context.total_mass_kg, 3),
        "trim_deg": trim_deg,
        "stern_load_fraction": round(balance["fa"], 2),
        "shaft_power_w": round(shaft_power_w, 0),
        "estimated_speed_kmh": round(velocity_ms * 3.6, 1),
        "propeller_pitch_mm_for_slip": round(pitch_mm, 0) if pitch_mm else None,
    }
