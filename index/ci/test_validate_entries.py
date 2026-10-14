"""Each check in validate_entries.py must be able to fail.

Every test copies index/ into a temporary directory, applies one bad edit, runs
the validator on the copy and asserts it fails with the expected message. The
control test asserts the unmodified tree passes.

Run: python -m unittest discover -s index/ci
"""

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

INDEX = pathlib.Path(__file__).resolve().parents[1]


class ValidateEntriesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.index = pathlib.Path(self.tmp.name) / "index"
        shutil.copytree(INDEX, self.index)

    def tearDown(self):
        self.tmp.cleanup()

    def edit(self, rel, fn):
        path = self.index / rel
        data = json.loads(path.read_text())
        fn(data)
        path.write_text(json.dumps(data))

    def run_validator(self):
        return subprocess.run(
            [sys.executable, str(self.index / "ci" / "validate_entries.py")],
            capture_output=True,
            text=True,
        )

    def assert_fails(self, needle):
        p = self.run_validator()
        self.assertNotEqual(p.returncode, 0, p.stdout)
        self.assertIn(needle, p.stdout)

    def test_control_passes(self):
        p = self.run_validator()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_bad_date_time(self):
        self.edit("connectors/sqs.json", lambda d: d["versions"][0].update(releasedAt="yesterday"))
        self.assert_fails("is not a 'date-time'")

    def test_http_artifact_url(self):
        def f(d):
            a = d["versions"][0]["artifacts"][0]
            a["url"] = a["url"].replace("https://", "http://")
        self.edit("connectors/sqs.json", f)
        self.assert_fails("url must be under https://github.com/conduitio-labs/conduit-connector-sqs/releases/download/")

    def test_foreign_provenance_url(self):
        self.edit("connectors/sqs.json", lambda d: d["versions"][0]["slsaProvenance"].update(bundleURL="https://example.com/p.jsonl"))
        self.assert_fails("slsaProvenance.bundleURL must be under")

    def test_identity_pattern_other_repo(self):
        def f(d):
            p = d["publisher"]
            p["expectedIdentityPattern"] = p["expectedIdentityPattern"].replace("conduitio-labs", "evil-org")
        self.edit("connectors/sqs.json", f)
        self.assert_fails("expectedIdentityPattern must start with")

    def test_wrong_issuer(self):
        self.edit("connectors/sqs.json", lambda d: d["publisher"].update(expectedOIDCIssuer="https://accounts.google.com"))
        self.assert_fails("expectedOIDCIssuer must be")

    def test_empty_versions(self):
        self.edit("connectors/sqs.json", lambda d: d.update(versions=[]))
        self.assert_fails("versions must be non-empty")

    def test_bad_tier(self):
        self.edit("connectors/sqs.json", lambda d: d.update(tier="Certified"))
        self.assert_fails("is not one of")

    def test_free_text_license(self):
        self.edit("connectors/sqs.json", lambda d: d.update(license="MIT License"))
        self.assert_fails("does not match")

    def test_empty_connectors_dir(self):
        for f in (self.index / "connectors").glob("*.json"):
            f.unlink()
        self.assert_fails("index/connectors: missing or has no entry files")

    def test_missing_processors_dir(self):
        shutil.rmtree(self.index / "processors")
        self.assert_fails("index/processors: missing or has no entry files")

    def test_file_name_mismatch(self):
        shutil.copy(self.index / "connectors" / "sqs.json", self.index / "connectors" / "sqs2.json")
        self.assert_fails("file name does not match entry name")

    def test_spec_name_collision(self):
        self.edit("ci/spec-names.json", lambda m: m.update(redis="activemq"))
        self.assert_fails("spec name 'activemq' is shared by ['activemq-artemis', 'redis']")

    def test_unmapped_connector(self):
        self.edit("ci/spec-names.json", lambda m: m.pop("redis"))
        self.assert_fails("no spec name recorded for connector 'redis'")

    def test_stale_mapping(self):
        self.edit("ci/spec-names.json", lambda m: m.update(gone="gone"))
        self.assert_fails("'gone' has no entry in index/connectors")

    def test_identity_pattern_any_workflow(self):
        # Anchored to the repository but not to publish.yml at a tag: any
        # workflow or branch in the repo could then sign.
        self.edit("connectors/sqs.json", lambda d: d["publisher"].update(
            expectedIdentityPattern=r"^https://github\.com/conduitio-labs/conduit-connector-sqs/.*$"))
        self.assert_fails(r"must start with ^https://github\.com/conduitio-labs/conduit-connector-sqs/\.github/workflows/publish\.yml@refs/tags/")

    def test_owner_not_allowlisted(self):
        # Fully self-consistent entry from another owner: repository, identity
        # and URLs all agree, so only the allowlist can catch it.
        def f(d):
            text = json.dumps(d).replace("conduitio-labs", "someone-else")
            d.clear()
            d.update(json.loads(text))
        self.edit("connectors/sqs.json", f)
        self.assert_fails("with owner in ['ConduitIO', 'conduitio-labs']")

    def test_dot_dot_segment_in_url(self):
        def f(d):
            a = d["versions"][0]["artifacts"][0]
            a["url"] = a["url"].replace("/releases/download/v0.3.1/", "/releases/download/v0.3.1/../../../../evil/repo/releases/download/x/")
        self.edit("connectors/sqs.json", f)
        self.assert_fails("must not contain '.' or '..' path segments")

    def test_encoded_dot_dot_segment_in_url(self):
        def f(d):
            a = d["versions"][0]["artifacts"][0]
            a["signature"]["bundleURL"] = a["signature"]["bundleURL"].replace("/v0.3.1/", "/v0.3.1/%2E%2e/")
        self.edit("connectors/sqs.json", f)
        self.assert_fails("must not contain '.' or '..' path segments")

    def test_spec_name_collision_with_dict_value(self):
        self.edit("ci/spec-names.json", lambda m: m.update(sqs={"spec": "redis", "specSource": "spec.go"}))
        self.assert_fails("spec name 'redis' is shared by ['redis', 'sqs']")


if __name__ == "__main__":
    unittest.main()
