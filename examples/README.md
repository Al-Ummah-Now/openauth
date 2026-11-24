# Examples

There are two sets of examples here, issuers and clients. Issuers are examples of setting up an OpenAuth server. The clients are examples of using OpenAuth in a client application and work with any of the issuer servers.

The fastest way to play around is to use the bun issuer. You can bring it up with:

```shell
$ bun run --hot ./issuer/bun/issuer.ts
```

You might have to install some workspace packages first, run this in the root:

```shell
$ bun install
$ cd packages/openauth
$ bun run build
```

This will bring it up on port 3000. Then try one of the clients - for example the astro one.

```
$ cd client/astro
$ bun dev
```

Now visit `http://localhost:4321` (the astro app) and experience the auth flow.

Or head over to `http://localhost:3000/password/authorize` to try the password flow directly.

## Python and Go

[`client/python`](client/python) and [`client/go`](client/go) use standard OAuth libraries instead of an SDK. CI runs their tests against an issuer it starts; run them yourself with:

```shell
$ bun examples/test/run.ts
```
