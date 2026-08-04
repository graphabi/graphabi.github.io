"""Verify local links and progressive-enhancement invariants."""

from __future__ import annotations

import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).parents[1]


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.references: list[tuple[str, str]] = []
        self.field_is_hidden = False
        self.proof_values: dict[str, str] = {}
        self.active_proof: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if identifier := values.get("id"):
            self.ids.add(identifier)
        for name in ("href", "src"):
            if reference := values.get(name):
                self.references.append((name, reference))
        if tag == "canvas" and "data-field" in values:
            self.field_is_hidden = values.get("aria-hidden") == "true"
        if proof := values.get("data-proof"):
            self.active_proof = proof

    def handle_data(self, data: str) -> None:
        if self.active_proof:
            self.proof_values[self.active_proof] = (
                self.proof_values.get(self.active_proof, "") + data
            )

    def handle_endtag(self, tag: str) -> None:
        if tag == "strong" and self.active_proof:
            self.proof_values[self.active_proof] = self.proof_values[self.active_proof].strip()
            self.active_proof = None


def main() -> int:
    parser = SiteParser()
    parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    errors: list[str] = []

    for attribute, reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc:
            continue
        if parsed.path:
            target = ROOT / parsed.path
            if not target.exists():
                errors.append(f"{attribute} references missing local file: {reference}")
        if parsed.fragment and parsed.fragment not in parser.ids:
            errors.append(f"{attribute} references missing fragment: #{parsed.fragment}")

    if not parser.field_is_hidden:
        errors.append("The decorative field must remain aria-hidden.")

    proof = json.loads((ROOT / "proof.json").read_text(encoding="utf-8"))
    expected_proof = {
        "tests": str(proof["tests"]),
        "coverage": f"{proof['coverage_percent']:.2f}%",
        "python": " · ".join(proof["python_versions"]),
        "evaluators": f"{len(proof['evaluator_names'])} types",
    }
    if parser.proof_values != expected_proof:
        errors.append(
            f"Public proof does not match proof.json: {parser.proof_values!r} != {expected_proof!r}"
        )

    if errors:
        print("Site verification failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Local links, fragments, and field accessibility checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
