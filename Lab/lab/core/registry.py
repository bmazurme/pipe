"""Domain name -> Domain instance. Core never imports a domain module by name; a
domain module registers itself on import (see `lab/domains/__init__.py`, which is the
only place that lists domain module names), and the CLI looks the project's `domain:`
string up here.
"""

from __future__ import annotations

from .domain import Domain

_DOMAINS: dict[str, Domain] = {}


def register(domain: Domain) -> Domain:
    if domain.name in _DOMAINS:
        raise ValueError(f"Домен {domain.name!r} уже зарегистрирован")
    _DOMAINS[domain.name] = domain

    return domain


def get(name: str) -> Domain:
    try:
        return _DOMAINS[name]
    except KeyError as exc:
        raise KeyError(f"Домен {name!r} не зарегистрирован. Известные: {sorted(_DOMAINS)} — "
                        f"проверьте lab/domains/__init__.py") from exc


def available() -> list[str]:
    return sorted(_DOMAINS)
