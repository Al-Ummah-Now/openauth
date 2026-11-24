# Python

Sign in with an OpenAuth server using [Authlib](https://authlib.org) and [PyJWT](https://pyjwt.readthedocs.io). No SDK: [`auth.py`](auth.py) is the whole example. Copy it and change it.

```python
from auth import Auth, InvalidToken

auth = Auth("https://auth.example.com", "my-app", "https://app.example.com/callback")

# /login
url, kept = auth.start()
session["sign_in"] = kept          # then redirect to url

# /callback
tokens = auth.finish(request.url, session.pop("sign_in"))

# an API request
user = auth.verify(bearer_token)   # raises InvalidToken: answer 401
```

A server's own token, to call another server:

```python
auth = Auth("https://auth.example.com", "my-server", client_secret=SECRET)
token = auth.own_token("users:read")
```

What to keep in mind:

- `refresh` answers a new refresh token every time. Store it before you use the access token.
- A `PyJWKClientConnectionError` from `verify` means the keys couldn't be read, not that the token is bad. Answer 503.
- `verify` checks the signature, issuer, audience, expiry and kind of token. Don't drop one.

Test it, against an issuer that starts and stops with the tests:

```sh
bun examples/test/run.ts python
```
