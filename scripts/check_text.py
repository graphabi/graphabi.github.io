"""Reject prohibited punctuation in tracked text files."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[1]


def main() -> int:
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).split(b"\0")
    offenders: list[str] = []
    for name in names:
        if not name:
            continue
        path = ROOT / name.decode()
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if chr(0x2014) in text:
            offenders.append(str(path.relative_to(ROOT)))

    if offenders:
        print("Em dash characters are not allowed in tracked project text:")
        for offender in offenders:
            print(f"- {offender}")
        return 1
    print("Tracked project text contains no em dash characters.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
