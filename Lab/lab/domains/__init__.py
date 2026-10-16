"""The only file that names a built-in domain module by name. Adding a new vehicle
class means adding one line here (plus the module itself under `lab/domains/<name>/`)
— nothing under `lab/core/` or any other domain changes.
"""

from . import boat, aircraft  # noqa: F401 — each import registers that domain as a side effect
