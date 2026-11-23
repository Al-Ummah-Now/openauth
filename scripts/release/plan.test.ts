import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  bumpFor,
  bumpVersion,
  isPublishedFile,
  notes,
  plan,
  publishedManifest,
} from "./plan.mjs"

const PACKAGE = "packages/openauth/package.github.json"
const SRC = "packages/openauth/src/index.ts"
let cwd: string
let n = 0

const git = (...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim()
const write = (file: string, content: string) => {
  mkdirSync(dirname(join(cwd, file)), { recursive: true })
  writeFileSync(join(cwd, file), content)
}
/** Commits a change to `file` and returns the sha. */
const commit = (message: string, file = SRC, content = `${n++}`) => {
  write(file, content)
  git("add", "-A")
  git("commit", "-qm", message)
  return git("rev-parse", "HEAD")
}
const manifest = (extra: object = {}) =>
  JSON.stringify({ name: "x", version: "1.0.32", dependencies: {}, ...extra })

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "oa-plan-"))
  git("init", "-q", "-b", "master")
  write(PACKAGE, manifest())
  commit("feat: start")
  git("tag", "v1.0.9")
  git("tag", "v1.0.9-pr.1.2")
  commit("fix: more")
  git("tag", "v1.0.62")
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

const released = ["v1.0.9", "v1.0.62"]
const release = (sha: string, releases = released) =>
  plan({ event: "release", sha, releases, cwd }) as any

describe("version", () => {
  test("patch, minor and major from the commits since the last release", () => {
    expect(release(commit("fix: a")).version).toBe("1.0.63")
    expect(release(commit("feat(client): b")).version).toBe("1.1.0")
    expect(release(commit("refactor!: c")).version).toBe("2.0.0")
  })

  test("a BREAKING CHANGE footer is a major; the words in a subject are not", () => {
    expect(
      bumpFor([{ subject: "fix: x", body: "why\n\nBREAKING CHANGE: y" }]),
    ).toBe("major")
    expect(bumpFor([{ subject: "docs: BREAKING CHANGE policy" }])).toBe("patch")
    expect(bumpFor([])).toBe("patch")
  })

  test("numbers compare as numbers and pre-release tags don't count", () => {
    expect(bumpVersion("1.9.9", "patch")).toBe("1.9.10")
    git("tag", "v1.0.100-pr.4.9")
    expect(release(commit("fix: a")).version).toBe("1.0.63")
  })

  test("the version in package.github.json is a floor", () => {
    expect(
      release(
        commit(
          "fix: a",
          PACKAGE,
          manifest({ version: "1.4.0", sideEffects: 1 }),
        ),
      ).version,
    ).toBe("1.4.1")
  })

  test("a manual run chooses the size, and publishes with nothing changed", () => {
    const sha = commit("docs: a", "README.md")
    const run = (bump: string) =>
      (plan({ event: "dispatch", sha, bump, releases: released, cwd }) as any)
        .version
    expect(run("minor")).toBe("1.1.0")
    expect(run("major")).toBe("2.0.0")
    expect(run("auto")).toBe("1.0.63")
  })

  test("a pull request gets a pre-release of the next version, with only its own commits", () => {
    const base = commit("fix: on master")
    git("checkout", "-qb", "topic")
    const sha = commit("feat: on the branch")
    const p = plan({
      event: "pr",
      sha,
      base,
      prNumber: "7",
      runNumber: "42",
      releases: released,
      cwd,
    }) as any
    expect(p.version).toBe("1.1.0-pr.7.42")
    expect(p.distTag).toBe("pr")
    expect(p.commits.map((c: any) => c.subject)).toEqual([
      "feat: on the branch",
    ])
  })
})

describe("what is published", () => {
  test("nothing when only tests, docs, examples or dev dependencies changed", () => {
    commit("test: a", "packages/openauth/src/client/api.test.ts")
    commit("test: b", "packages/openauth/test/issuer.test.ts")
    commit("docs: c", "packages/openauth/README.md")
    commit("fix: d", "examples/client/nextjs/app/page.tsx")
    const sha = commit(
      "security: dev only",
      PACKAGE,
      manifest({ devDependencies: { hono: "2" }, scripts: { test: "t" } }),
    )
    expect(release(sha).skip).toContain("no published file changed")
  })

  test("a runtime dependency, the build script and the CLI source do count", () => {
    expect(
      release(
        commit("fix: dep", PACKAGE, manifest({ dependencies: { a: "1" } })),
      ).version,
    ).toBe("1.0.63")
    expect(isPublishedFile("packages/openauth/script/build.ts")).toBe(true)
    expect(isPublishedFile("packages/openauth/bin/cli.ts")).toBe(true)
    expect(isPublishedFile("packages/openauth/bin/cli.test.ts")).toBe(false)
    expect(isPublishedFile("packages/openauth/bin/cli.js")).toBe(false)
    expect(publishedManifest(manifest({ version: "9.9.9" }))).toBe(
      publishedManifest(manifest()),
    )
  })

  test("a change skipped once is still published with the next release", () => {
    commit("feat: source", SRC)
    const sha = commit("docs: later", "README.md")
    expect(release(sha).version).toBe("1.1.0")
  })
})

describe("one release per commit, and a half-done one is finished", () => {
  test("a released commit is skipped", () => {
    const sha = commit("fix: a")
    git("tag", "v1.0.63")
    expect(release(sha, [...released, "v1.0.63"]).skip).toContain("v1.0.63")
  })

  test("tagged without a GitHub release: the same version again, with its notes", () => {
    const sha = commit("fix: a")
    git("tag", "v1.0.63")
    const p = release(sha)
    expect(p).toMatchObject({
      version: "1.0.63",
      tag: "v1.0.63",
      resume: true,
      previousTag: "v1.0.62",
    })
    expect(p.commits.map((c: any) => c.subject)).toEqual(["fix: a"])
  })

  test("a later commit never reuses a half-done version and takes over its notes", () => {
    commit("feat: a")
    git("tag", "v1.1.0")
    const p = release(commit("fix: b"))
    // Sized from everything since the last finished release (a feat)
    expect(p.version).toBe("1.2.0")
    expect(p.previousTag).toBe("v1.0.62")
    expect(p.commits.map((c: any) => c.subject)).toEqual(["fix: b", "feat: a"])
  })

  test("a commit older than a finished release is skipped", () => {
    const old = commit("fix: a")
    commit("fix: b")
    git("tag", "v1.0.63")
    expect(release(old, [...released, "v1.0.63"]).skip).toContain("part of")
  })
})

test("notes group commits, keep odd characters as text and leave out [skip ci]", () => {
  const c = (subject: string) => ({
    sha: "abcdef0123456789",
    subject,
    body: "",
  })
  const text = notes({
    version: "1.1.0",
    previousTag: "v1.0.62",
    repository: "o/r",
    commits: [
      c("feat!: drop x"),
      c("fix: escape \\n and $(whoami) `id`"),
      c("security: patch"),
      c("chore: hidden"),
      c("docs: d [skip ci]"),
      c("Plain subject"),
    ],
  })
  expect(text).toContain("### Breaking changes\n\n- feat!: drop x (abcdef0)")
  expect(text).toContain("- fix: escape \\n and $(whoami) `id` (abcdef0)")
  expect(text).toContain("### Fixes")
  expect(text).toContain("- security: patch")
  expect(text).toContain("### Other changes\n\n- Plain subject")
  expect(text).not.toContain("hidden")
  expect(text).not.toContain("skip ci")
  expect(text).toContain("compare/v1.0.62...v1.1.0")
})
