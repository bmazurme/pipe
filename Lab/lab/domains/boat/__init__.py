from lab.core.domain import Domain
from lab.core.registry import register

from . import calculators, geometry


class BoatDomain(Domain):
    name = "boat"

    def build(self, params: dict):
        return geometry.build(params)

    @property
    def calculators(self):
        return {
            "hydrostatics": calculators.hydrostatics,
            "planing_speed": calculators.planing_speed,
        }


register(BoatDomain())
