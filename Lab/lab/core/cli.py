"""`python -m lab run <project_dir>` — the whole MVP pipeline, manually triggered by a
developer (no worker/bridge involved yet, by design: see IMPLEMENTATION_PLAN.md phase
5.1). This is the only module that calls a domain through `registry.get()` — every
other core module only ever sees a `PartSpec`/`CalcContext`, never a domain name.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import geometry, printing, project as project_module, registry, report
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

    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lab")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run", help="Собрать геометрию, посчитать массу/стоимость и запустить расчёты проекта")
    run_parser.add_argument("project_dir", type=Path, help="Папка проекта с project.yaml")

    args = parser.parse_args(argv)

    if args.command == "run":
        results = run(args.project_dir)
        print(report.format_console(results))
        print(f"\nЭкспорт и results.json: {args.project_dir / 'export'}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
