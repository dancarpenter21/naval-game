#!/usr/bin/env python3
"""
Regenerate GPS entity templates and scenario-example-gps.yaml from scratch/gps-raw.json.

TLEs are merged from:
  - CelesTrak GPS operational set (gp.php?GROUP=gps-ops&FORMAT=tle), and
  - Per-satellite gp.php?CATNR=<id> for NAVSTAR entries not in that group.

Re-run when you need fresher elements or after updating gps-raw.json.

Usage (from repo root):
  python3 utilities/generate-scenario-example-gps.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RAW_PATH = REPO / "scratch" / "gps-raw.json"
ENTITIES_DIR = REPO / "server" / "config" / "entities"
SCENARIO_PATH = REPO / "server" / "config" / "scenarios" / "scenario-example-gps.yaml"

CELESTRAK_GPS_OPS = "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle"
CELESTRAK_CATNR = "https://celestrak.org/NORAD/elements/gp.php?CATNR={}"

UA = "naval-game-gps-generator/1.0"

# scenario-example-gps.yaml: screen-space dot per GPS (pixels; friendly blue).
GPS_SCENARIO_MAP_SPHERE_RADIUS_PX = 8.0
GPS_SCENARIO_MAP_SPHERE_COLOR = "#2563eb"

ENTITY_SYMBOL_BLOCK = """    - kind: symbol
      data:
        sidc_template:
          version: "10"
          context: reality
          standard_identity: friend
          symbol_set: space
          status: present
          hqtfd: not_applicable
          amplifier: unspecified
          entity: code_110700
          modifier_one: code_02
          modifier_two: code_00"""


def yaml_double_quoted(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _http_get(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError:
        return None


def parse_tle_file(text: str) -> dict[str, tuple[str, str, str]]:
    """Map NORAD catalog string -> (name_line, line1, line2)."""
    out: dict[str, tuple[str, str, str]] = {}
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    i = 0
    while i + 2 < len(lines):
        name, line1, line2 = lines[i], lines[i + 1], lines[i + 2]
        m = re.match(r"1\s+(\d+)", line1)
        if m and line2.startswith("2 "):
            out[m.group(1)] = (name, line1, line2)
        i += 3
    return out


def fetch_tle_bulk() -> dict[str, tuple[str, str, str]]:
    text = _http_get(CELESTRAK_GPS_OPS)
    if not text or text.startswith("Invalid query"):
        return {}
    return parse_tle_file(text)


def fetch_tle_single(catnr: str) -> tuple[str, str, str] | None:
    text = _http_get(CELESTRAK_CATNR.format(catnr))
    if not text:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 3:
        return None
    if lines[0].startswith("Invalid query"):
        return None
    name, line1, line2 = lines[0], lines[1], lines[2]
    if not line1.startswith("1 ") or not line2.startswith("2 "):
        return None
    m = re.match(r"1\s+(\d+)", line1)
    if not m or m.group(1) != catnr:
        return None
    return name, line1, line2


def main() -> int:
    if not RAW_PATH.is_file():
        print(f"missing {RAW_PATH}", file=sys.stderr)
        return 1

    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        print("gps-raw.json must be a JSON array", file=sys.stderr)
        return 1

    ENTITIES_DIR.mkdir(parents=True, exist_ok=True)
    SCENARIO_PATH.parent.mkdir(parents=True, exist_ok=True)

    bulk = fetch_tle_bulk()
    if not bulk:
        print("warn: empty gps-ops TLE fetch; will try per-satellite only", file=sys.stderr)

    template_ids: list[str] = []
    missing: list[str] = []
    delay_s = 0.12

    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            continue
        cat = str(row.get("NORAD_CAT_ID") or row.get("OBJECT_NUMBER") or "").strip()
        if not cat:
            continue
        satname = str(row.get("SATNAME") or row.get("OBJECT_NAME") or f"GPS {cat}").strip()

        triple = bulk.get(cat)
        if triple is None:
            if i > 0:
                time.sleep(delay_s)
            got = fetch_tle_single(cat)
            if got is None:
                missing.append(cat)
                print(f"warn: no TLE for NORAD {cat} ({satname})", file=sys.stderr)
                continue
            _n, line1, line2 = got
        else:
            _n, line1, line2 = triple

        eid = f"gps-{cat}"
        template_ids.append(eid)

        body = f"""- id: {eid}
  name: {satname}
  allegiance: friendly
  components:
    - kind: space_orbit
      data:
        line1: {yaml_double_quoted(line1)}
        line2: {yaml_double_quoted(line2)}
        fov_half_angle_deg: 5.0
{ENTITY_SYMBOL_BLOCK}
"""
        (ENTITIES_DIR / f"{eid}.yaml").write_text(body, encoding="utf-8")

    template_ids.sort(key=lambda s: int(s.split("-", 1)[1]))

    blue_blocks = "\n".join(
        f"""  - id: {tid}
    symbol:
      map_cesium_shape:
        kind: sphere
        radius_px: {GPS_SCENARIO_MAP_SPHERE_RADIUS_PX}
        color: '{GPS_SCENARIO_MAP_SPHERE_COLOR}'"""
        for tid in template_ids
    )
    scenario = f"""name: "Example: GPS constellation (satcom test)"
description: |
  Spawns NAVSTAR payloads listed in scratch/gps-raw.json as friendly space entities.
  TLE line1/line2 come from CelesTrak (gps-ops group plus per-NORAD fills for older blocks).
  Map: each unit uses a blue screen-space dot (`map_cesium_shape.kind: sphere`, `radius_px`).
  Re-run utilities/generate-scenario-example-gps.py to refresh orbits (keeps this map styling).
win_conditions: |
  None — use for satcom / visibility experiments. End the session from the host when finished.
red_entities: []
blue_entities:
{blue_blocks}
spawns: []
"""
    SCENARIO_PATH.write_text(scenario, encoding="utf-8")

    print(f"wrote {len(template_ids)} entity files under {ENTITIES_DIR}")
    print(f"wrote {SCENARIO_PATH}")
    if missing:
        print(f"skipped {len(missing)} entries without TLE: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
