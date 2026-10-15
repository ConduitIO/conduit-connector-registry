#!/usr/bin/env python3
"""Check index/ci/spec-names.json against what each listed release reports.

validate_entries.py only checks that spec-names.json is complete and has no
duplicates, so a wrong but unique value would pass it. This script reads the
spec name from the source of every listed connector version at its release
tag and compares:

- connector.yaml at the tag, `specification.name` (SDK v0.13 and later);
- otherwise, the Go file named by "specSource" in spec-names.json, whose
  sdk.Specification{...} literal must carry Name: "<spec>" (older SDKs that
  define the spec in code). A version with neither fails.

Every fetch is pinned: https://raw.githubusercontent.com/<owner>/<repo>/refs/tags/<tag>/<path>,
where owner/repo come from the entry's allowlisted repository and tag is the
version string, which must look like vX.Y.Z. Fetches time out, transient
errors are retried a few times, and any error that remains fails the check:
it fails closed, never skips.
"""

import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from validate_entries import repo_of, spec_name  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
TAG_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+$")
SOURCE_RE = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.go$")
GO_SPEC_RE = re.compile(r"sdk\.Specification\{.*?\bName:\s*\"([^\"]+)\"", re.DOTALL)
TIMEOUT = 20
ATTEMPTS = 3


class NotFound(Exception):
    pass


def http_fetch(url):
    """GET url and return the body as text. NotFound on 404; any other failure raises."""
    last = None
    for attempt in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise NotFound(url) from err
            if err.code < 500:
                raise
            last = err
        except (urllib.error.URLError, TimeoutError) as err:
            last = err
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def raw_url(owner, repo, tag, path):
    return f"https://raw.githubusercontent.com/{owner}/{repo}/refs/tags/{tag}/{path}"


def check(connectors, spec_names, fetch):
    """Return a list of failure strings. connectors maps name -> entry dict."""
    failures = []
    for name, entry in sorted(connectors.items()):
        if name not in spec_names:
            failures.append(f"{name}: no spec name in spec-names.json")
            continue
        value = spec_names[name]
        want = spec_name(value)
        source = value.get("specSource") if isinstance(value, dict) else None
        if source is not None and (not SOURCE_RE.match(source)):
            failures.append(f"{name}: specSource {source!r} must be a relative .go path without '.' segments")
            continue
        parts = repo_of(entry)
        if not parts:
            failures.append(f"{name}: repository is not an allowlisted GitHub repository")
            continue
        owner, repo = parts
        for v in entry.get("versions") or []:
            tag = v.get("version", "")
            if not TAG_RE.match(tag):
                failures.append(f"{name}@{tag}: version is not a vX.Y.Z tag, cannot pin the fetch")
                continue
            try:
                got = None
                try:
                    doc = yaml.safe_load(fetch(raw_url(owner, repo, tag, "connector.yaml")))
                    got = ((doc or {}).get("specification") or {}).get("name")
                    where = "connector.yaml"
                except NotFound:
                    if source is None:
                        failures.append(f"{name}@{tag}: no connector.yaml at the tag and no specSource recorded")
                        continue
                    m = GO_SPEC_RE.search(fetch(raw_url(owner, repo, tag, source)))
                    got = m.group(1) if m else None
                    where = source
            except NotFound as err:
                failures.append(f"{name}@{tag}: {err} not found")
                continue
            except Exception as err:  # fail closed on anything else
                failures.append(f"{name}@{tag}: fetch failed: {err}")
                continue
            if got != want:
                failures.append(f"{name}@{tag}: {where} reports spec name {got!r}, spec-names.json says {want!r}")
    return failures


def main():
    spec_names = json.loads((ROOT / "ci" / "spec-names.json").read_text())
    spec_names.pop("_comment", None)
    connectors = {}
    for path in sorted((ROOT / "connectors").glob("*.json")):
        entry = json.loads(path.read_text())
        connectors[entry["name"]] = entry
    if not connectors:
        print("::error::index/connectors has no entries")
        return 1
    failures = check(connectors, spec_names, http_fetch)
    for line in failures:
        print(f"::error::{line}")
    if failures:
        print(f"{len(failures)} spec-name failure(s)", file=sys.stderr)
        return 1
    print(f"spec names match the released source for {len(connectors)} connectors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
