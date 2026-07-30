// Copyright © 2026 Meroxa, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/conduitio/conduit/pkg/registry/index"
)

// A minimal, schema-valid per-processor source file (a serialized
// index.Processor with a single arch-neutral wasm-processor artifact), the shape
// the publish Action writes to index/processors/<name>.json.
const sampleProcessorEntry = `{
  "name": "conduit-processor-ai",
  "displayName": "Conduit AI Processors",
  "description": "Standalone WASM processors for AI pipelines.",
  "repository": "https://github.com/ConduitIO/conduit-processor-ai",
  "publisher": {
    "expectedOIDCIssuer": "https://token.actions.githubusercontent.com",
    "expectedIdentityPattern": "^https://github\\.com/ConduitIO/conduit-processor-ai/\\.github/workflows/publish\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$"
  },
  "versions": [
    {
      "version": "0.1.0",
      "releasedAt": "2026-07-20T12:00:00Z",
      "minConduitVersion": "0.19.0",
      "minProtocolVersion": "0.14.0",
      "artifact": {
        "os": "wasip1",
        "arch": "wasm",
        "kind": "wasm-processor",
        "url": "https://conduit.gateway.scarf.sh/conduitio/conduit-processor-ai/releases/download/v0.1.0/conduit-processor-ai_0.1.0_wasip1_wasm.wasm",
        "sha256": "b1946ac92492d2347c6235b4d2611184a1c9e7f2d3a4b5c6d7e8f90112233445",
        "size": 6291456,
        "signature": {
          "bundleURL": "https://conduit.gateway.scarf.sh/conduitio/conduit-processor-ai/releases/download/v0.1.0/conduit-processor-ai_0.1.0_wasip1_wasm.wasm.sigstore.json",
          "rekorLogIndex": 120553001
        }
      },
      "slsaProvenance": {
        "bundleURL": "https://conduit.gateway.scarf.sh/conduitio/conduit-processor-ai/releases/download/v0.1.0/conduit-processor-ai_0.1.0.intoto.jsonl",
        "predicateType": "https://slsa.dev/provenance/v1"
      },
      "deprecated": false
    }
  ]
}`

const emptyPayload = `{"schemaVersion":1,"index":{"version":1,"timestamp":"2026-07-22T00:00:00Z"},"connectors":[]}`

// TestSignPayload_RootVerifiesAgainstConduitVerify is the whole point of this
// tool: its output must verify against the SHIPPED client's index.Verify. A
// root signature over the empty payload, checked with the signing key as the
// only anchor, must come back Verified + RootVerified.
func TestSignPayload_RootVerifiesAgainstConduitVerify(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	env, err := signPayload(json.RawMessage(emptyPayload), "root", priv)
	if err != nil {
		t.Fatalf("signPayload: %v", err)
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}

	keyID, err := index.KeyID(pub)
	if err != nil {
		t.Fatal(err)
	}
	anchors := index.TrustAnchors{Roots: map[string]ed25519.PublicKey{keyID: pub}}

	// lastVerifiedConnectorsHash "" = a first-time client; only a root sig can verify.
	v, err := index.Verify(raw, anchors, "")
	if err != nil {
		t.Fatalf("index.Verify rejected the signed index: %v", err)
	}
	if !v.Verified || !v.RootVerified {
		t.Fatalf("want Verified && RootVerified, got Verified=%v RootVerified=%v", v.Verified, v.RootVerified)
	}
}

// A freshness signature must NOT satisfy a first-time client (no prior
// connectors hash), proving we can't accidentally bootstrap with a
// content-authorizing signature that the client would reject.
func TestSignPayload_FreshnessAloneFailsFirstTimeClient(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	env, err := signPayload(json.RawMessage(emptyPayload), "freshness", priv)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(env)

	keyID, _ := index.KeyID(pub)
	anchors := index.TrustAnchors{Freshness: map[string]ed25519.PublicKey{keyID: pub}}

	if _, err := index.Verify(raw, anchors, ""); err == nil {
		t.Fatal("a freshness-only signature must NOT verify for a first-time client, but Verify accepted it")
	}
}

// Tampering with the payload after signing must fail verification.
func TestSignPayload_TamperFailsVerify(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	env, err := signPayload(json.RawMessage(emptyPayload), "root", priv)
	if err != nil {
		t.Fatal(err)
	}

	// Flip the payload's index.version after signing.
	var p map[string]any
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatal(err)
	}
	p["index"].(map[string]any)["version"] = float64(999)
	tampered, _ := json.Marshal(p)
	env.Payload = tampered
	raw, _ := json.Marshal(env)

	keyID, _ := index.KeyID(pub)
	anchors := index.TrustAnchors{Roots: map[string]ed25519.PublicKey{keyID: pub}}
	if _, err := index.Verify(raw, anchors, ""); err == nil {
		t.Fatal("tampered payload must fail verification, but Verify accepted it")
	}
}

// assemblePayload collects per-connector files into connectors[], bumps the
// version, and the result still verifies against conduit's index.Verify.
func TestAssemblePayload_BuildsVerifiableIndex(t *testing.T) {
	dir := t.TempDir()
	connDir := dir + "/connectors"
	if err := os.MkdirAll(connDir, 0o755); err != nil {
		t.Fatal(err)
	}
	conn := `{"name":"file","repository":"https://github.com/ConduitIO/conduit-connector-file","publisher":{"expectedOIDCIssuer":"https://token.actions.githubusercontent.com","expectedIdentityPattern":"^x$"},"versions":[{"version":"v0.10.5","releasedAt":"2026-07-23T00:00:00Z","minConduitVersion":"0.15.0","minProtocolVersion":"0.9.0","artifacts":[],"deprecated":false}]}`
	if err := os.WriteFile(connDir+"/file.json", []byte(conn), 0o644); err != nil {
		t.Fatal(err)
	}
	// current signed index at version 5 → assembled must be 6 (monotonic).
	cur := `{"payload":{"schemaVersion":1,"index":{"version":5,"timestamp":"2026-07-22T00:00:00Z"},"connectors":[]},"signatures":[]}`
	curPath := dir + "/index.json"
	if err := os.WriteFile(curPath, []byte(cur), 0o644); err != nil {
		t.Fatal(err)
	}

	payload, err := assemblePayload(connDir, "", curPath, "2026-07-23T01:00:00Z")
	if err != nil {
		t.Fatalf("assemblePayload: %v", err)
	}

	// omitempty mirror: a connector-only assemble must NOT emit a processors[]
	// key, keeping its bytes byte-identical to the pre-processor schema (design
	// doc failure mode 6; index.Payload.Processors `omitempty`).
	if strings.Contains(string(payload), "processors") {
		t.Fatalf("connector-only assemble must omit processors[] entirely, got: %s", payload)
	}

	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	env, err := signPayload(payload, "root", priv)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(env)

	keyID, _ := index.KeyID(pub)
	anchors := index.TrustAnchors{Roots: map[string]ed25519.PublicKey{keyID: pub}}
	v, err := index.Verify(raw, anchors, "")
	if err != nil {
		t.Fatalf("assembled index failed verification: %v", err)
	}
	if !v.Verified || len(v.Payload.Connectors) != 1 || v.Payload.Connectors[0].Name != "file" {
		t.Fatalf("want 1 connector 'file' verified; got verified=%v connectors=%d", v.Verified, len(v.Payload.Connectors))
	}
	if v.Payload.Index.Version != 6 {
		t.Fatalf("want monotonic version 6 (bumped from 5), got %d", v.Payload.Index.Version)
	}
}

// TestAssemblePayload_ProcessorsRoundTripThroughConduitVerify is the whole point
// of PR-D: an assembled payload carrying a processors[] entry, signed by this
// tool, must round-trip through the SHIPPED client's index.Verify /
// index.ParseUnverified (the freshly bumped conduit dependency that added the
// processors[] types). If the signer's canonicalization and conduit's verifier
// ever drifted on processors[], this is where it would show — a signer/verifier
// drift on the content is a signature-bypass-class bug.
func TestAssemblePayload_ProcessorsRoundTripThroughConduitVerify(t *testing.T) {
	dir := t.TempDir()
	connDir := dir + "/connectors"
	procDir := dir + "/processors"
	for _, d := range []string{connDir, procDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	conn := `{"name":"file","repository":"https://github.com/ConduitIO/conduit-connector-file","publisher":{"expectedOIDCIssuer":"https://token.actions.githubusercontent.com","expectedIdentityPattern":"^x$"},"versions":[{"version":"v0.10.5","releasedAt":"2026-07-23T00:00:00Z","minConduitVersion":"0.15.0","minProtocolVersion":"0.9.0","artifacts":[],"deprecated":false}]}`
	if err := os.WriteFile(connDir+"/file.json", []byte(conn), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(procDir+"/conduit-processor-ai.json", []byte(sampleProcessorEntry), 0o644); err != nil {
		t.Fatal(err)
	}
	cur := `{"payload":{"schemaVersion":1,"index":{"version":2,"timestamp":"2026-07-22T00:00:00Z"},"connectors":[]},"signatures":[]}`
	curPath := dir + "/index.json"
	if err := os.WriteFile(curPath, []byte(cur), 0o644); err != nil {
		t.Fatal(err)
	}

	payload, err := assemblePayload(connDir, procDir, curPath, "2026-07-23T01:00:00Z")
	if err != nil {
		t.Fatalf("assemblePayload: %v", err)
	}
	if !strings.Contains(string(payload), "processors") {
		t.Fatalf("processor-bearing assemble must emit processors[], got: %s", payload)
	}

	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	env, err := signPayload(payload, "root", priv)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(env)

	// (1) ParseUnverified: the assembled+signed bytes must parse into conduit's
	// typed Payload — proving the processor entry is schema-shaped as the client
	// expects (no unknown fields, single arch-neutral artifact, etc.).
	parsed, err := index.ParseUnverified(raw)
	if err != nil {
		t.Fatalf("index.ParseUnverified rejected the processor-bearing index: %v", err)
	}
	if len(parsed.Processors) != 1 {
		t.Fatalf("want 1 processor parsed, got %d", len(parsed.Processors))
	}

	// (2) Verify: the same bytes must cryptographically verify against the
	// signing key as the sole root anchor, and expose the processor entry.
	keyID, _ := index.KeyID(pub)
	anchors := index.TrustAnchors{Roots: map[string]ed25519.PublicKey{keyID: pub}}
	v, err := index.Verify(raw, anchors, "")
	if err != nil {
		t.Fatalf("index.Verify rejected the processor-bearing index: %v", err)
	}
	if !v.Verified || !v.RootVerified {
		t.Fatalf("want Verified && RootVerified, got Verified=%v RootVerified=%v", v.Verified, v.RootVerified)
	}
	// Connectors and processors coexist in one signed index.
	if len(v.Payload.Connectors) != 1 || v.Payload.Connectors[0].Name != "file" {
		t.Fatalf("want connector 'file' present alongside the processor; got %d connectors", len(v.Payload.Connectors))
	}
	if len(v.Payload.Processors) != 1 {
		t.Fatalf("want 1 processor verified, got %d", len(v.Payload.Processors))
	}
	p := v.Payload.Processors[0]
	if p.Name != "conduit-processor-ai" {
		t.Fatalf("processor name round-trip mismatch: got %q", p.Name)
	}
	if len(p.Versions) != 1 {
		t.Fatalf("want 1 processor version, got %d", len(p.Versions))
	}
	a := p.Versions[0].Artifact
	if a.Kind != "wasm-processor" || a.OS != "wasip1" || a.Arch != "wasm" {
		t.Fatalf("processor artifact must be the arch-neutral (wasip1/wasm) wasm-processor; got kind=%q os=%q arch=%q", a.Kind, a.OS, a.Arch)
	}

	// (3) Shared freshness canonicalization: the verified content subtree must be
	// hashable by conduit's HashContentSubtree — the exact function the client's
	// freshness-only acceptance path recomputes and compares (design doc D4). This
	// proves the signer's processors[] content is what the freshness check hashes.
	h, err := index.HashContentSubtree(v.Payload.Connectors, v.Payload.Processors)
	if err != nil {
		t.Fatalf("HashContentSubtree over the verified content subtree failed: %v", err)
	}
	if !strings.HasPrefix(h, "sha256:") {
		t.Fatalf("content-subtree hash has unexpected shape: %q", h)
	}
}

// An unknown key (not in the anchor set) must fail closed.
func TestSignPayload_UnknownKeyFailsClosed(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	env, err := signPayload(json.RawMessage(emptyPayload), "root", priv)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(env)

	// A DIFFERENT key is the only anchor.
	otherPub, _, _ := ed25519.GenerateKey(rand.Reader)
	otherID, _ := index.KeyID(otherPub)
	anchors := index.TrustAnchors{Roots: map[string]ed25519.PublicKey{otherID: otherPub}}
	if _, err := index.Verify(raw, anchors, ""); err == nil {
		t.Fatal("a signature by an un-anchored key must fail closed, but Verify accepted it")
	}
}
