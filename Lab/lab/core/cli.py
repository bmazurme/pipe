"""`python -m lab run <project_dir>` — the whole MVP pipeline, manually triggered by a
developer (no worker/bridge involved yet, by design: see IMPLEMENTATION_PLAN.md phase
5.1). This is the only module that calls a domain through `registry.get()` — every
other core module only ever sees a `PartSpec`/`CalcContext`, never a domain name.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import geometry, printing, project as project_module, registry, report, stats
from .bom import BomRollup
from .domain import CalcContext


def run(project_dir: Path) -> dict:
    proj = project_module.load(project_dir)
    domain = registry.get(proj.domain)

    build = domain.build(proj.params)

    out_dir = project_dir / "export"
    mass_kg: dict[str, float] = {}
    cost_rub: dict[str, float] = {}
    parts_report: dict[str, dict] = {}

    for part_name, spec in build.parts.items():
        mass = geometry.mass_kg(spec)
        material_cost = geometry.material_cost_rub(spec, mass)
        print_estimate = printing.estimate(spec)
        exported = geometry.export_part(spec, out_dir, part_name)
        exported["drawing"] = geometry.export_drawing(spec, out_dir, part_name)

        mass_kg[part_name] = mass
        cost_rub[part_name] = material_cost + (print_estimate.machine_cost_rub if print_estimate else 0.0)
        parts_report[part_name] = {
            "material": spec.material,
            "mode": spec.mode,
            "mass_kg": mass,
            "material_cost_rub": material_cost,
            "print_hours": print_estimate.hours if print_estimate else None,
            "print_machine_cost_rub": print_estimate.machine_cost_rub if print_estimate else None,
            "export": exported,
        }

    build_mass_kg = sum(mass_kg.values())
    build_cost_rub = sum(cost_rub.values())

    bom = BomRollup(lines=list(proj.purchased_bom))

    context = CalcContext(
        params=proj.params,
        build=build,
        mass_kg=mass_kg,
        cost_rub=cost_rub,
        total_mass_kg=build_mass_kg + bom.total_mass_kg,
        total_cost_rub=build_cost_rub + bom.total_cost_rub,
    )

    calculations = {}
    for calc_name, calc_fn in domain.calculators.items():
        try:
            calculations[calc_name] = calc_fn(context)
        except Exception as exc:  # noqa: BLE001 — one failing calculator must not blank the whole run
            calculations[calc_name] = {"error": str(exc)}

    results = {
        "project": proj.name,
        "domain": proj.domain,
        "params": proj.params,
        "targets": proj.targets,
        "parts": parts_report,
        "build_mass_kg": build_mass_kg,
        "build_cost_rub": build_cost_rub,
        "bom": bom.as_dict(),
        "total_mass_kg": context.total_mass_kg,
        "total_cost_rub": context.total_cost_rub,
        "calculations": calculations,
    }

    report.write_json(results, out_dir / "results.json")
    stats.record_predicted(project_dir, results)

    return results


def measure(project_dir: Path, assignments: list[str], note: str) -> stats.StatsRecord:
    """Parses `key=value` pairs from the command line into a metrics dict and records them as
    a "measured" observation — see core/stats.py.
    """

    metrics: dict[str, float] = {}
    for assignment in assignments:
        key, sep, raw_value = assignment.partition("=")
        if not sep:
            raise ValueError(f"Ожидался key=value, получено {assignment!r}")
        try:
            metrics[key] = float(raw_value)
        except ValueError as exc:
            raise ValueError(f"Значение {raw_value!r} для {key!r} не число") from exc

    return stats.record_measured(project_dir, metrics, note)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lab")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run", help="Собрать геометрию, посчитать массу/стоимость и запустить расчёты проекта")
    run_parser.add_argument("project_dir", type=Path, help="Папка проекта с project.yaml")

    measure_parser = sub.add_parser("measure", help="Записать реально измеренное значение (вес, скорость, ...) в историю проекта")
    measure_parser.add_argument("project_dir", type=Path, help="Папка проекта")
    measure_parser.add_argument("assignments", nargs="+", help="key=value, например total_mass_kg=0.82")
    measure_parser.add_argument("--note", default="", help="Короткая заметка (например, «взвешено после печати»)")

    stats_parser = sub.add_parser("stats", help="Показать историю расчётов/замеров проекта: расчёт vs факт по каждой метрике")
    stats_parser.add_argument("project_dir", type=Path, help="Папка проекта")

    args = parser.parse_args(argv)

    if args.command == "run":
        results = run(args.project_dir)
        print(report.format_console(results))
        print(f"\nЭкспорт и results.json: {args.project_dir / 'export'}")
        print(f"История запуска записана: {args.project_dir / stats.HISTORY_FILE}")
    elif args.command == "measure":
        try:
            record = measure(args.project_dir, args.assignments, args.note)
        except ValueError as exc:
            print(f"Ошибка: {exc}", file=sys.stderr)
            return 1
        print(f"Записано ({record.timestamp}): {record.metrics}" + (f" — {record.note}" if record.note else ""))
    elif args.command == "stats":
        print(report.format_stats(args.project_dir, stats.summarize(args.project_dir)))

    return 0


if __name__ == "__main__":
    sys.exit(main())
