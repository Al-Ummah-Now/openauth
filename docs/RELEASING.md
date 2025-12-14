# Release Process

This document describes the automated release process for `@al-ummah-now/openauth`.

## Overview

The release workflow is fully automated via GitHub Actions. Releases are triggered automatically when code is merged to `master`, or manually via workflow dispatch.

## Release Types

### 1. Pre-releases (Pull Requests)

When a PR is opened or updated:

| Step | Action                                                          |
| ---- | --------------------------------------------------------------- |
| 1    | Wait for `test` and `format` checks to pass                     |
| 2    | Publish to GitHub Packages with version `X.Y.Z-pr.{PR#}.{run#}` |
| 3    | Create git tag `vX.Y.Z-pr.{PR#}.{run#}`                         |
| 4    | Create GitHub Release (marked as pre-release) with PR commits   |
| 5    | Comment on PR with installation instructions                    |

**Example:** PR #7 run #42 would produce:

- npm version: `1.0.8-pr.7.42`
- npm tag: `@pr`
- git tag: `v1.0.8-pr.7.42`
- GitHub Release: Pre-release with PR commits

### 2. Stable Releases (Push to master)

When code is pushed to `master`:

| Step | Action                                               |
| ---- | ---------------------------------------------------- |
| 1    | Wait for `test` and `format` workflows to complete   |
| 2    | Auto-bump patch version (e.g., `1.0.7` → `1.0.8`)    |
| 3    | Update `CHANGELOG.md` from commit messages           |
| 4    | Commit version and changelog updates                 |
| 5    | Publish to GitHub Packages with `@latest` tag        |
| 6    | Create git tag `vX.Y.Z`                              |
| 7    | Create GitHub Release with categorized release notes |

### 3. Manual Releases (Workflow Dispatch)

Trigger manually from GitHub Actions with version bump type:

- **patch**: `1.0.7` → `1.0.8`
- **minor**: `1.0.7` → `1.1.0`
- **major**: `1.0.7` → `2.0.0`

## Automatic CHANGELOG Generation

The workflow automatically updates `CHANGELOG.md` on stable releases:

1. Parses commits since the last tag
2. Categorizes by commit type:
   - `feat:` → **Added**
   - `fix:` → **Fixed**
   - `refactor:` → **Changed**
   - `docs:` → **Documentation**
3. Inserts new entry after `[Unreleased]` section
4. Updates version links at bottom of file

### Commit Message Format

Use conventional commit format for proper categorization:

```
feat: add new feature description
fix: resolve issue with X
refactor: improve performance of Y
docs: update API documentation
chore: update dependencies
```

## GitHub Release Notes

Release notes are auto-generated with categories:

```markdown
## What's Changed in v1.0.8

### Features

- feat: add new RBAC security features (abc123)

### Bug Fixes

- fix: resolve cache invalidation issue (def456)

### Documentation

- docs: update enterprise features guide (ghi789)

---

**Full Changelog**: https://github.com/Al-Ummah-Now/openauth/compare/v1.0.7...v1.0.8
```

## Pre-release Notes

Pre-releases show PR-specific changes:

```markdown
## Pre-release v1.0.8-pr.7.42

> This is a pre-release from PR #7

### Features

- feat: add RBAC security features (abc123)

### Bug Fixes

- fix: resolve test failures (def456)
```

## Workflow File

The release workflow is defined in `.github/workflows/publish-github.yml`.

### Key Steps

```yaml
# Version determination
- PR: X.Y.(Z+1)-pr.{PR#}.{run#}
- Push: X.Y.(Z+1)
- Manual: Based on bump type

# CHANGELOG update (stable only)
- Parse commits since last tag
- Generate categorized entries
- Update CHANGELOG.md

# Git operations
- Create annotated tag
- Push tag to origin

# GitHub Release
- Create release with notes
- Mark as pre-release for PRs
```

## Installation

### Stable Release

```bash
npm install @al-ummah-now/openauth
# or
npm install @al-ummah-now/openauth@latest
```

### Pre-release (Testing)

```bash
npm install @al-ummah-now/openauth@1.0.8-pr.7.42
# or get latest pre-release
npm install @al-ummah-now/openauth@pr
```

## Viewing Releases

- **GitHub Releases**: https://github.com/Al-Ummah-Now/openauth/releases
- **npm Packages**: https://github.com/Al-Ummah-Now/openauth/packages

## Troubleshooting

### Release Failed

1. Check GitHub Actions logs for errors
2. Verify `test` and `format` workflows passed
3. Check for version conflicts (tag already exists)

### CHANGELOG Not Updated

The CHANGELOG is only updated for stable releases (push to master), not pre-releases.

### Pre-release Tag Missing

Pre-release tags are created for every PR build. Check:

1. PR triggers the workflow (changes in `packages/openauth/**`)
2. `test` and `format` checks passed
3. GitHub Actions has permissions to create tags

## Manual Intervention

If automatic release fails, you can manually:

```bash
# Update version
cd packages/openauth
npm version patch  # or minor/major

# Update CHANGELOG.md manually

# Commit and tag
git add .
git commit -m "chore: release v1.0.8"
git tag v1.0.8
git push && git push --tags

# Publish
npm publish --tag latest
```

## Security

- Only the `github-actions[bot]` account can create releases
- Tags are protected and cannot be deleted
- Pre-release versions cannot overwrite stable versions
