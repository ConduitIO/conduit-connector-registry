#!/usr/bin/env python3
"""Structural gate on the signed index (WS4 S6).

This repo publishes index/index.json build-free at index.conduitdata.io/index.json
(deploy.yml), so the publish path no longer runs the UI build that used to be the
index's only pre-publish check. This gate is the replacement: it asserts, with
zero dependencies and no network, that the committed index is shaped like an
index the consumers would accept. It is deliberately structural only — no key
material, no crypto. The crypto is the signing ceremony's job (index-sign.yml,
custodied in the registry-signing Environment) and the round-trip tests in
cmd/index-sign (go-ci.yml); a full signature-verification gate is the UI repo's
S2 build, which verifies the published bytes with the conduit CLI's own verifier.

Checked:
  1. index/index.json is a JSON object with a payload object.
  2. payload.schemaVersion is 1 — the frozen schema; a newer schemaVersion means
     newer tooling than this repo ships, and consumers refuse it.
  3. payload.index.version is an integer and payload.index.timestamp a non-empty
     string.
  4. signatures[] is non-empty and contains a root-role entry with non-empty
     keyId/algorithm/signature — a freshness-only envelope is the exact shape
     that broke the published index on 2026-08-21 (see index-sign.yml's header).
  5. Every payload.connectors[]/processors[] entry has a matching source file
     under index/connectors/ or index/processors/, so the committed index.json
     and the next index-sign reassembly cannot silently diverge.
"""

import json
import os
import sys


def fail(message: str) -> None:
    print(f"index gate: FAILED — {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    path = "index/index.json"
    with open(path, encoding="utf-8") as f:
        try:
            env = json.load(f)
        except json.JSONDecodeError as e:
            fail(f"{path} is not valid JSON: {e}")

    if not isinstance(env, dict):
        fail(f"{path} is not a JSON object")
    payload = env.get("payload")
    if not isinstance(payload, dict):
        fail(f"{path} has no payload object")

    schema_version = payload.get("schemaVersion")
    if schema_version != 1:
        fail(f"payload.schemaVersion is {schema_version!r}, expected 1")

    index_meta = payload.get("index")
    if not isinstance(index_meta, dict) or not isinstance(index_meta.get("version"), int):
        fail("payload.index.version must be an integer")
    if not isinstance(index_meta.get("timestamp"), str) or not index_meta["timestamp"]:
        fail("payload.index.timestamp must be a non-empty string")

    signatures = env.get("signatures")
    if not isinstance(signatures, list) or not signatures:
        fail("signatures[] must be a non-empty list")
    roots = [s for s in signatures if isinstance(s, dict) and s.get("role") == "root"]
    if not roots:
        fail("signatures[] has no root-role entry (a freshness-only envelope is not publishable)")
    for sig in roots:
        for key in ("keyId", "algorithm", "signature"):
            if not isinstance(sig.get(key), str) or not sig[key]:
                fail(f"root signature entry has no non-empty {key!r}")

    for list_key, source_dir in (("connectors", "index/connectors"), ("processors", "index/processors")):
        entries = payload.get(list_key) or []
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not entry["name"]:
                fail(f"payload.{list_key}[] contains a malformed entry")
            source = os.path.join(source_dir, entry["name"] + ".json")
            if not os.path.isfile(source):
                fail(f"payload.{list_key} entry {entry['name']!r} has no source file at {source}")

    print("index gate: OK (schemaVersion 1, root-role signature present, entries assemble)")


if __name__ == "__main__":
    main()
