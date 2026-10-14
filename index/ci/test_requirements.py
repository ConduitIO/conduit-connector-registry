"""requirements.txt must stay hash-pinned so pip --require-hashes can install it.

Run: python -m unittest discover -s index/ci
"""

import pathlib
import re
import unittest

REQ = pathlib.Path(__file__).resolve().parent / "requirements.txt"


def requirements(text):
    """Yield (name_and_version, hashes) for each requirement in a pip-compile style file."""
    joined = re.sub(r"\\\n\s*", " ", text)
    for line in joined.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        yield line.split()[0], re.findall(r"--hash=sha256:[0-9a-f]{64}", line)


class RequirementsTest(unittest.TestCase):
    def test_every_requirement_is_exact_and_hashed(self):
        reqs = list(requirements(REQ.read_text()))
        self.assertTrue(reqs)
        for name, hashes in reqs:
            self.assertRegex(name, r"^[A-Za-z0-9_.\[\]-]+==[^=]+$", f"{name} is not pinned with ==")
            self.assertTrue(hashes, f"{name} has no --hash")

    def test_parser_flags_an_unhashed_line(self):
        reqs = dict(requirements("jsonschema==4.26.0\npyyaml==6.0.3 \\\n    --hash=sha256:" + "a" * 64 + "\n"))
        self.assertEqual(reqs["jsonschema==4.26.0"], [])
        self.assertEqual(len(reqs["pyyaml==6.0.3"]), 1)


if __name__ == "__main__":
    unittest.main()
