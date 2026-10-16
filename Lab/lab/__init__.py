"""Lab — MVP evaluation of a CAD/calc/BOM pipeline for hardware projects.

`lab.core` knows nothing about boats, wings, or any other vehicle — it only knows
`Domain`, `PartSpec`, materials, and generic geometry/BOM/print-cost math. Everything
specific to a vehicle class lives under `lab.domains.<name>` and registers itself
with `lab.core.registry`. See the top-level README for how to add a new domain.
"""
