"""Against a real issuer: examples/test/run.ts starts one and sets ISSUER."""

import os
import time
import unittest
from urllib.parse import parse_qs, urlparse, urlunparse

os.environ["AUTHLIB_INSECURE_TRANSPORT"] = "1"  # the test issuer is http

import jwt  # noqa: E402
import requests  # noqa: E402
from authlib.integrations.base_client import OAuthError  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from auth import Auth, InvalidToken  # noqa: E402

ISSUER = os.environ["ISSUER"]
CALLBACK = "http://localhost:9999/callback"


def web():
    return Auth(ISSUER, "example-web", CALLBACK)


def browser(url):
    """Follow the redirects a browser would, up to the app's callback."""
    cookies = {}
    for _ in range(10):
        if url.startswith(CALLBACK):
            return url
        res = requests.get(url, cookies=cookies, allow_redirects=False, timeout=10)
        cookies.update(res.cookies.get_dict())
        assert res.status_code == 302, f"{res.status_code} {res.text[:200]}"
        url = requests.compat.urljoin(url, res.headers["location"])
    raise AssertionError("too many redirects")


def sign_in(app):
    url, kept = app.start()
    return app.finish(browser(url), kept)


class SignIn(unittest.TestCase):
    def test_tokens_name_the_user(self):
        app = web()
        tokens = sign_in(app)
        user = app.verify(tokens["access_token"])
        self.assertEqual(user.id, "usr_1")
        self.assertEqual(user.properties["email"], "person@example.com")

    def test_sends_pkce_s256(self):
        url, kept = web().start()
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertNotIn(kept["verifier"], url)

    def test_another_sign_ins_state_is_refused(self):
        app = web()
        url, _ = app.start()
        _, other = app.start()
        with self.assertRaises(Exception) as caught:
            app.finish(browser(url), other)
        self.assertIn("state", str(caught.exception).lower())

    def test_a_stolen_code_is_useless_without_the_verifier(self):
        app = web()
        url, kept = app.start()
        callback = browser(url)
        with self.assertRaises(OAuthError):
            app.finish(callback, {**kept, "verifier": "x" * 64})

    def test_a_code_works_once(self):
        app = web()
        url, kept = app.start()
        callback = browser(url)
        app.finish(callback, kept)
        with self.assertRaises(OAuthError):
            app.finish(callback, kept)

    def test_refresh_answers_a_new_refresh_token(self):
        app = web()
        tokens = sign_in(app)
        new = app.refresh(tokens["refresh_token"])
        self.assertNotEqual(new["refresh_token"], tokens["refresh_token"])
        self.assertEqual(app.verify(new["access_token"]).id, "usr_1")

    def test_a_bad_refresh_token_is_refused(self):
        with self.assertRaises(OAuthError):
            web().refresh("user:nobody:nothing")


class Verify(unittest.TestCase):
    def setUp(self):
        self.app = web()
        self.token = sign_in(self.app)["access_token"]

    def refused(self, token, app=None):
        with self.assertRaises(InvalidToken):
            (app or self.app).verify(token)

    def test_refuses_what_is_not_a_token(self):
        for token in ["", "nonsense", "a.b.c", self.token[:-4] + "AAAA"]:
            self.refused(token)

    def test_refuses_another_apps_token(self):
        self.refused(self.token, Auth(ISSUER, "another-app", CALLBACK))

    def test_refuses_another_issuers_token(self):
        other = web()
        other.issuer = "https://evil.example.com"
        self.refused(self.token, other)

    def forged(self, key, algorithm, **changes):
        claims = jwt.decode(self.token, options={"verify_signature": False})
        kid = jwt.get_unverified_header(self.token)["kid"]
        return jwt.encode(
            {**claims, **changes}, key, algorithm=algorithm, headers={"kid": kid}
        )

    def test_refuses_a_signature_by_another_key(self):
        key = ec.generate_private_key(ec.SECP256R1())
        self.refused(self.forged(key, "ES256"))

    def test_refuses_other_algorithms(self):
        self.refused(self.forged("x" * 64, "HS256"))
        self.refused(self.forged(None, "none"))

    def test_refuses_an_expired_token(self):
        key = ec.generate_private_key(ec.SECP256R1())
        self.refused(self.forged(key, "ES256", exp=int(time.time()) - 10))

    def test_refuses_a_servers_own_token(self):
        server = Auth(ISSUER, "example-server", client_secret="example-secret")
        self.refused(server.own_token("users:read"), server)

    def test_a_key_outage_is_not_a_bad_token(self):
        app = web()
        # A port nothing listens on
        app._keys = jwt.PyJWKClient("http://127.0.0.1:9/keys", timeout=2)
        with self.assertRaises(jwt.PyJWKClientConnectionError):
            app.verify(self.token)

    def test_follows_a_key_rotation(self):
        self.app.verify(self.token)  # the keys are cached now
        self.app._keys.cooldown_duration = 0  # as if 30 seconds had passed
        rotated = urlunparse(urlparse(ISSUER)._replace(path="/test/rotate"))
        requests.post(rotated, timeout=10).raise_for_status()
        new = sign_in(self.app)["access_token"]
        self.assertNotEqual(
            jwt.get_unverified_header(new)["kid"],
            jwt.get_unverified_header(self.token)["kid"],
        )
        self.assertEqual(self.app.verify(new).id, "usr_1")
        self.assertEqual(self.app.verify(self.token).id, "usr_1")


class OwnToken(unittest.TestCase):
    def test_is_kept_until_it_is_about_to_expire(self):
        server = Auth(ISSUER, "example-server", client_secret="example-secret")
        first = server.own_token("users:read")
        self.assertEqual(server.own_token("users:read"), first)
        server._own_token = (("users:read",), time.time() + 5, first)
        self.assertNotEqual(server.own_token("users:read"), first)

    def test_wrong_secret_and_unknown_scope_are_refused(self):
        wrong = Auth(ISSUER, "example-server", client_secret="wrong")
        with self.assertRaises(OAuthError) as caught:
            wrong.own_token()
        self.assertEqual(caught.exception.error, "invalid_client")
        server = Auth(ISSUER, "example-server", client_secret="example-secret")
        with self.assertRaises(OAuthError) as caught:
            server.own_token("everything")
        self.assertEqual(caught.exception.error, "invalid_scope")


if __name__ == "__main__":
    unittest.main()
