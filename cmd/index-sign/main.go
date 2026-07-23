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

// Command index-sign produces a signed registry index envelope. It reuses
// conduit's pkg/registry/index for canonicalization and keyId derivation so the
// output verifies byte-for-byte against index.Verify in the shipped client —
// the signer and verifier must never drift.
//
// It signs over Canonicalize(payload) (JCS / RFC 8785) with an ed25519 key and
// writes {payload: <canonical>, signatures: [{role, keyId, algorithm, signature}]}.
//
// Role semantics (see index.Verify): a first-time client can only verify a
// ROOT signature, so every CONTENT change (adding/removing a connector) must be
// root-signed. Freshness signatures only refresh timestamp/version over a
// byte-identical connectors[] and are useless to a client that hasn't seen the
// index — so --role root is the bootstrap and per-content-change signer.
package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/conduitio/conduit/pkg/registry/index"
)

type envelope struct {
	Payload    json.RawMessage   `json:"payload"`
	Signatures []index.Signature `json:"signatures"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "index-sign: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	in := flag.String("in", "index/index.json", "input file: a signed envelope or a bare payload JSON (the payload is extracted and re-signed)")
	out := flag.String("out", "", "output file (default: same as -in)")
	role := flag.String("role", "root", `signature role: "root" (content changes) or "freshness" (liveness only)`)
	keyEnv := flag.String("key-env", "ROOT_SIGNING_KEY", "env var holding the PKCS#8 PEM ed25519 private key")
	keyFile := flag.String("key-file", "", "file holding the PKCS#8 PEM ed25519 private key (overrides -key-env)")
	assembleFrom := flag.String("assemble-from", "", "directory of per-connector JSON files (index/connectors/*.json); when set, the payload's connectors[] is assembled from them and index.version is bumped from -in")
	timestamp := flag.String("timestamp", "", "RFC3339 index timestamp for assembled payloads (default: -in's current timestamp preserved is NOT done; caller should pass one)")
	flag.Parse()

	if *role != "root" && *role != "freshness" {
		return fmt.Errorf("--role must be root or freshness, got %q", *role)
	}
	if *out == "" {
		*out = *in
	}

	var (
		payload json.RawMessage
		err     error
	)
	if *assembleFrom != "" {
		payload, err = assemblePayload(*assembleFrom, *in, *timestamp)
	} else {
		payload, err = readPayload(*in)
	}
	if err != nil {
		return err
	}

	priv, err := loadPrivateKey(*keyFile, *keyEnv)
	if err != nil {
		return err
	}

	env, err := signPayload(payload, *role, priv)
	if err != nil {
		return err
	}
	rawOut, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling envelope: %w", err)
	}
	rawOut = append(rawOut, '\n')

	// Atomic write: temp + rename, so a crash can't leave a torn index.
	tmp := *out + ".tmp"
	if err := os.WriteFile(tmp, rawOut, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, *out); err != nil {
		return fmt.Errorf("renaming %s -> %s: %w", tmp, *out, err)
	}

	fmt.Fprintf(os.Stderr, "signed %s: role=%s keyId=%s\n", *out, *role, env.Signatures[0].KeyID)
	return nil
}

// signPayload canonicalizes payload (JCS), ed25519-signs the canonical bytes,
// and returns an envelope storing the canonical payload + one signature. The
// canonical payload is stored (not the original) so a re-verify canonicalizes
// already-canonical bytes to an identical result. keyId is derived from the
// key via index.KeyID — never invented — so it matches what index.Verify
// looks up.
func signPayload(payload json.RawMessage, role string, priv ed25519.PrivateKey) (envelope, error) {
	canonical, err := index.Canonicalize(payload)
	if err != nil {
		return envelope{}, fmt.Errorf("canonicalizing payload: %w", err)
	}
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return envelope{}, fmt.Errorf("loaded key is not ed25519")
	}
	keyID, err := index.KeyID(pub)
	if err != nil {
		return envelope{}, fmt.Errorf("deriving keyId: %w", err)
	}
	sig := ed25519.Sign(priv, canonical)
	return envelope{
		Payload: canonical,
		Signatures: []index.Signature{{
			Role:      role,
			KeyID:     keyID,
			Algorithm: "ed25519",
			Signature: base64.StdEncoding.EncodeToString(sig),
		}},
	}, nil
}

// assemblePayload builds the index payload's connectors[] from the per-connector
// source files in dir (each a serialized index.Connector, as the publish Action
// writes to index/connectors/<name>.json), sorted by filename for a
// deterministic result. index.version is bumped by 1 from the current signed
// index at currentPath (monotonic — the client rejects a rollback); timestamp
// (RFC3339) is set from ts. Connectors are embedded as raw JSON so this tool
// never has to model the full connector schema — the publish Action already
// produced schema-valid files, and index.Verify re-checks the whole payload.
func assemblePayload(dir, currentPath, ts string) (json.RawMessage, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("globbing %s: %w", dir, err)
	}
	sort.Strings(files) // deterministic order; filename is <name>.json so this is name order

	connectors := make([]json.RawMessage, 0, len(files))
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", f, err)
		}
		if !json.Valid(b) {
			return nil, fmt.Errorf("%s is not valid JSON", f)
		}
		connectors = append(connectors, json.RawMessage(b))
	}

	nextVersion := currentIndexVersion(currentPath) + 1
	if ts == "" {
		return nil, fmt.Errorf("assemble requires -timestamp (RFC3339)")
	}

	payload := map[string]any{
		"schemaVersion": 1,
		"index":         map[string]any{"version": nextVersion, "timestamp": ts},
		"connectors":    connectors,
	}
	return json.Marshal(payload)
}

// currentIndexVersion reads index.version from the current signed index (an
// envelope) at path, returning 0 if it can't be read (so the first assemble
// starts at version 1).
func currentIndexVersion(path string) int {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	var env struct {
		Payload struct {
			Index struct {
				Version int `json:"version"`
			} `json:"index"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return 0
	}
	return env.Payload.Index.Version
}

// readPayload accepts either a full envelope (extract .payload) or a bare
// payload object, so the tool can re-sign an existing index or sign a fresh
// payload template.
func readPayload(path string) (json.RawMessage, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, fmt.Errorf("parsing %s as JSON: %w", path, err)
	}
	if p, ok := probe["payload"]; ok {
		return p, nil // it's an envelope
	}
	return raw, nil // it's a bare payload
}

func loadPrivateKey(file, env string) (ed25519.PrivateKey, error) {
	var pemBytes []byte
	switch {
	case file != "":
		b, err := os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("reading key file %s: %w", file, err)
		}
		pemBytes = b
	default:
		v := os.Getenv(env)
		if v == "" {
			return nil, fmt.Errorf("no signing key: env %s is empty and no -key-file given", env)
		}
		pemBytes = []byte(v)
	}

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("signing key is not valid PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing PKCS#8 private key: %w", err)
	}
	priv, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("signing key is %T, want ed25519.PrivateKey", key)
	}
	return priv, nil
}
