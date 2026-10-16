from lab.core.domain import Domain
from lab.core.registry import register

from . import calculators, geometry


class AircraftDomain(Domain):
    name = "aircraft"

    def build(self, params: dict):
        return geometry.build(params)

    @property
    def calculators(self):
        return {
            "wing_loading": calculators.wing_loading,
        }


register(AircraftDomain())
