'use strict'
const path = require('path'), { spawnSync } = require('child_process')
const { install, cliEnv } = require('../lib/subscriptions')
;(async () => {
  const root = path.resolve(__dirname, '../../tmp/cue-connector-check')
  for (const provider of ['openai', 'claude']) {
    const exe = await install(root, provider, text => console.log(text))
    const result = spawnSync(exe, ['--version'], { ...cliEnv(root, provider), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'Connector failed to launch')
    console.log(provider + ': ' + result.stdout.trim())
    const help = spawnSync(exe, provider === 'openai' ? ['exec', '--help'] : ['--help'], { ...cliEnv(root, provider), encoding: 'utf8' })
    const flags = provider === 'openai' ? ['--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', '--image'] : ['--include-partial-messages', '--strict-mcp-config', '--no-session-persistence', '--tools']
    for (const flag of flags) if (!help.stdout.includes(flag)) throw new Error(provider + ' is missing ' + flag)
    console.log(provider + ': required invocation flags verified; no account used.')
  }
})().catch(e => { console.error(e.message); process.exitCode = 1 })
