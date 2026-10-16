"""Print time/cost for an FDM part — a deliberately rough placeholder, not a slicer.

A real slicer (PrusaSlicer/Cura CLI) run on the actual STL would account for walls,
infill, supports and per-model geometry and should replace this in phase 2 (see
IMPLEMENTATION_PLAN.md). This MVP only needs a number in the right order of magnitude
to validate that "cost per iteration" is a workable idea at all — it estimates purely
from the volume of material the part already resolved to (so it already reflects
shell-vs-solid and wall thickness), at a constant volumetric throughput.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import materials
from .domain import PartSpec
from .geometry import volume_mm3

# cm3/hour of deposited material — a rough, single number for a 0.4mm nozzle at a
# moderate speed/layer-height combination. Real throughput depends on the printer,
# nozzle, layer height and the model's own geometry (walls vs. infill), which is
# exactly why this should become a real slicer call rather than a constant.
DEFAULT_THROUGHPUT_CM3_PER_HOUR = 18.0
SETUP_HOURS = 0.5
MACHINE_RATE_RUB_PER_HOUR = 40.0  # depreciation + electricity, placeholder


@dataclass
class PrintEstimate:
    hours: float
    machine_cost_rub: float


def estimate(spec: PartSpec) -> PrintEstimate | None:
    """None for a part whose material isn't printed (`process != "fdm_print"`) — the
    caller should simply omit a print estimate for it rather than getting a fake zero.
    """

    material = materials.get(spec.material)
    if material.process != "fdm_print":
        return None

    volume_cm3 = volume_mm3(spec) / 1000.0
    hours = SETUP_HOURS + volume_cm3 / DEFAULT_THROUGHPUT_CM3_PER_HOUR

    return PrintEstimate(hours=hours, machine_cost_rub=hours * MACHINE_RATE_RUB_PER_HOUR)
