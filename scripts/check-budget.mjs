// Fails when examples/minimal-host's composition code exceeds ADR-0012's
// 50-line budget. Counts every non-blank, non-comment line of host code.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET = 50
const root = 'examples/minimal-host'
const skip = new Set(['node_modules', '.nuxt', '.output', '.data'])

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

let total = 0
for (const file of files(root)) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => {
    const text = line.trim()
    return text !== '' && !text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*')
  })
  console.log(`${String(lines.length).padStart(4)}  ${file}`)
  total += lines.length
}
console.log(`${String(total).padStart(4)}  total (budget ${BUDGET})`)
if (total > BUDGET) {
  console.error(`minimal-host composition is ${total} lines, over the ${BUDGET}-line budget`)
  process.exit(1)
}
