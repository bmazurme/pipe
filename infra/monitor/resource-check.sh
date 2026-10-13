#!/usr/bin/env bash
#
# Is this board healthy? Run by pipe-resource-check.timer every 5 minutes on every board; sends Telegram only when something
# stays wrong (2 runs in a row = ~10 min), repeats every 6 h while it lasts, and says when it is fixed.
# Thresholds come from the capacity analysis (the boards idle at 1–3 % CPU, 7–9 % RAM, 9–28 % disk, 47–52 °C, so these mean "something changed"):
#   load     the 15-minute load average per core above LOAD_PER_CORE (0.6)
#   memory   less than MIN_MEM_AVAILABLE_PERCENT (25) of RAM available
#   disk     the root filesystem fuller than MAX_DISK_PERCENT (80)
#   heat     the SoC at or above MAX_TEMP_C (75), or the firmware reports throttling / under-voltage right now
#   swarm    this node is not an active member of the Swarm (the heal timer restarts Docker; this tells you it happened)
# Test hooks: LOADAVG_FILE, MEMINFO_FILE, THERMAL_FILE, and fake df/nproc/vcgencmd/docker in PATH.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=monitor-lib.sh
. "$HERE/monitor-lib.sh"

LOAD_PER_CORE="${LOAD_PER_CORE:-0.6}"
MIN_MEM_AVAILABLE_PERCENT="${MIN_MEM_AVAILABLE_PERCENT:-25}"
MAX_DISK_PERCENT="${MAX_DISK_PERCENT:-80}"
MAX_TEMP_C="${MAX_TEMP_C:-75}"
LOADAVG_FILE="${LOADAVG_FILE:-/proc/loadavg}"
MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"
THERMAL_FILE="${THERMAL_FILE:-/sys/class/thermal/thermal_zone0/temp}"
ME="$(hostname)"

# 1. load (15-minute average, per core) — a short spike is not an alert, a sustained one is
cores="$(nproc 2>/dev/null || echo 1)"
load15="$(awk '{print $3}' "$LOADAVG_FILE" 2>/dev/null || echo 0)"
bad=0; awk -v l="$load15" -v c="$cores" -v t="$LOAD_PER_CORE" 'BEGIN{exit !(l / c > t)}' && bad=1
transition "load" "$bad" "🔥 $ME: нагрузка CPU держится высокой — load15 = $load15 на $cores ядрах (порог ${LOAD_PER_CORE} на ядро). Смотрите docker stats." "✅ $ME: нагрузка CPU в норме."

# 2. memory
total="$(awk '/^MemTotal:/{print $2}' "$MEMINFO_FILE" 2>/dev/null || echo 0)"
avail="$(awk '/^MemAvailable:/{print $2}' "$MEMINFO_FILE" 2>/dev/null || echo 0)"
avail_pct=100; [ "${total:-0}" -gt 0 ] && avail_pct=$(( avail * 100 / total ))
bad=0; [ "$avail_pct" -lt "$MIN_MEM_AVAILABLE_PERCENT" ] && bad=1
transition "memory" "$bad" "🧠 $ME: свободной памяти осталось ${avail_pct}% (порог ${MIN_MEM_AVAILABLE_PERCENT}%). Поднимите лимиты или найдите, кто ест (docker stats)." "✅ $ME: памяти достаточно (${avail_pct}% свободно)."

# 3. disk
used_pct="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"; used_pct="${used_pct:-0}"
bad=0; [ "$used_pct" -ge "$MAX_DISK_PERCENT" ] && bad=1
transition "disk" "$bad" "💾 $ME: диск заполнен на ${used_pct}% (порог ${MAX_DISK_PERCENT}%). docker image prune, ротация логов, при необходимости — NVMe больше." "✅ $ME: места на диске достаточно (${used_pct}%)."

# 4. heat and firmware throttling (right now, not "since boot")
temp_milli="$(cat "$THERMAL_FILE" 2>/dev/null || echo 0)"; temp_c=$(( temp_milli / 1000 ))
throttled="$(vcgencmd get_throttled 2>/dev/null | sed -n 's/.*=0x\([0-9a-fA-F]*\).*/\1/p')"
now_bits=0; [ -n "$throttled" ] && now_bits=$(( 16#$throttled & 0xF ))
bad=0; { [ "$temp_c" -ge "$MAX_TEMP_C" ] || [ "$now_bits" -ne 0 ]; } && bad=1
transition "heat" "$bad" "🌡 $ME: ${temp_c}°C (порог ${MAX_TEMP_C}), состояние питания/частоты 0x$(printf '%x' "$now_bits"). Проверьте кулер, продув и блок питания." "✅ $ME: температура и питание в норме (${temp_c}°C)."

# 5. swarm membership
swarm="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo unknown)"
bad=0; [ "$swarm" != active ] && bad=1
transition "swarm" "$bad" "🕸 $ME: узел не в Swarm (состояние: $swarm). Таймер pipe-swarm-heal перезапустит Docker, если часы верны; иначе — docker info на плате." "✅ $ME: снова в Swarm."

echo "ok: load15=$load15/${cores}c mem_avail=${avail_pct}% disk=${used_pct}% temp=${temp_c}C throttle=0x$(printf '%x' "$now_bits") swarm=$swarm"
