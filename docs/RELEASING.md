# Release Process

How `@al-ummah-now/openauth` is released. Everything is done by
`.github/workflows/publish-github.yml`; nobody bumps a version or edits a changelog by hand.

## The short version

- **Merge a PR to `master`** → once `test` **and** `format` have both passed on that commit, and only
  if something that ends up in the package changed, the workflow publishes the next version to GitHub
  Packages with the `latest` dist-tag, the tag `vX.Y.Z` and a GitHub Release.
- **The size of the step comes from the commits** since the last release: `feat!:` (any type with `!`)
  or a `BREAKING CHANGE:` footer → major, `feat:` → minor, anything else → patch.
- **Open or update a PR** that changes a published file → a pre-release `X.Y.Z-pr.{PR#}.{run#}` with
  the `pr` dist-tag, its tag, a pre-release GitHub Release and a PR comment with the install command.
- **The released version lives in git tags, never in a commit on `master`.** The workflow never
  pushes to `master` (the branch ruleset requires a pull request).

## How a run decides

`scripts/release/plan.mjs` decides everything from git tags and GitHub releases, and
`scripts/release/plan.test.ts` tests it on scratch repositories (`bun test ./scripts/release`).

1. **Gate.** Both `test` and `format` must have succeeded on the exact commit. Each of them triggers a
   run; the first one finds the other unfinished and stops. A manual run (`workflow_dispatch`) must be
   on `master` and passes the same gate.
2. **Already released?** A commit whose tag has a GitHub release, or that is part of a newer release,
   publishes nothing.
3. **Half done?** A commit that has a stable tag but no GitHub release, with no newer release, is
   finished under the same version: the tag stays, `npm publish` is skipped if the version is on the registry, and the release
   is created.
4. **Anything to publish?** Compared with the last release: `src/`, `bin/*.ts`, `script/`,
   `tsconfig.json`, or the consumer-visible part of `package.github.json` (not its version, scripts or
   dev dependencies). Tests, docs, examples and lockfile changes publish nothing; they go out with the
   next release. A manual run publishes anyway.
5. **Version** = the step above on top of the newest of the stable tags and `version` in
   `packages/openauth/package.github.json` (a floor).

Then: checkout of that commit, build, pack, tag, publish the packed file, download it back from the
registry and compare it byte for byte, attest its build provenance (stable releases), GitHub Release
with the notes, the package file and `SHA256SUMS`. Releases run one at a time; a PR's pre-releases queue behind each other.

## `package.json` vs `package.github.json`

`packages/openauth/package.json` still says `"name": "@openauthjs/openauth"`, `"version": "0.4.3"`.
That is the upstream fork's metadata, **not** the published package, and the publish workflow never
reads its version:

- The published name and version come from `package.github.json` plus the computed version.
- The `name` is still load-bearing inside the repo: the workflow builds with
  `bun run --filter="@openauthjs/openauth" build`, and the examples depend on `@openauthjs/openauth`
  as a workspace package. Do not rename it in passing.
- Its `version` is never bumped. Upstream's own release flow (Changesets) was removed from the fork.

To find the current release, look at the tags or the
[releases page](https://github.com/Al-Ummah-Now/openauth/releases), not at any `package.json`.

## CHANGELOG.md

`packages/openauth/CHANGELOG.md` stops at 1.0.32. Later releases are recorded only as tags and
GitHub Releases.

## Commit messages

Use conventional commits. They set the version (above) and group the release notes:

```
feat: add new feature description
feat!: remove or change something consumers use
fix: resolve issue with X
security: patch Y
docs: update API documentation
chore: update dependencies
```

Commits containing `[skip ci]` are left out of the notes.

## Installing

```bash
npm install @al-ummah-now/openauth            # latest stable
npm install @al-ummah-now/openauth@pr         # latest PR pre-release
npm install @al-ummah-now/openauth@1.0.48-pr.7.42
```

The registry is GitHub Packages: consumers need `@al-ummah-now:registry=https://npm.pkg.github.com`
in their `.npmrc` and a token with `read:packages`.

## Verifying or installing without a registry token

GitHub Packages asks for a token even for public packages. Each GitHub Release also carries the
published file itself:

```bash
gh release download v1.1.0 -R Al-Ummah-Now/openauth -p '*.tgz'
gh attestation verify al-ummah-now-openauth-1.1.0.tgz -R Al-Ummah-Now/openauth
```

The npm integrity in the release notes is the value lockfiles need. Pre-releases have the file and
the hashes, but no attestation: an attestation means the package was built from `master`.

## Troubleshooting

- **No release after a merge:** look at the `gate` job (did both checks pass on that commit?) and at
  the `Plan` step, which says why nothing was published.
- **A step failed half-way:** re-run the failed job, or run the workflow manually on `master` while
  that commit is still its head. It finishes the same version. If `master` has moved on, the next
  release takes over the notes and the unfinished number stays unused.
- **"The registry's X.Y.Z is not what this commit builds":** a run finished a release that another run
  had published, and the bytes differ (for example a different Node). Merge the next change; its
  release takes over the notes.
- **"Tag vX.Y.Z is on ..., not ...":** the version belongs to another commit; nothing was published.
- **Force a minor or major:** run the workflow manually on `master` with `bump`. One release per
  commit still holds, so this needs a commit that is not released yet (a merge that published nothing
  will do).
- **Never** commit a version bump or a hand-edited release to `master`, and never move a tag.
