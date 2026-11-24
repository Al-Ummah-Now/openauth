/**
 * Lets a long identifier or path in a table cell break between its words (after
 * "_", before "/", in camelCase, after a dot), never in the middle of one.
 */
interface Node {
  type: string
  tagName?: string
  value?: string
  children?: Node[]
}

const LONG = 12
const wbr = (): Node => ({ type: "element", tagName: "wbr", children: [] })

/** The parts of one identifier or path, in the order they are read. */
export function pieces(word: string): string[] {
  if (word.length < LONG) return [word]
  return word.split(
    /(?<=_)(?=[^_])|(?<=[^/])(?=\/)|(?<=[a-z])(?=[A-Z])|(?<=[a-z]\.)(?=[a-z])/,
  )
}

/** Text broken into text and <wbr>. */
function broken(text: string): Node[] {
  const out: Node[] = []
  const add = (value: string) => {
    const last = out[out.length - 1]
    if (last?.type === "text") last.value += value
    else out.push({ type: "text", value })
  }
  for (const part of text.match(/\s+|\S+/g) ?? []) {
    pieces(part).forEach((piece, i) => {
      if (i > 0) out.push(wbr())
      add(piece)
    })
  }
  return out
}

export default function rehypeSoftBreaks() {
  const visit = (node: Node, inCell: boolean) => {
    if (!node.children) return
    const cell = inCell || node.tagName === "td" || node.tagName === "th"
    node.children = node.children.flatMap((child) =>
      cell && child.type === "text" && child.value
        ? broken(child.value)
        : [child],
    )
    for (const child of node.children) visit(child, cell)
  }
  return (tree: Node) => visit(tree, false)
}
