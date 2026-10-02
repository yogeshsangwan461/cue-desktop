'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')
const installs = new Map()
const logins = new Map()
function run(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, ...options })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', reject); p.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-600) || `Command exited with ${code}`)))
  })
}
function findExe(dir, filename) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === filename) return full
    if (entry.isDirectory()) { const found = findExe(full, filename); if (found) return found }
  }
  return null
}
function paths(root, provider) {
  const base = path.join(root, 'providers', provider)
  return { base, tool: path.join(base, 'tool'), auth: path.join(base, 'auth'), workspace: path.join(base, 'workspace') }
}
function cliEnv(root, provider) {
  const dirs = paths(root, provider)
  fs.mkdirSync(dirs.auth, { recursive: true }); fs.mkdirSync(dirs.workspace, { recursive: true })
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(OPENAI_|ANTHROPIC_|CLAUDE_|CODEX_|AWS_|GOOGLE_|GEMINI_)/.test(key)) delete env[key]
  if (provider === 'openai') env.CODEX_HOME = dirs.auth
  else env.CLAUDE_CONFIG_DIR = dirs.auth
  return { env, cwd: dirs.workspace, windowsHide: true }
}
async function install(root, provider, log = () => {}) {
  if (!['openai', 'claude'].includes(provider)) throw new Error('Subscription sign-in is available for ChatGPT and Claude Code.')
  const dirs = paths(root, provider)
  const name = provider === 'openai' ? 'codex.exe' : 'claude.exe'
  const existing = findExe(dirs.tool, name)
  if (existing) return existing
  if (installs.has(provider)) return installs.get(provider)
  const job = (async () => {
    log(`Downloading the official ${provider === 'openai' ? 'Codex' : 'Claude Code'} connector. This only happens on first connection.`)
    const packageName = provider === 'openai' ? '@openai/codex' : '@anthropic-ai/claude-code'
    const metaRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, { signal: AbortSignal.timeout(30000) })
    if (!metaRes.ok) throw new Error('Could not retrieve the official connector.')
    const meta = await metaRes.json()
    const platform = `${process.platform}-${process.arch}`
    const dependency = meta.optionalDependencies?.[`${packageName}-${platform}`]
    if (!dependency) throw new Error('This subscription connector is not available for your computer.')
    let nativeName, version
    if (dependency.startsWith('npm:')) {
      const split = dependency.lastIndexOf('@'); nativeName = dependency.slice(4, split); version = dependency.slice(split + 1)
    } else { nativeName = `${packageName}-${platform}`; version = dependency }
    const nativeRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(nativeName)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30000) })
    if (!nativeRes.ok) throw new Error('Could not retrieve the native connector.')
    const native = await nativeRes.json(), url = new URL(native.dist.tarball)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected connector download location.')
    fs.mkdirSync(dirs.base, { recursive: true })
    const archive = path.join(dirs.base, 'connector.tgz')
    const res = await fetch(url, { signal: AbortSignal.timeout(300000), redirect: 'error' })
    if (!res.ok) throw new Error('Connector download failed.')
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archive))
    const algorithm = native.dist.integrity?.split('-')[0]
    if (algorithm !== 'sha512') throw new Error('Connector integrity metadata is missing.')
    const hash = crypto.createHash('sha512')
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
    if (`sha512-${hash.digest('base64')}` !== native.dist.integrity) throw new Error('Connector integrity check failed.')
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    const listing = await run(tar, ['-tzf', archive])
    if (listing.split(/\r?\n/).some(p => p.startsWith('/') || p.includes('..') || /^[A-Za-z]:/.test(p))) throw new Error('Unsafe connector archive.')
    fs.mkdirSync(dirs.tool, { recursive: true })
    await run(tar, ['-xzf', archive, '-C', dirs.tool])
    fs.unlinkSync(archive)
    const exe = findExe(dirs.tool, name)
    if (!exe) throw new Error('The downloaded connector did not contain its executable.')
    log('Official connector installed. Opening provider sign-in…')
    return exe
  })()
  installs.set(provider, job)
  try { return await job } finally { installs.delete(provider) }
}
async function status(root, provider) {
  const dirs = paths(root, provider)
  const exe = findExe(dirs.tool, provider === 'openai' ? 'codex.exe' : 'claude.exe')
  if (!exe) return { installed: false, connected: false }
  try {
    const text = await run(exe, provider === 'openai' ? ['login', 'status'] : ['auth', 'status'], { ...cliEnv(root, provider), timeout: 15000 })
    if (provider === 'claude') { try { const data = JSON.parse(text); return { installed: true, connected: data.loggedIn === true, method: data.authMethod || '' } } catch {} }
    return { installed: true, connected: true }
  } catch { return { installed: true, connected: false } }
}
async function connect(root, provider, log) {
  if (logins.has(provider)) { log('Provider sign-in is already running. Finish the existing sign-in first.'); return { started: true } }
  const exe = await install(root, provider, log)
  if (logins.has(provider)) return { started: true }
  const args = provider === 'openai' ? ['login', '--device-auth'] : ['auth', 'login']
  const p = spawn(exe, args, cliEnv(root, provider))
  logins.set(provider, p)
  let settled = false
  const timeout = setTimeout(() => { p.kill(); finish('Sign-in timed out. Click Connect to try again.') }, 300000)
  const finish = message => { if (settled) return; settled = true; clearTimeout(timeout); logins.delete(provider); log(message) }
  const output = d => log(d.toString().replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim())
  p.stdout.on('data', output); p.stderr.on('data', output)
  p.on('error', e => finish(`Could not start provider sign-in: ${e.message}`))
  p.on('close', code => finish(code === 0 ? 'Sign-in completed. Click Check connection.' : 'Sign-in did not complete. Try Connect again.'))
  return { started: true }
}
function cliDelta(provider, event) {
  if (provider === 'openai') {
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error(event.error?.message || event.message || 'ChatGPT connection failed.')
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') return event.item.text || ''
  } else {
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') return event.event.delta?.text || ''
    if (event.type === 'result' && event.is_error) throw new Error(event.result || 'Claude Code connection failed.')
  }
  return ''
}
async function streamSubscription(root, cfg, system, prompt, imagePaths, onDelta, signal) {
  const exe = findExe(paths(root, cfg.provider).tool, cfg.provider === 'openai' ? 'codex.exe' : 'claude.exe')
  if (!exe) throw new Error('Click Connect in Settings before using your subscription.')
  if (cfg.provider === 'claude' && imagePaths.length) throw new Error('Use API key mode for Claude screenshots. Subscription mode supports text and transcripts.')
  const combined = system + '\n\n' + prompt
  const args = cfg.provider === 'openai'
    ? ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'web_search="disabled"', ...(cfg.openaiModel ? ['--model', cfg.openaiModel] : []), ...imagePaths.flatMap(p => ['--image', p]), '-']
    : ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--model', cfg.claudeModel || 'sonnet']
  await new Promise((resolve, reject) => {
    const p = spawn(exe, args, cliEnv(root, cfg.provider))
    let buffer = '', errorText = '', received = false, settled = false
    const abort = () => { p.kill(); finish(new Error('Answer cancelled.')) }
    const timer = setTimeout(() => { p.kill(); finish(new Error('The provider timed out. Try again.')) }, 180000)
    const finish = err => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); err ? reject(err) : resolve() }
    signal.addEventListener('abort', abort, { once: true })
    const consume = line => {
      let event
      try { event = JSON.parse(line) } catch { return }
      try { const delta = cliDelta(cfg.provider, event); if (delta) { received = true; onDelta(delta) } } catch (e) { p.kill(); finish(e) }
    }
    p.stdout.on('data', d => { buffer += d; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) consume(line) })
    p.stderr.on('data', d => { errorText = (errorText + d).slice(-2000) })
    p.on('error', finish)
    p.on('close', code => { if (buffer) consume(buffer); finish(code !== 0 || !received ? new Error(`Subscription response failed. Check your connection and account limits. ${errorText.slice(-300)}`) : null) })
    p.stdin.on('error', () => {}); p.stdin.end(combined)
    if (signal.aborted) abort()
  })
}
module.exports = { install, status, connect, cliDelta, streamSubscription, cliEnv, findExe, paths }
