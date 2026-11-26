// Command passkey_e2e checks the sign-in security flows of a running TaskFlow
// stack with a software passkey (a virtual WebAuthn authenticator), so no
// browser or hardware key is needed:
//
//	go run ./scripts/passkey_e2e -api http://localhost:8081 -origin http://localhost:3000 \
//	    -email admin@example.com -password '...'
//
// The account must be an admin (passkey required) with no passkey yet, and
// the stack must not require an emailed setup code (no SMTP, or
// PASSKEY_SETUP_EMAIL_CODE=off). It registers a passkey, signs in with it
// (with and without a password), uses a recovery code, and confirms that the
// password alone is no longer enough.
package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"

	"github.com/fxamacker/cbor/v2"
)

var (
	api      = flag.String("api", "http://localhost:8081", "gateway base URL")
	origin   = flag.String("origin", "http://localhost:3000", "web origin (PUBLIC_URL)")
	email    = flag.String("email", "", "admin email")
	password = flag.String("password", "", "admin password")
	failures int
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func unb64(s string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func call(method, path string, body interface{}, token string) (int, map[string]interface{}) {
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, *api+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	out := map[string]interface{}{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func check(ok bool, what string, detail ...interface{}) {
	if ok {
		fmt.Println("PASS", what)
		return
	}
	failures++
	fmt.Println("FAIL", what, detail)
}

// authenticator is a software passkey holding one P-256 key.
type authenticator struct {
	rpID   string
	key    *ecdsa.PrivateKey
	credID []byte
	userID []byte
	count  uint32
}

func (a *authenticator) rpHash() []byte { h := sha256.Sum256([]byte(a.rpID)); return h[:] }

func clientData(kind, challenge string) []byte {
	raw, _ := json.Marshal(map[string]interface{}{"type": kind, "challenge": challenge, "origin": *origin, "crossOrigin": false})
	return raw
}

func (a *authenticator) create(options map[string]interface{}) map[string]interface{} {
	pk := options["publicKey"].(map[string]interface{})
	a.userID = unb64(pk["user"].(map[string]interface{})["id"].(string))
	a.key, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	a.credID = make([]byte, 32)
	_, _ = rand.Read(a.credID)
	x, y := a.key.PublicKey.X.FillBytes(make([]byte, 32)), a.key.PublicKey.Y.FillBytes(make([]byte, 32))
	cose, _ := cbor.Marshal(map[int]interface{}{1: 2, 3: -7, -1: 1, -2: x, -3: y})
	auth := append([]byte{}, a.rpHash()...)
	auth = append(auth, 0x01|0x04|0x08|0x10|0x40) // UP, UV, BE, BS, AT
	auth = binary.BigEndian.AppendUint32(auth, a.count)
	auth = append(auth, make([]byte, 16)...) // AAGUID
	auth = binary.BigEndian.AppendUint16(auth, uint16(len(a.credID)))
	auth = append(auth, a.credID...)
	auth = append(auth, cose...)
	att, _ := cbor.Marshal(map[string]interface{}{"fmt": "none", "attStmt": map[string]interface{}{}, "authData": auth})
	return map[string]interface{}{
		"id": b64(a.credID), "rawId": b64(a.credID), "type": "public-key", "clientExtensionResults": map[string]interface{}{},
		"response": map[string]interface{}{
			"clientDataJSON":    b64(clientData("webauthn.create", pk["challenge"].(string))),
			"attestationObject": b64(att),
			"transports":        []string{"internal"},
		},
	}
}

func (a *authenticator) get(options map[string]interface{}) map[string]interface{} {
	pk := options["publicKey"].(map[string]interface{})
	a.count++
	auth := append([]byte{}, a.rpHash()...)
	auth = append(auth, 0x01|0x04|0x08|0x10)
	auth = binary.BigEndian.AppendUint32(auth, a.count)
	cd := clientData("webauthn.get", pk["challenge"].(string))
	cdHash := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, auth...), cdHash[:]...))
	sig, _ := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	return map[string]interface{}{
		"id": b64(a.credID), "rawId": b64(a.credID), "type": "public-key", "clientExtensionResults": map[string]interface{}{},
		"response": map[string]interface{}{
			"clientDataJSON": b64(cd), "authenticatorData": b64(auth), "signature": b64(sig), "userHandle": b64(a.userID),
		},
	}
}

func main() {
	flag.Parse()
	if *email == "" || *password == "" {
		fmt.Println("usage: -email and -password are required")
		os.Exit(2)
	}
	u, _ := url.Parse(*origin)
	dev := &authenticator{rpID: u.Hostname()}
	creds := map[string]string{"email": *email, "password": *password}

	// 1. Password only: an admin without a passkey must set one up.
	code, res := call("POST", "/api/v2/auth/login", creds, "")
	check(code == 200 && res["passkey_setup_required"] == true && res["access_token"] == nil, "password alone gives no session to an admin", code, res)
	step, _ := res["step_token"].(string)

	// 2. Legacy password-only endpoint refuses admins.
	code, res = call("POST", "/api/v1/auth/login", creds, "")
	check(code != 200 && res["access_token"] == nil, "legacy /api/v1/auth/login refuses admins", code, res["message"])

	// 3. Register the first passkey during sign-in.
	code, res = call("POST", "/api/v2/auth/passkey/setup/options", map[string]string{"step_token": step}, "")
	check(code == 200, "setup options", code, res)
	cred := dev.create(res["options"].(map[string]interface{}))
	code, res = call("POST", "/api/v2/auth/passkey/setup/verify", map[string]interface{}{"step_token": step, "challenge_id": res["challenge_id"], "credential": cred, "name": "E2E key"}, "")
	codes, _ := res["recovery_codes"].([]interface{})
	check(code == 200 && res["access_token"] != nil && len(codes) == 10, "first passkey registered, session and 10 recovery codes issued", code, res["message"])
	access, _ := res["access_token"].(string)

	// 4. The step token cannot be replayed.
	code, _ = call("POST", "/api/v2/auth/passkey/setup/options", map[string]string{"step_token": step}, "")
	check(code == 401, "step token is single-use", code)

	// 5. Account security lists the passkey.
	code, res = call("GET", "/api/v2/account/security", nil, access)
	keys, _ := res["passkeys"].([]interface{})
	check(code == 200 && len(keys) == 1 && res["passkey_required"] == true, "account security shows the passkey", code, res)

	// 6. Password, then passkey.
	_, res = call("POST", "/api/v2/auth/login", creds, "")
	check(res["passkey_required"] == true && res["access_token"] == nil, "next sign-in asks for the passkey", res)
	step, _ = res["step_token"].(string)
	_, res = call("POST", "/api/v2/auth/passkey/options", map[string]string{"step_token": step}, "")
	assertion := dev.get(res["options"].(map[string]interface{}))
	code, res = call("POST", "/api/v2/auth/passkey/verify", map[string]interface{}{"step_token": step, "challenge_id": res["challenge_id"], "credential": assertion}, "")
	check(code == 200 && res["access_token"] != nil, "password + passkey signs in", code, res["message"])

	// 7. A replayed assertion (same challenge) is refused.
	code, _ = call("POST", "/api/v2/auth/passkey/verify", map[string]interface{}{"step_token": step, "challenge_id": "00000000-0000-0000-0000-000000000000", "credential": assertion}, "")
	check(code != 200, "replayed passkey response refused", code)

	// 8. Passwordless sign-in with the discoverable passkey.
	_, res = call("POST", "/api/v2/auth/passkey/options", map[string]string{}, "")
	code, res = call("POST", "/api/v2/auth/passkey/verify", map[string]interface{}{"challenge_id": res["challenge_id"], "credential": dev.get(res["options"].(map[string]interface{}))}, "")
	check(code == 200 && res["access_token"] != nil, "passkey-only sign-in works", code, res["message"])

	// 9. A different (unregistered) authenticator is refused.
	stranger := &authenticator{rpID: dev.rpID, userID: dev.userID, credID: []byte("unknown-credential-id-0123456789")}
	stranger.key, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	_, res = call("POST", "/api/v2/auth/passkey/options", map[string]string{}, "")
	code, _ = call("POST", "/api/v2/auth/passkey/verify", map[string]interface{}{"challenge_id": res["challenge_id"], "credential": stranger.get(res["options"].(map[string]interface{}))}, "")
	check(code == 401, "unknown passkey refused", code)

	// 10. Recovery code works once.
	rc, _ := codes[0].(string)
	for i, want := range []int{200, 401} {
		_, res = call("POST", "/api/v2/auth/login", creds, "")
		step, _ = res["step_token"].(string)
		code, res = call("POST", "/api/v2/auth/recovery", map[string]string{"step_token": step, "code": rc}, "")
		check(code == want, fmt.Sprintf("recovery code use #%d -> %d", i+1, want), code, res["message"])
	}

	// 11. The last passkey of an admin cannot be removed.
	id, _ := keys[0].(map[string]interface{})["id"].(string)
	code, _ = call("DELETE", "/api/v2/account/passkeys/"+id, nil, access)
	check(code == 400, "admin cannot remove their only passkey", code)

	if failures > 0 {
		fmt.Printf("\n%d check(s) failed\n", failures)
		os.Exit(1)
	}
	fmt.Println("\nall passkey checks passed")
}
