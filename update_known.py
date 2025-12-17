#!/usr/bin/env python3
"""Append a timestamped success note to the shared known-notes log.

This lightweight helper restores the "one-line success note" workflow
referenced by the Charlie SOP.  Usage:

    python3 update_known.py --note "My short confirmation"

By default the note is appended to ``known-notes.txt`` in the repository
root.  Pass ``--file`` to store it elsewhere.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Record a one-line success note")
    parser.add_argument(
        "--note",
        required=True,
        help="Short confirmation message to record",
    )
    parser.add_argument(
        "--file",
        default="known-notes.txt",
        help="Relative path of the log file to append (default: %(default)s)",
    )
    return parser.parse_args(argv)


def append_note(log_path: Path, note: str) -> Path:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    line = f"{timestamp} | {note.strip()}\n"
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line)
    return log_path


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    note = args.note.strip()
    if not note:
        print("error: note must not be empty", file=sys.stderr)
        return 1
    target = Path(args.file)
    if not target.is_absolute():
        target = Path(__file__).resolve().parent / target
    written_to = append_note(target, note)
    print(f"Logged note to {written_to}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
