"""Turns a run's results dict into what a human reads on the terminal and what a
future bridge "Hardware" module would ingest as-is (see IMPLEMENTATION_PLAN.md) —
plain JSON, no domain-specific formatting here either.
"""

from __future__ import annotations

import json
from pathlib import Path


def write_json(results: dict, path: Path) -> None:
    path.write_text(json.dumps(results, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def format_console(results: dict) -> str:
    lines: list[str] = []
    lines.append(f"=== {results['project']} (домен: {results['domain']}) ===")
    lines.append("")
    lines.append("-- Детали (масса/материал) --")
    for part, info in results["parts"].items():
        lines.append(f"  {part:<16} {info['mass_kg']:.3f} кг   материал: {info['material']}   стоимость материала: {info['material_cost_rub']:.0f} ₽")
        if info.get("print_hours") is not None:
            lines.append(f"{'':18}печать: {info['print_hours']:.1f} ч   станко-время: {info['print_machine_cost_rub']:.0f} ₽")
        drawing = info.get("export", {}).get("drawing")
        if drawing:
            lines.append(f"{'':18}чертёж (3 вида, DXF): {drawing}")

    lines.append("")
    lines.append("-- Расчёты --")
    for calc_name, metrics in results["calculations"].items():
        lines.append(f"  [{calc_name}]")
        for key, value in metrics.items():
            lines.append(f"{'':4}{key}: {value}")

    lines.append("")
    lines.append("-- Стоимость/масса проекта --")
    lines.append(f"  Масса изделия (расчётные части): {results['build_mass_kg']:.3f} кг")
    lines.append(f"  Покупные компоненты: {results['bom']['total_cost_rub']:.0f} ₽, {results['bom']['total_mass_kg']:.3f} кг")
    lines.append(f"  ИТОГО масса: {results['total_mass_kg']:.3f} кг")
    lines.append(f"  ИТОГО стоимость: {results['total_cost_rub']:.0f} ₽")

    if results.get("targets"):
        lines.append("")
        lines.append("-- Цели проекта --")
        for key, value in results["targets"].items():
            lines.append(f"  {key}: {value}")

    return "\n".join(lines)
