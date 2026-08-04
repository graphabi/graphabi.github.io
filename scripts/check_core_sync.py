"""Verify public proof and generated brand assets against the core repository."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
ASSETS = ("favicon.svg", "logo-mark.svg", "open-graph.png")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "core",
        nargs="?",
        type=Path,
        default=ROOT.parent / "graphabi",
        help="path to a GraphABI core checkout",
    )
    core = parser.parse_args().core.resolve()
    errors: list[str] = []

    site_proof = json.loads((ROOT / "proof.json").read_text(encoding="utf-8"))
    core_proof_path = core / "docs/public-proof.json"
    if not core_proof_path.is_file():
        errors.append(f"missing core proof file: {core_proof_path}")
    else:
        core_proof = json.loads(core_proof_path.read_text(encoding="utf-8"))
        if site_proof != core_proof:
            errors.append("proof.json does not match core docs/public-proof.json")

    for name in ASSETS:
        site_asset = ROOT / "assets" / name
        core_asset = core / "docs/assets/brand" / name
        if not core_asset.is_file():
            errors.append(f"missing core brand asset: {core_asset}")
        elif site_asset.read_bytes() != core_asset.read_bytes():
            errors.append(f"assets/{name} does not match the generated core asset")

    if errors:
        print("Core synchronization failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Public proof and generated brand assets match the core repository.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
