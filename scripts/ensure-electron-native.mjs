import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const electronVersion = require('electron/package.json').version
const sqlitePackagePath = require.resolve('better-sqlite3/package.json')
const sqliteDirectory = path.dirname(sqlitePackagePath)
const prebuildInstaller = path.join(
  sqliteDirectory,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prebuild-install.cmd' : 'prebuild-install',
)

function nativeModuleWorks() {
  const result = spawnSync(
    electronExecutable,
    [
      '-e',
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close()",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
    },
  )

  return result.status === 0
}

const forceRepair = process.argv.includes('--repair')

if (!forceRepair && nativeModuleWorks()) {
  console.log('[UnifiedMail] Database component is ready.')
  process.exit(0)
}

console.log('[UnifiedMail] Restoring the prebuilt database component...')
const install = spawnSync(
  prebuildInstaller,
  [
    '--runtime',
    'electron',
    '--target',
    electronVersion,
    '--arch',
    process.arch,
    '--platform',
    process.platform,
    '--force',
  ],
  { cwd: sqliteDirectory, stdio: 'inherit', shell: process.platform === 'win32' },
)

if (install.status !== 0 || !nativeModuleWorks()) {
  console.error('[UnifiedMail] Could not restore the database component.')
  process.exit(install.status || 1)
}

console.log('[UnifiedMail] Database component restored successfully.')
