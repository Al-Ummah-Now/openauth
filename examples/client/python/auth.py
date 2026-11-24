"""Sign people in with an OpenAuth server, using standard Python libraries.

Authlib talks OAuth; PyJWT verifies access tokens. Nothing here is specific to
OpenAuth except the claims `verify` checks.
"""

import secrets
import threading
import time
from dataclasses import dataclass

import jwt
from authlib.integrations.requests_client import OAuth2Session

TIMEOUT = 10
# Refresh a little early, so a token doesn't expire on its way to an API
EARLY = 30


class InvalidToken(Exception):
    """The access token can't be trusted."""


@dataclass(frozen=True)
class User:
    id: str
    properties: dict


class Auth:
    """One per app. Holds no user's tokens: keep those in the user's session."""

    def __init__(self, issuer, client_id, redirect_uri=None, client_secret=None):
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        # An unknown key id fetches the keys again, but at most every 30 seconds, so
        # bad tokens can't cause a request each. The server publishes a new key
        # before it signs with it, so a real token isn't refused meanwhile.
        self._keys = jwt.PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json", lifespan=300, timeout=TIMEOUT
        )
        self._own_token = None
        self._lock = threading.Lock()

    def _session(self, **kwargs):
        return OAuth2Session(
            self.client_id,
            self.client_secret,
            token_endpoint_auth_method=(
                "client_secret_basic" if self.client_secret else "none"
            ),
            code_challenge_method="S256",
            **kwargs,
        )

    def start(self):
        """Where to send the browser, and what to keep in the user's session."""
        verifier = secrets.token_urlsafe(48)
        with self._session(redirect_uri=self.redirect_uri) as session:
            url, state = session.create_authorization_url(
                f"{self.issuer}/authorize", code_verifier=verifier
            )
        return url, {"state": state, "verifier": verifier}

    def finish(self, callback_url, kept):
        """The tokens, from the URL the browser came back to.

        Raises if the state isn't the one `start` made: the answer is to another
        sign-in, perhaps one an attacker started.
        """
        with self._session(
            redirect_uri=self.redirect_uri, state=kept["state"]
        ) as session:
            return session.fetch_token(
                f"{self.issuer}/token",
                authorization_response=callback_url,
                code_verifier=kept["verifier"],
                timeout=TIMEOUT,
            )

    def refresh(self, refresh_token):
        """New tokens. The refresh token changes every time: store the new one."""
        with self._session() as session:
            return session.refresh_token(
                f"{self.issuer}/token", refresh_token=refresh_token, timeout=TIMEOUT
            )

    def verify(self, access_token):
        """The user an access token belongs to. No call to the server, except for
        its keys now and then."""
        try:
            key = self._keys.get_signing_key_from_jwt(access_token)
            claims = jwt.decode(
                access_token,
                key,
                algorithms=["ES256"],
                issuer=self.issuer,
                audience=self.client_id,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWKClientConnectionError:
            # Not the token's fault: let the caller answer 503, not 401
            raise
        except jwt.PyJWTError as err:
            raise InvalidToken(str(err)) from err
        properties = claims.get("properties")
        if (
            claims.get("mode") != "access"
            or claims.get("type") != "user"
            or not isinstance(properties, dict)
            or not isinstance(properties.get("id"), str)
        ):
            raise InvalidToken("not a user access token")
        return User(properties["id"], properties)

    def own_token(self, *scopes):
        """This server's own token, for calling another one. Needs a client secret."""
        with self._lock:
            kept = self._own_token
            if kept and kept[0] == scopes and kept[1] - EARLY > time.time():
                return kept[2]
            with self._session() as session:
                token = session.fetch_token(
                    f"{self.issuer}/token",
                    grant_type="client_credentials",
                    scope=" ".join(scopes) or None,
                    timeout=TIMEOUT,
                )
            self._own_token = (
                scopes,
                time.time() + token["expires_in"],
                token["access_token"],
            )
            return token["access_token"]
