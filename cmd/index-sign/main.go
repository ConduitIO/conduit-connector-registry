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
// ROOT signature, so every CONTENT change (adding/removing a connector or a
// processor) must be root-signed. Freshness signatures only refresh
// timestamp/version over a byte-identical CONTENT SUBTREE — connectors[] AND
// processors[] (index.HashContentSubtree; design doc
// 20260727-registry-processor-artifacts, D4) — and are useless to a client that
// hasn't seen the index — so --role root is the bootstrap and per-content-change
// signer.
//
// This tool does NOT compute or embed any content hash. The freshness
// content-identity check is enforced entirely CLIENT-SIDE: index.Verify
// canonicalizes the received payload, and for a freshness-only signature
// recomputes index.HashContentSubtree(connectors[], processors[]) and compares
// it against the client's persisted last-root-verified hash (verify.go's
// matchesLastVerifiedContent). The signer's only job is to sign the whole
// canonical payload — processors[] included when present — so the subtree the
// client hashes is exactly the subtree this tool signed. Because both sides call
// the same imported index package for Canonicalize/HashContentSubtree, signer
// and verifier cannot drift on what "the content" is.
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
	assembleProcessorsFrom := flag.String("assemble-processors-from", "", "directory of per-processor JSON files (index/processors/*.json); when set, the payload's processors[] is assembled from them, mirroring --assemble-from for connectors. When empty (or the dir has no files) the processors[] key is omitted entirely, keeping a connector-only index byte-identical to the pre-processor schema")
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
	if *assembleFrom != "" || *assembleProcessorsFrom != "" {
		payload, err = assemblePayload(*assembleFrom, *assembleProcessorsFrom, *in, *timestamp)
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
// source files in connDir (each a serialized index.Connector, as the publish
// Action writes to index/connectors/<name>.json) and, when procDir is non-empty,
// its processors[] from the per-processor source files there (each a serialized
// index.Processor, index/processors/<name>.json) — the exact same glob → sort →
// embed-raw flow. Both collections are sorted by filename for a deterministic
// result. index.version is bumped by 1 from the current signed index at
// currentPath (monotonic — the client rejects a rollback); timestamp (RFC3339)
// is set from ts. Entries are embedded as raw JSON so this tool never has to
// model the full connector/processor schema — the publish Action already
// produced schema-valid files, and index.Verify re-checks the whole payload.
//
// The processors[] key is written ONLY when at least one processor entry exists.
// A connector-only assemble therefore omits the key entirely, so its canonical
// bytes are byte-identical to the pre-processor schema — mirroring the
// index.Payload.Processors `omitempty` tag, which the design doc (failure mode 6)
// marks load-bearing: an empty processors[] must never drift a connector-only
// index's bytes or the content-subtree hash computed over it.
func assemblePayload(connDir, procDir, currentPath, ts string) (json.RawMessage, error) {
	connectors, err := readEntries(connDir)
	if err != nil {
		return nil, err
	}
	processors, err := readEntries(procDir)
	if err != nil {
		return nil, err
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
	// omitempty mirror: only emit processors[] when there is content, so a
	// connector-only index stays byte-identical to the pre-processor schema.
	if len(processors) > 0 {
		payload["processors"] = processors
	}
	return json.Marshal(payload)
}

// readEntries globs dir for *.json, sorts by filename (deterministic; the
// publish Action names each file <name>.json, so filename order is name order),
// and returns each file's bytes embedded as raw JSON. An empty dir ("") yields
// an empty (never nil) slice so connectors[] always marshals to at least [] (a
// schema-required, possibly-empty array) while processors[] can be tested for
// emptiness by the caller. Each file must be valid JSON; index.Verify re-checks
// the whole assembled payload against the typed schema.
func readEntries(dir string) ([]json.RawMessage, error) {
	if dir == "" {
		return []json.RawMessage{}, nil
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("globbing %s: %w", dir, err)
	}
	sort.Strings(files) // deterministic order; filename is <name>.json so this is name order

	entries := make([]json.RawMessage, 0, len(files))
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", f, err)
		}
		if !json.Valid(b) {
			return nil, fmt.Errorf("%s is not valid JSON", f)
		}
		entries = append(entries, json.RawMessage(b))
	}
	return entries, nil
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
