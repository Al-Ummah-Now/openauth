package auth

// Against a real issuer: examples/test/run.ts starts one and sets ISSUER.

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
)

const callback = "http://localhost:9999/callback"

var issuer = os.Getenv("ISSUER")

func TestMain(m *testing.M) {
	if issuer == "" {
		panic("ISSUER is not set: run examples/test/run.ts")
	}
	os.Exit(m.Run())
}

func app(t *testing.T, clientID, secret string) *Auth {
	t.Helper()
	a, err := New(t.Context(), issuer, clientID, secret, callback)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// browser follows the redirects a browser would, up to the app's callback.
func browser(t *testing.T, start string) url.Values {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	var found url.Values
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if strings.HasPrefix(req.URL.String(), callback) {
			found = req.URL.Query()
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := client.Get(start)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if found == nil {
		t.Fatalf("never came back to the app: %s", res.Status)
	}
	return found
}

func signIn(t *testing.T, a *Auth) *oauth2.Token {
	t.Helper()
	start, kept := a.Start()
	tokens, err := a.Finish(t.Context(), browser(t, start), kept)
	if err != nil {
		t.Fatal(err)
	}
	return tokens
}

func TestTokensNameTheUser(t *testing.T) {
	a := app(t, "example-web", "")
	user, err := a.Verify(t.Context(), signIn(t, a).AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if user.ID != "usr_1" || user.Properties["email"] != "person@example.com" {
		t.Fatalf("got %+v", user)
	}
}

func TestSendsPKCES256(t *testing.T) {
	start, kept := app(t, "example-web", "").Start()
	u, _ := url.Parse(start)
	if u.Query().Get("code_challenge_method") != "S256" || strings.Contains(start, kept.Verifier) {
		t.Fatal(start)
	}
}

func TestAnotherSignInsStateIsRefused(t *testing.T) {
	a := app(t, "example-web", "")
	start, kept := a.Start()
	_, other := a.Start()
	query := browser(t, start)
	for _, p := range []Pending{other, {Verifier: kept.Verifier}} {
		if _, err := a.Finish(t.Context(), query, p); !errors.Is(err, ErrState) {
			t.Fatalf("got %v", err)
		}
	}
}

func TestARefusedSignInSaysWhy(t *testing.T) {
	a := app(t, "example-web", "")
	_, kept := a.Start()
	_, err := a.Finish(t.Context(), url.Values{"state": {kept.State}, "error": {"access_denied"}}, kept)
	if err == nil || !strings.Contains(err.Error(), "access_denied") {
		t.Fatalf("got %v", err)
	}
}

func TestAStolenCodeIsUselessWithoutTheVerifier(t *testing.T) {
	a := app(t, "example-web", "")
	start, kept := a.Start()
	query := browser(t, start)
	kept.Verifier = oauth2.GenerateVerifier()
	if _, err := a.Finish(t.Context(), query, kept); err == nil {
		t.Fatal("accepted")
	}
}

func TestACodeWorksOnce(t *testing.T) {
	a := app(t, "example-web", "")
	start, kept := a.Start()
	query := browser(t, start)
	if _, err := a.Finish(t.Context(), query, kept); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Finish(t.Context(), query, kept); err == nil {
		t.Fatal("accepted twice")
	}
}

func TestRefreshAnswersANewRefreshToken(t *testing.T) {
	a := app(t, "example-web", "")
	tokens := signIn(t, a)
	next, err := a.Refresh(t.Context(), tokens.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if next.RefreshToken == tokens.RefreshToken {
		t.Fatal("the same refresh token")
	}
	if _, err := a.Verify(t.Context(), next.AccessToken); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Refresh(t.Context(), "user:nobody:nothing"); err == nil {
		t.Fatal("accepted a bad refresh token")
	}
}

func forged(t *testing.T, token string, method jwt.SigningMethod, key any, change func(jwt.MapClaims)) string {
	t.Helper()
	c := jwt.MapClaims{}
	parsed, _, err := jwt.NewParser().ParseUnverified(token, c)
	if err != nil {
		t.Fatal(err)
	}
	if change != nil {
		change(c)
	}
	out := jwt.NewWithClaims(method, c)
	out.Header["kid"] = parsed.Header["kid"]
	signed, err := out.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestVerifyRefuses(t *testing.T) {
	a := app(t, "example-web", "")
	token := signIn(t, a).AccessToken
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	evil := app(t, "example-web", "")
	evil.issuer = "https://evil.example.com"
	server := app(t, "example-server", "example-secret")
	own, err := server.OwnTokens(t.Context(), "users:read").Token()
	if err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		by    *Auth
		token string
	}{
		"nothing":              {a, ""},
		"not a token":          {a, "nonsense"},
		"three parts":          {a, "a.b.c"},
		"changed signature":    {a, token[:len(token)-4] + "AAAA"},
		"another app":          {app(t, "another-app", ""), token},
		"another issuer":       {evil, token},
		"another key":          {a, forged(t, token, jwt.SigningMethodES256, key, nil)},
		"HS256":                {a, forged(t, token, jwt.SigningMethodHS256, []byte(strings.Repeat("x", 64)), nil)},
		"none":                 {a, forged(t, token, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, nil)},
		"expired":              {a, forged(t, token, jwt.SigningMethodES256, key, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() })},
		"a server's own token": {server, own.AccessToken},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := c.by.Verify(t.Context(), c.token); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestOwnTokens(t *testing.T) {
	source := app(t, "example-server", "example-secret").OwnTokens(t.Context(), "users:read")
	first, err := source.Token()
	if err != nil {
		t.Fatal(err)
	}
	second, err := source.Token()
	if err != nil || second.AccessToken != first.AccessToken {
		t.Fatal("the token was not kept")
	}
	for name, bad := range map[string]oauth2.TokenSource{
		"invalid_client": app(t, "example-server", "wrong").OwnTokens(t.Context()),
		"invalid_scope":  app(t, "example-server", "example-secret").OwnTokens(t.Context(), "everything"),
	} {
		_, err := bad.Token()
		var refused *oauth2.RetrieveError
		if !errors.As(err, &refused) || refused.ErrorCode != name {
			t.Fatalf("%s: got %v", name, err)
		}
	}
}

func TestFollowsAKeyRotation(t *testing.T) {
	a := app(t, "example-web", "")
	before := signIn(t, a).AccessToken
	if _, err := a.Verify(t.Context(), before); err != nil {
		t.Fatal(err)
	}
	res, err := http.Post(issuer+"/test/rotate", "", nil)
	if err != nil || res.StatusCode != http.StatusNoContent {
		t.Fatal("could not rotate", err)
	}
	res.Body.Close()
	after := signIn(t, a).AccessToken
	for _, token := range []string{after, before} {
		if _, err := a.Verify(context.WithoutCancel(t.Context()), token); err != nil {
			t.Fatal(err)
		}
	}
}
