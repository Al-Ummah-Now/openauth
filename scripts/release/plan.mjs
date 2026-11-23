/**
 * What the publish workflow should do with a commit, worked out from git tags and
 * GitHub releases alone (docs/RELEASING.md).
 *
 *   node scripts/release/plan.mjs --event release|dispatch|pr --sha <commit> [...]
 *
 * prints `key=value` lines for $GITHUB_OUTPUT and writes release_notes.md.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const PACKAGE = "packages/openauth/package.github.json"
const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

export function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number)
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Breaking → major, feat → minor, anything else → patch (Conventional Commits). */
export function bumpFor(commits) {
  let bump = "patch"
  for (const { subject, body = "" } of commits) {
    if (
      /^[a-z]+(\([^)]*\))?!:/i.test(subject) ||
      /^BREAKING[ -]CHANGE:/m.test(body)
    )
      return "major"
    if (/^feat(ure)?(\([^)]*\))?:/i.test(subject)) bump = "minor"
  }
  return bump
}

/** A file that ends up in the package or decides how it is built. */
export function isPublishedFile(file) {
  if (file === PACKAGE) return false // compared by content: publishedManifest
  if (/\.test\.tsx?$/.test(file) || /\/__tests__\//.test(file)) return false
  return (
    /^packages\/openauth\/(src|script)\//.test(file) ||
    /^packages\/openauth\/bin\/.*\.ts$/.test(file) || // cli.js is built from these
    file === "packages/openauth/tsconfig.json"
  )
}

/** The part of package.github.json a consumer sees. */
export function publishedManifest(json) {
  if (!json) return ""
  const { version, devDependencies, scripts, ...rest } = JSON.parse(json)
  return JSON.stringify(rest)
}

export function notes({
  version,
  commits,
  previousTag,
  prNumber,
  repository,
  compareTo,
}) {
  const shown = commits.filter((c) => !c.subject.includes("[skip ci]"))
  const line = (c) => `- ${c.subject} (${c.sha.slice(0, 7)})`
  const of = (re) => shown.filter((c) => re.test(c.subject))
  const FEAT = /^feat(ure)?(\([^)]*\))?!?:/i
  const FIX = /^(fix|security)(\([^)]*\))?!?:/i
  const DOCS = /^docs?(\([^)]*\))?!?:/i
  const HIDDEN = /^(chore|refactor|style|test|ci|auto)(\([^)]*\))?:/i
  const other = shown.filter(
    (c) => ![FEAT, FIX, DOCS, HIDDEN].some((re) => re.test(c.subject)),
  )
  const breaking = shown.filter((c) => bumpFor([c]) === "major")
  const sections = [
    ["Breaking changes", breaking],
    ["Features", of(FEAT)],
    ["Fixes", of(FIX)],
    ["Documentation", of(DOCS)],
    ["Other changes", other],
  ]
  const out = prNumber
    ? [
        `## Pre-release v${version}`,
        "",
        `Pre-release from pull request #${prNumber}.`,
        "",
      ]
    : [`## v${version}`, ""]
  for (const [title, list] of sections)
    if (list.length) out.push(`### ${title}`, "", ...list.map(line), "")
  if (previousTag)
    out.push(
      `**Full changelog**: https://github.com/${repository}/compare/${previousTag}...${compareTo ?? `v${version}`}`,
      "",
    )
  return out.join("\n")
}

function gitAt(cwd) {
  return (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd()
}

/**
 * @param {object} input
 * @param {"release"|"dispatch"|"pr"} input.event
 * @param {string} input.sha commit to publish
 * @param {string[]} input.releases tags that have a (non-pre-release) GitHub release
 * @param {string} [input.bump] dispatch only: auto, patch, minor or major
 * @returns {{skip: string} | {version: string, tag: string, distTag: string, resume: boolean, bump: string, previousTag: string | null, commits: {sha: string, subject: string, body: string}[]}}
 */
export function plan({
  event,
  sha,
  releases,
  bump = "auto",
  prNumber,
  runNumber,
  base,
  cwd = process.cwd(),
}) {
  const git = gitAt(cwd)
  const show = (ref, file) => {
    try {
      return git("show", `${ref}:${file}`)
    } catch {
      return null
    }
  }
  const isAncestor = (a, b) => {
    try {
      git("merge-base", "--is-ancestor", a, b)
      return true
    } catch {
      return false
    }
  }
  const stableTags = (...args) =>
    git("tag", "-l", "v*", ...args)
      .split("\n")
      .filter((t) => STABLE.test(t))
      .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))
  const tags = stableTags()
  // Finished = tagged and has its GitHub release, the last step of a publish.
  const finished = tags.filter((t) => releases.includes(t))
  const commitsSince = (tag) =>
    git(
      "log",
      "--no-merges",
      "--format=%H%x1f%s%x1f%b%x1e",
      tag ? `${tag}..${sha}` : sha,
      ...(tag ? [] : ["-20"]),
    )
      .split("\x1e")
      .map((r) => r.replace(/^\n/, ""))
      .filter(Boolean)
      .map((r) => {
        const [commit, subject, body] = r.split("\x1f")
        return { sha: commit, subject, body }
      })

  if (event !== "pr") {
    const own = stableTags("--points-at", sha)[0]
    if (own && releases.includes(own))
      return { skip: `${sha.slice(0, 7)} is already released as ${own}` }
    // Before resuming: a newer release already holds this commit's changes, and finishing
    // the old version now would move `latest` back to it.
    const newer = finished.find((t) => isAncestor(sha, t))
    if (newer) return { skip: `${sha.slice(0, 7)} is part of ${newer}` }
    if (own) {
      // Tagged by an earlier run that did not finish: same version again.
      const previousTag = finished.find(
        (t) => compareVersions(t.slice(1), own.slice(1)) < 0,
      )
      return {
        version: own.slice(1),
        tag: own,
        distTag: "latest",
        resume: true,
        bump: "resume",
        previousTag: previousTag ?? null,
        commits: commitsSince(previousTag),
      }
    }
  }

  const previousTag = finished[0] ?? null
  const from = event === "pr" ? base : previousTag
  if (event !== "dispatch" && from) {
    const files = git("diff", "--name-only", `${from}...${sha}`).split("\n")
    const changed =
      files.some(isPublishedFile) ||
      (files.includes(PACKAGE) &&
        publishedManifest(show(git("merge-base", from, sha), PACKAGE)) !==
          publishedManifest(show(sha, PACKAGE)))
    if (!changed)
      return { skip: `no published file changed since ${from.slice(0, 12)}` }
  }

  const fileVersion = JSON.parse(show(sha, PACKAGE)).version
  const current = [fileVersion, ...tags.map((t) => t.slice(1))].sort(
    (a, b) => -compareVersions(a, b),
  )[0]
  const since = commitsSince(previousTag)
  const size = event === "dispatch" && bump !== "auto" ? bump : bumpFor(since)
  const next = bumpVersion(current, size)
  const version = event === "pr" ? `${next}-pr.${prNumber}.${runNumber}` : next
  return {
    version,
    tag: `v${version}`,
    distTag: event === "pr" ? "pr" : "latest",
    resume: false,
    bump: size,
    previousTag,
    commits:
      event === "pr" ? since.filter((c) => !isAncestor(c.sha, base)) : since,
  }
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`)
    return i < 0 ? undefined : argv[i + 1]
  }
  const result = plan({
    event: arg("event"),
    sha: arg("sha"),
    bump: arg("bump") || "auto",
    prNumber: arg("pr"),
    runNumber: arg("run"),
    base: arg("base"),
    releases: readFileSync(arg("releases"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  })
  if (result.skip) {
    console.error(`Nothing to publish: ${result.skip}`)
    process.stdout.write("skip=true\n")
    return
  }
  console.error(
    `${result.resume ? "Finishing" : "Publishing"} ${result.version} (${result.bump}, previous ${result.previousTag ?? "none"})`,
  )
  writeFileSync(
    arg("notes") ?? "release_notes.md",
    notes({
      version: result.version,
      commits: result.commits,
      previousTag: result.previousTag,
      prNumber: arg("event") === "pr" ? arg("pr") : undefined,
      repository: arg("repository"),
    }),
  )
  process.stdout.write(
    [
      "skip=false",
      `version=${result.version}`,
      `tag=${result.tag}`,
      `dist_tag=${result.distTag}`,
      "",
    ].join("\n"),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
}
