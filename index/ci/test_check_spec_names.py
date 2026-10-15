"""check_spec_names.py must fail closed, and only fetch pinned URLs.

The network is replaced by a fake fetcher, so these tests never touch GitHub.
Run: python -m unittest discover -s index/ci
"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import check_spec_names as csn  # noqa: E402

YAML = "version: '1.0'\nspecification:\n  name: {name}\n  summary: x\n"
GO = 'package x\nfunc Specification() sdk.Specification {{\n\treturn sdk.Specification{{\n\t\tName:    "{name}",\n\t}}\n}}\n'


def entry(name, owner="conduitio-labs", versions=("v0.1.0",)):
    return {
        "name": name,
        "repository": f"https://github.com/{owner}/conduit-connector-{name}",
        "versions": [{"version": v} for v in versions],
    }


class FakeFetch:
    def __init__(self, files):
        self.files = files  # url -> text, or an Exception instance to raise
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        if url not in self.files:
            raise csn.NotFound(url)
        value = self.files[url]
        if isinstance(value, Exception):
            raise value
        return value


def url(name, tag, path, owner="conduitio-labs"):
    return f"https://raw.githubusercontent.com/{owner}/conduit-connector-{name}/refs/tags/{tag}/{path}"


class CheckSpecNamesTest(unittest.TestCase):
    def test_connector_yaml_match_passes_and_url_is_pinned(self):
        fetch = FakeFetch({url("sqs", "v0.1.0", "connector.yaml"): YAML.format(name="sqs")})
        self.assertEqual(csn.check({"sqs": entry("sqs")}, {"sqs": "sqs"}, fetch), [])
        self.assertEqual(fetch.urls, [url("sqs", "v0.1.0", "connector.yaml")])

    def test_wrong_but_unique_name_fails(self):
        fetch = FakeFetch({url("sqs", "v0.1.0", "connector.yaml"): YAML.format(name="sqs")})
        out = csn.check({"sqs": entry("sqs")}, {"sqs": "amazon-sqs"}, fetch)
        self.assertEqual(len(out), 1)
        self.assertIn("reports spec name 'sqs', spec-names.json says 'amazon-sqs'", out[0])

    def test_every_version_is_checked(self):
        fetch = FakeFetch({
            url("sqs", "v0.1.0", "connector.yaml"): YAML.format(name="sqs"),
            url("sqs", "v0.2.0", "connector.yaml"): YAML.format(name="aws-sqs"),
        })
        out = csn.check({"sqs": entry("sqs", versions=("v0.1.0", "v0.2.0"))}, {"sqs": "sqs"}, fetch)
        self.assertEqual(len(out), 1)
        self.assertIn("sqs@v0.2.0", out[0])

    def test_missing_yaml_without_spec_source_fails(self):
        out = csn.check({"redis": entry("redis")}, {"redis": "redis"}, FakeFetch({}))
        self.assertIn("no connector.yaml at the tag and no specSource recorded", out[0])

    def test_go_spec_source_match_passes(self):
        fetch = FakeFetch({url("redis", "v0.1.0", "spec.go"): GO.format(name="redis")})
        out = csn.check({"redis": entry("redis")}, {"redis": {"spec": "redis", "specSource": "spec.go"}}, fetch)
        self.assertEqual(out, [])

    def test_go_spec_source_mismatch_fails(self):
        fetch = FakeFetch({url("redis", "v0.1.0", "spec.go"): GO.format(name="redis-streams")})
        out = csn.check({"redis": entry("redis")}, {"redis": {"spec": "redis", "specSource": "spec.go"}}, fetch)
        self.assertIn("spec.go reports spec name 'redis-streams'", out[0])

    def test_go_spec_source_missing_file_fails(self):
        out = csn.check({"redis": entry("redis")}, {"redis": {"spec": "redis", "specSource": "spec.go"}}, FakeFetch({}))
        self.assertIn("not found", out[0])

    def test_spec_source_path_traversal_rejected_before_fetch(self):
        fetch = FakeFetch({})
        out = csn.check({"redis": entry("redis")}, {"redis": {"spec": "redis", "specSource": "../x/spec.go"}}, fetch)
        self.assertIn("must be a relative .go path", out[0])
        self.assertEqual(fetch.urls, [])

    def test_fetch_error_fails_closed(self):
        fetch = FakeFetch({url("sqs", "v0.1.0", "connector.yaml"): RuntimeError("timed out")})
        out = csn.check({"sqs": entry("sqs")}, {"sqs": "sqs"}, fetch)
        self.assertIn("fetch failed: timed out", out[0])

    def test_non_tag_version_is_not_fetched(self):
        fetch = FakeFetch({})
        out = csn.check({"sqs": entry("sqs", versions=("main",))}, {"sqs": "sqs"}, fetch)
        self.assertIn("not a vX.Y.Z tag", out[0])
        self.assertEqual(fetch.urls, [])

    def test_owner_outside_allowlist_is_not_fetched(self):
        fetch = FakeFetch({})
        out = csn.check({"sqs": entry("sqs", owner="someone-else")}, {"sqs": "sqs"}, fetch)
        self.assertIn("not an allowlisted GitHub repository", out[0])
        self.assertEqual(fetch.urls, [])

    def test_unmapped_connector_fails(self):
        out = csn.check({"sqs": entry("sqs")}, {}, FakeFetch({}))
        self.assertIn("no spec name in spec-names.json", out[0])


if __name__ == "__main__":
    unittest.main()
