/**
 * Runs the Python and Go examples' tests against a fresh issuer each.
 *
 *   bun examples/test/run.ts [python|go]
 *
 * Needs uv (or a Python with the example's requirements) and Go.
 */
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const suites: Record<string, { dir: string; command: string[] }> = {
  python: {
    dir: "client/python",
    command: [
      "uv",
      "run",
      "--no-project",
      "--python",
      "3.13",
      "--with-requirements",
      "requirements.txt",
      "python",
      "-m",
      "unittest",
      "-v",
    ],
  },
  go: {
    dir: "client/go",
    command: ["go", "test", "-count=1", "./..."],
  },
}

// Interrupted (Ctrl-C, a cancelled job): no issuer is left behind
let running: ReturnType<typeof Bun.spawn> | undefined
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)
  process.on(signal, () => {
    running?.kill()
    process.exit(code)
  })

async function run(name: string) {
  const { dir, command } = suites[name]!
  const issuer = Bun.spawn(["bun", join(import.meta.dir, "issuer.ts")], {
    stdout: "pipe",
    stderr: "inherit",
  })
  running = issuer
  try {
    // Keep reading: an issuer whose output nobody reads would stop on a full pipe
    const reader = issuer.stdout.getReader()
    const decoder = new TextDecoder()
    let printed = ""
    while (!printed.includes("\n")) {
      const { value, done } = await reader.read()
      if (done) break
      printed += decoder.decode(value, { stream: true })
    }
    void (async () => {
      while (!(await reader.read()).done);
    })()
    const url = printed.split("\n")[0]
    if (!url?.startsWith("http://")) throw new Error("the issuer did not start")
    console.log(`${name}: against ${url}`)
    return await Bun.spawn(command, {
      cwd: join(root, dir),
      env: { ...process.env, ISSUER: url },
      stdout: "inherit",
      stderr: "inherit",
    }).exited
  } finally {
    issuer.kill()
    await issuer.exited
  }
}

const asked = process.argv.slice(2)
const names = asked.length ? asked : Object.keys(suites)
for (const name of names) if (!suites[name]) throw new Error(`no suite ${name}`)
let failed = false
for (const name of names) failed = (await run(name)) !== 0 || failed
process.exit(failed ? 1 : 0)
