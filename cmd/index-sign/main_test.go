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
	"testing"

	"github.com/conduitio/conduit/pkg/registry/index"
)

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
