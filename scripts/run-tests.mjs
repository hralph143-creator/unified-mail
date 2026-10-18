import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const vitestPath = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const extra = process.argv.slice(2)
const args = [vitestPath, ...(extra.length ? extra : ['run'])]
const result = spawnSync(electronPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
