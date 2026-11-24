# Go

Sign in with an OpenAuth server using [`golang.org/x/oauth2`](https://pkg.go.dev/golang.org/x/oauth2), [`golang-jwt`](https://github.com/golang-jwt/jwt) and [`keyfunc`](https://github.com/MicahParks/keyfunc). No SDK: [`auth.go`](auth.go) is the whole example. Copy it and change it.

```go
a, err := auth.New(ctx, "https://auth.example.com", "my-app", "", "https://app.example.com/callback")

// /login
url, pending := a.Start() // keep pending in the user's session, redirect to url

// /callback
tokens, err := a.Finish(ctx, r.URL.Query(), pending)

// an API request
user, err := a.Verify(ctx, bearerToken) // errors.Is(err, auth.ErrInvalidToken): answer 401
```

A server's own token, to call another server:

```go
a, err := auth.New(ctx, "https://auth.example.com", "my-server", secret, "")
client := oauth2.NewClient(ctx, a.OwnTokens(ctx, "users:read"))
```

What to keep in mind:

- `Refresh` answers a new refresh token every time. Store it before you use the access token.
- `Verify` checks the signature, issuer, audience, expiry and kind of token. Don't drop one.

Test it, against an issuer that starts and stops with the tests:

```sh
bun examples/test/run.ts go
```
