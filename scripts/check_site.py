"""Verify local links and progressive-enhancement invariants."""

from __future__ import annotations

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

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if identifier := values.get("id"):
            self.ids.add(identifier)
        for name in ("href", "src"):
            if reference := values.get(name):
                self.references.append((name, reference))
        if tag == "canvas" and "data-field" in values:
            self.field_is_hidden = values.get("aria-hidden") == "true"


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

    if errors:
        print("Site verification failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Local links, fragments, and field accessibility checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
