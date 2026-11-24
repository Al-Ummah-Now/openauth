/**
 * Prefixes the site's base path to the root-relative links and images of a page:
 * the docs are served under /openauth, so "/docs/client" alone is not found.
 */
interface Node {
  type: string
  tagName?: string
  name?: string
  properties?: Record<string, unknown>
  attributes?: { type: string; name?: string; value?: unknown }[]
  children?: Node[]
}

export function withBase(url: unknown, base: string): unknown {
  if (typeof url !== "string" || !base) return url
  if (!url.startsWith("/") || url.startsWith("//")) return url
  if (url === base || url.startsWith(`${base}/`)) return url
  return base + url
}

export default function rehypeBase({ base = "" }: { base?: string } = {}) {
  const prefix = base.replace(/\/+$/, "")
  const visit = (node: Node) => {
    for (const key of ["href", "src"]) {
      if (node.properties?.[key] !== undefined)
        node.properties[key] = withBase(node.properties[key], prefix)
      // <a href> written as JSX in an .mdx page
      for (const attr of node.attributes ?? [])
        if (attr.name === key) attr.value = withBase(attr.value, prefix)
    }
    node.children?.forEach(visit)
  }
  return (tree: Node) => visit(tree)
}
