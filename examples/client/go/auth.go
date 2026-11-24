// Package auth signs people in with an OpenAuth server, using standard Go
// libraries: golang.org/x/oauth2 for OAuth, golang-jwt and keyfunc to verify
// access tokens. Nothing here is specific to OpenAuth except the claims Verify
// checks.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
	"golang.org/x/time/rate"
)

// ErrInvalidToken says the access token can't be trusted.
var ErrInvalidToken = errors.New("invalid token")

// ErrState says the callback answers another sign-in, perhaps one an attacker
// started.
var ErrState = errors.New("state mismatch")

// Auth is safe for concurrent use. Make one per app. It holds no user's tokens:
// keep those in the user's session.
type Auth struct {
	issuer string
	config oauth2.Config
	keys   keyfunc.Keyfunc
	http   *http.Client
}

// User is who an access token belongs to.
type User struct {
	ID         string
	Properties map[string]any
}

// Pending is what to keep in the user's session between Start and Finish.
type Pending struct{ State, Verifier string }

type claims struct {
	Mode       string         `json:"mode"`
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties"`
	jwt.RegisteredClaims
}

// New makes an Auth. secret is empty for a public client. The keys are fetched
// on first use; ctx ends the background work that keeps them fresh.
func New(ctx context.Context, issuer, clientID, secret, redirectURI string) (*Auth, error) {
	issuer = strings.TrimRight(issuer, "/")
	client := &http.Client{Timeout: 10 * time.Second}
	style := oauth2.AuthStyleInParams
	if secret != "" {
		style = oauth2.AuthStyleInHeader
	}
	storage, err := jwkset.NewStorageFromHTTP(issuer+"/.well-known/jwks.json", jwkset.HTTPClientStorageOptions{
		Client:                    client,
		Ctx:                       ctx,
		NoErrorReturnFirstHTTPReq: true,
		RefreshInterval:           5 * time.Minute,
	})
	if err != nil {
		return nil, err
	}
	// A token signed by a key we don't have: the server may have rotated, so look
	// again, but not for every bad token
	set, err := jwkset.NewHTTPClient(jwkset.HTTPClientOptions{
		HTTPURLs:          map[string]jwkset.Storage{issuer: storage},
		RefreshUnknownKID: rate.NewLimiter(rate.Every(30*time.Second), 1),
	})
	if err != nil {
		return nil, err
	}
	keys, err := keyfunc.New(keyfunc.Options{Ctx: ctx, Storage: set})
	if err != nil {
		return nil, err
	}
	return &Auth{
		issuer: issuer,
		config: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: secret,
			RedirectURL:  redirectURI,
			Endpoint:     oauth2.Endpoint{AuthURL: issuer + "/authorize", TokenURL: issuer + "/token", AuthStyle: style},
		},
		keys: keys,
		http: client,
	}, nil
}

func (a *Auth) withClient(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, a.http)
}

// Start answers where to send the browser, and what to keep until it returns.
func (a *Auth) Start() (string, Pending) {
	random := make([]byte, 32)
	rand.Read(random) // never fails
	p := Pending{State: base64.RawURLEncoding.EncodeToString(random), Verifier: oauth2.GenerateVerifier()}
	return a.config.AuthCodeURL(p.State, oauth2.S256ChallengeOption(p.Verifier)), p
}

// Finish answers the tokens, from the query the browser came back with.
func (a *Auth) Finish(ctx context.Context, query url.Values, kept Pending) (*oauth2.Token, error) {
	if kept.State == "" || subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(kept.State)) != 1 {
		return nil, ErrState
	}
	if code := query.Get("error"); code != "" {
		return nil, fmt.Errorf("sign-in refused: %s", code)
	}
	return a.config.Exchange(a.withClient(ctx), query.Get("code"), oauth2.VerifierOption(kept.Verifier))
}

// Refresh answers new tokens. The refresh token changes every time: store the
// new one.
func (a *Auth) Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error) {
	return a.config.TokenSource(a.withClient(ctx), &oauth2.Token{RefreshToken: refreshToken}).Token()
}

// Verify answers the user an access token belongs to. It doesn't call the
// server, except for its keys now and then.
func (a *Auth) Verify(ctx context.Context, accessToken string) (*User, error) {
	var c claims
	_, err := jwt.ParseWithClaims(accessToken, &c, a.keys.KeyfuncCtx(ctx),
		jwt.WithValidMethods([]string{"ES256"}),
		jwt.WithIssuer(a.issuer),
		jwt.WithAudience(a.config.ClientID),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	id, _ := c.Properties["id"].(string)
	if c.Mode != "access" || c.Type != "user" || id == "" {
		return nil, fmt.Errorf("%w: not a user access token", ErrInvalidToken)
	}
	return &User{ID: id, Properties: c.Properties}, nil
}

// OwnTokens answers this server's own token, for calling another one. The source
// keeps the token until it is about to expire: make one and share it.
func (a *Auth) OwnTokens(ctx context.Context, scopes ...string) oauth2.TokenSource {
	config := clientcredentials.Config{
		ClientID:     a.config.ClientID,
		ClientSecret: a.config.ClientSecret,
		TokenURL:     a.config.Endpoint.TokenURL,
		AuthStyle:    oauth2.AuthStyleInHeader,
		Scopes:       scopes,
	}
	return config.TokenSource(a.withClient(ctx))
}
