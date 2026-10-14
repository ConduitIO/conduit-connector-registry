#!/usr/bin/env python3
r"""Validate the registry index source files before they are signed.

index-sign copies index/connectors/*.json and index/processors/*.json into the
signed index as raw JSON without checking them, and the web build checks only
the signature structure. This script is the check in between. It runs on every
pull request (index-schema.yml) and inside index-sign.yml before signing, so a
malformed entry pushed straight to main is never signed.

Checks:

- schema: each entry file against its $defs entry, and index/index.json against
  the whole schema, with format checking (uri, date-time) required to be active;
- layout: both entry directories exist and are non-empty, file names match entry
  names, names are unique;
- trust lints: the repository owner is allowlisted (ConduitIO,
  conduitio-labs); publisher.expectedOIDCIssuer is the GitHub Actions issuer;
  publisher.expectedIdentityPattern starts with exactly
  ^https://github\.com/<owner>/<repo>/\.github/workflows/publish\.yml@refs/tags/
  for the entry's own repository; every artifact, signature and provenance URL
  is under that repository's releases and has no '.' or '..' path segment;
  versions is non-empty;
- spec names: every connector has an entry in ci/spec-names.json and no two
  connectors share a spec name. Whether each recorded name is the one the
  release actually reports is checked by check_spec_names.py, which needs the
  network and runs as its own step.

Exit status is non-zero if anything fails; every failure is printed.
"""

import json
import pathlib
import re
import sys

import jsonschema

ROOT = pathlib.Path(__file__).resolve().parents[1]
GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
REPO_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$")
# GitHub organizations whose repositories may be listed. A new owner is a
# deliberate, reviewed change to this line, not something an entry can bring.
ALLOWED_OWNERS = frozenset({"ConduitIO", "conduitio-labs"})


def format_checker(cls):
    """Return a format checker, failing loudly if uri or date-time is not enforced.

    jsonschema only enforces a format when its optional dependency is installed
    (jsonschema[format]); without it, "yesterday" passes as a date-time.
    """
    checker = cls.FORMAT_CHECKER
    probes = {"date-time": "yesterday", "uri": "not a uri"}
    for fmt, bad in probes.items():
        if fmt not in checker.checkers or checker.conforms(bad, fmt):
            sys.exit(f"::error::format checker for {fmt!r} is not active; install jsonschema[format]")
    return checker


def sub_validator(cls, schema, definition, checker):
    """A validator for one $defs entry that resolves #/$defs/... refs."""
    wrapper = {
        "$schema": schema["$schema"],
        "$id": schema["$id"],
        "$defs": schema["$defs"],
        "$ref": f"#/$defs/{definition}",
    }
    return cls(wrapper, format_checker=checker)


def esc(part):
    return part.replace(".", r"\.")


def repo_of(entry):
    """(owner, repo) of an entry's repository, or None if it is malformed or not allowlisted."""
    m = REPO_RE.match(entry.get("repository") or "")
    if not m or m.group(1) not in ALLOWED_OWNERS or m.group(2) in (".", ".."):
        return None
    return m.groups()


def has_dot_segment(url):
    """True if the URL path has a '.' or '..' segment, literally or percent-encoded."""
    path = str(url).split("?", 1)[0].split("#", 1)[0]
    segments = path.split("/")[3:]  # after scheme:, '', host
    return any(seg.lower().replace("%2e", ".") in (".", "..") for seg in segments)


def spec_name(value):
    """spec-names.json values are a spec name, or {"spec": name, "specSource": path}."""
    return value["spec"] if isinstance(value, dict) else value


def trust_lints(rel, entry, kind):
    """Checks the schema cannot express: identity, issuer and URLs tied to the repo."""
    out = []
    repo = entry.get("repository")
    parts = repo_of(entry)
    if not parts:
        return [
            f"{rel}: repository must be https://github.com/<owner>/<repo> with owner in "
            f"{sorted(ALLOWED_OWNERS)}, got {repo!r}"
        ]
    owner, name = parts
    pub = entry.get("publisher") or {}
    if pub.get("expectedOIDCIssuer") != GITHUB_ISSUER:
        out.append(f"{rel}: publisher.expectedOIDCIssuer must be {GITHUB_ISSUER}")
    prefix = rf"^https://github\.com/{esc(owner)}/{esc(name)}/\.github/workflows/publish\.yml@refs/tags/"
    if not str(pub.get("expectedIdentityPattern", "")).startswith(prefix):
        out.append(f"{rel}: publisher.expectedIdentityPattern must start with {prefix}")
    versions = entry.get("versions") or []
    if not versions:
        out.append(f"{rel}: versions must be non-empty")
    base = f"https://github.com/{owner}/{name}/releases/download/"
    for i, v in enumerate(versions):
        arts = v.get("artifacts") if kind == "connector" else [v.get("artifact")]
        urls = []
        for a in arts or []:
            a = a or {}
            urls += [("url", a.get("url")), ("signature.bundleURL", (a.get("signature") or {}).get("bundleURL"))]
        urls.append(("slsaProvenance.bundleURL", (v.get("slsaProvenance") or {}).get("bundleURL")))
        for field, url in urls:
            if url is not None and not str(url).startswith(base):
                out.append(f"{rel}: versions[{i}] {field} must be under {base}, got {url!r}")
            elif url is not None and has_dot_segment(url):
                out.append(f"{rel}: versions[{i}] {field} must not contain '.' or '..' path segments, got {url!r}")
    return out


def main():
    schema = json.loads((ROOT / "index-schema.json").read_text())
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)
    checker = format_checker(cls)
    spec_names = json.loads((ROOT / "ci" / "spec-names.json").read_text())
    spec_names.pop("_comment", None)

    failures = []
    for directory, definition in (("connectors", "connector"), ("processors", "processor")):
        validator = sub_validator(cls, schema, definition, checker)
        entry_dir = ROOT / directory
        paths = sorted(entry_dir.glob("*.json")) if entry_dir.is_dir() else []
        if not paths:
            failures.append(f"index/{directory}: missing or has no entry files")
        seen = {}
        for path in paths:
            rel = path.relative_to(ROOT.parent)
            try:
                entry = json.loads(path.read_text())
            except json.JSONDecodeError as err:
                failures.append(f"{rel}: not valid JSON: {err}")
                continue
            if not isinstance(entry, dict):
                failures.append(f"{rel}: entry must be a JSON object")
                continue
            for err in validator.iter_errors(entry):
                failures.append(f"{rel}: {err.json_path}: {err.message}")
            failures += trust_lints(rel, entry, definition)
            name = entry.get("name")
            if name != path.stem:
                failures.append(f"{rel}: file name does not match entry name {name!r}")
            if name in seen:
                failures.append(f"{rel}: duplicate name {name!r} (also in {seen[name]})")
            seen[name] = rel
        if definition == "connector":
            for name in seen:
                if name not in spec_names:
                    failures.append(f"index/ci/spec-names.json: no spec name recorded for connector {name!r}")
            for name in spec_names:
                if name not in seen:
                    failures.append(f"index/ci/spec-names.json: {name!r} has no entry in index/connectors")
            by_spec = {}
            for name, value in spec_names.items():
                by_spec.setdefault(spec_name(value), []).append(name)
            for spec, names in sorted(by_spec.items()):
                if len(names) > 1:
                    failures.append(f"index/ci/spec-names.json: spec name {spec!r} is shared by {sorted(names)}")

    index_path = ROOT / "index.json"
    for err in cls(schema, format_checker=checker).iter_errors(json.loads(index_path.read_text())):
        failures.append(f"{index_path.relative_to(ROOT.parent)}: {err.json_path}: {err.message}")

    for line in failures:
        print(f"::error::{line}")
    if failures:
        print(f"{len(failures)} validation failure(s)", file=sys.stderr)
        return 1
    print("index source files and index.json validate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
