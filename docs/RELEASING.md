# Release Process

How `@al-ummah-now/openauth` is released. Everything is done by
`.github/workflows/publish-github.yml`; nobody bumps a version or edits a changelog by hand.

## The short version

- **Merge a PR to `master`** → once `test` and `format` pass on that commit, the workflow publishes
  the next patch version (`1.0.47` → `1.0.48`) to GitHub Packages with the `latest` dist-tag, pushes
  the tag `v1.0.48` and creates a GitHub Release.
- **Open or update a PR** that touches `packages/openauth/**` → a pre-release
  `1.0.48-pr.{PR#}.{run#}` with the `pr` dist-tag, its tag, a pre-release GitHub Release and a PR
  comment with the install command.
- **The released version lives in git tags, never in a commit on `master`.** Since openauth#27 the
  workflow never pushes to `master` (the branch ruleset requires a pull request), so it does not
  commit a version bump and does not update `CHANGELOG.md`.

## Where the version comes from

The `Determine version` step works it out on every run:

1. **Base** = the newer of
   - the latest stable tag (`vX.Y.Z` with no `-suffix`), and
   - `version` in `packages/openauth/package.github.json` (a floor; only matters if it is ever set
     above the tags).
2. **Next version** from the base:

   | Trigger                                                    | Version                                 | npm dist-tag |
   | ---------------------------------------------------------- | --------------------------------------- | ------------ |
   | `test` / `format` completed on a push to `master`          | `X.Y.(Z+1)`                             | `latest`     |
   | `pull_request` (same repo, `packages/openauth/**` changed) | `X.Y.(Z+1)-pr.{PR#}.{run#}`             | `pr`         |
   | `workflow_dispatch` with `bump` = patch / minor / major    | `X.Y.(Z+1)` / `X.(Y+1).0` / `(X+1).0.0` | `latest`     |

3. **One release per commit.** Both `test` and `format` trigger a run for the same `master` commit
   (serialised by the per-commit `concurrency` group). A non-PR run whose `HEAD` already carries a
   stable tag skips everything, so the second trigger, a re-run or a dispatch on an already
   released commit publishes nothing.

## What a run does

1. PRs only: wait for the `test` and `format` checks on the PR head.
2. `bun install`, then build the workspace package `@openauthjs/openauth`.
3. Determine the version (above).
4. Swap `package.json` for `package.github.json` and write the computed version into it. **This is
   what gets published**: name `@al-ummah-now/openauth`, the GitHub Packages registry, the computed
   version.
5. Generate release notes from the commits since the previous stable tag (PR: the PR's commits),
   grouped into Features (`feat`), Bug Fixes (`fix`), Documentation (`docs`) and Other Changes.
6. Create and push the annotated tag `vVERSION`. An existing tag fails the run instead of
   publishing over it.
7. `npm publish --tag latest|pr` to GitHub Packages.
8. Restore the original `package.json` (always).
9. Create the GitHub Release with the notes (a pre-release for PRs).
10. PRs only: comment the install command.

The job only runs for pushes and PRs from this repository (a fork PR, even from a branch called
`master`, never publishes).

## `package.json` vs `package.github.json`

`packages/openauth/package.json` still says `"name": "@openauthjs/openauth"`, `"version": "0.4.3"`.
That is the upstream fork's metadata, **not** the published package, and the publish workflow never
reads its version:

- The published name and version come from `package.github.json` plus the computed version (step 4).
- The `name` is still load-bearing inside the repo: the workflow builds with
  `bun run --filter="@openauthjs/openauth" build`, the examples depend on `@openauthjs/openauth`
  as a workspace package, and `.changeset/config.json` names it. Do not rename it in passing.
- The `version` in `package.json` is only bumped by the upstream changesets workflow (below).

To find the current release, look at the tags or the
[releases page](https://github.com/Al-Ummah-Now/openauth/releases), not at any `package.json`.

## The upstream changesets workflow (`release.yml`)

`.github/workflows/release.yml` is inherited from upstream openauth. On every push to `master` it runs
`changesets/action`, which keeps a "Version Packages" PR open that bumps the upstream
`@openauthjs/openauth` version in `package.json` (`0.4.3` → `0.4.4`) and writes
`packages/openauth/CHANGELOG.md` from `.changeset/*.md`. It does not publish
`@al-ummah-now/openauth`. **Do not merge that PR**: it would only change upstream metadata, and with
no changesets left the action switches to `changeset publish` (the npm registry, upstream name).

## CHANGELOG.md

`packages/openauth/CHANGELOG.md` stops at 1.0.32. Later releases are recorded only as tags and
GitHub Releases. Changesets in `.changeset/` are not needed for a release.

## Commit messages

Use conventional commits; the release notes are grouped by prefix:

```
feat: add new feature description
fix: resolve issue with X
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

## Troubleshooting

- **No release after a merge:** the publish job runs only when `test` or `format` _succeeds_ for a
  push to `master`. Check those runs first, then the `Publish to GitHub Packages` run.
- **"Tag vX.Y.Z already exists":** the version is taken; the run refuses to publish over it. The next
  merge publishes the following patch.
- **Tag pushed but `npm publish` failed:** that commit now counts as released (its tag exists), so a
  re-run skips. Delete the tag `vX.Y.Z` (no package was published under it) and re-run the failed
  run, or let the next merge publish the next patch.
- **Need a minor or major:** run the workflow manually (`workflow_dispatch`) on `master` with `bump`
  = minor or major. It skips if `master`'s `HEAD` is already released, so this needs an untagged
  commit (for example, dispatch while the merge's `test`/`format` runs are still going).
- **Never** commit a version bump or a hand-edited release to `master`, and never move a tag.
