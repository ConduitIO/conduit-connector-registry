#!/usr/bin/env python3
"""Validate the registry index source files against index/index-schema.json.

index-sign copies index/connectors/*.json and index/processors/*.json into the
signed index as raw JSON without checking them, and the web build checks only
the signature structure. This script is the schema check in between: each
per-entry file against its $defs entry, and index/index.json against the whole
schema. It also checks that every file is named after the entry it holds and
that names are unique.

Exit status is non-zero if anything fails; every failure is printed.
"""

import json
import pathlib
import sys

import jsonschema

ROOT = pathlib.Path(__file__).resolve().parents[1]


def sub_validator(schema, definition):
    """A validator for one $defs entry that resolves #/$defs/... refs."""
    wrapper = {
        "$schema": schema["$schema"],
        "$id": schema["$id"],
        "$defs": schema["$defs"],
        "$ref": f"#/$defs/{definition}",
    }
    cls = jsonschema.validators.validator_for(schema)
    return cls(wrapper, format_checker=cls.FORMAT_CHECKER)


def main():
    schema = json.loads((ROOT / "index-schema.json").read_text())
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)

    failures = []
    for directory, definition in (("connectors", "connector"), ("processors", "processor")):
        validator = sub_validator(schema, definition)
        seen = {}
        for path in sorted((ROOT / directory).glob("*.json")):
            rel = path.relative_to(ROOT.parent)
            try:
                entry = json.loads(path.read_text())
            except json.JSONDecodeError as err:
                failures.append(f"{rel}: not valid JSON: {err}")
                continue
            for err in validator.iter_errors(entry):
                failures.append(f"{rel}: {err.json_path}: {err.message}")
            name = entry.get("name") if isinstance(entry, dict) else None
            if name != path.stem:
                failures.append(f"{rel}: file name does not match entry name {name!r}")
            if name in seen:
                failures.append(f"{rel}: duplicate name {name!r} (also in {seen[name]})")
            seen[name] = rel

    index_path = ROOT / "index.json"
    for err in cls(schema, format_checker=cls.FORMAT_CHECKER).iter_errors(json.loads(index_path.read_text())):
        failures.append(f"{index_path.relative_to(ROOT.parent)}: {err.json_path}: {err.message}")

    for line in failures:
        print(f"::error::{line}")
    if failures:
        print(f"{len(failures)} schema failure(s)", file=sys.stderr)
        return 1
    print("index source files and index.json validate against index-schema.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
