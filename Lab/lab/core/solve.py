"""Tiny generic numeric helpers a domain calculator composes with geometry queries —
e.g. the boat domain's waterline search ("at what height does the submerged volume
equal the displacement I need?") is just `bisect` applied to
`part.split(Plane.XY.offset(z), keep=Keep.BOTTOM).volume`. Kept here, not in
`domains/boat/`, because the next domain that needs "find the level where some
monotonic geometric quantity crosses a target" (a fuel tank's fill height, a float's
draft, ...) should reuse this, not re-derive it.
"""

from __future__ import annotations

from typing import Callable


def bisect(fn: Callable[[float], float], lo: float, hi: float, target: float, tol: float = 1e-6, max_iter: int = 60) -> float:
    """Finds x in [lo, hi] where fn(x) == target, assuming fn is monotonically
    non-decreasing over that range (true for "submerged volume vs. waterline height").
    Raises if the target isn't bracketed — a caller asking for a displacement heavier
    than the hull can ever hold should see that as an error, not a silently wrong
    answer clamped to `hi`.
    """

    f_lo, f_hi = fn(lo), fn(hi)
    if not (f_lo <= target <= f_hi):
        raise ValueError(f"target {target} вне диапазона [{f_lo}, {f_hi}] для x in [{lo}, {hi}]")

    for _ in range(max_iter):
        mid = (lo + hi) / 2
        f_mid = fn(mid)
        if abs(f_mid - target) <= tol:
            return mid
        if f_mid < target:
            lo = mid
        else:
            hi = mid

    return (lo + hi) / 2
