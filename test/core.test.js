'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { DEFAULTS, validateProfile, validateConfig, publicConfig, systemPrompt } = require('../lib/core')
const { makeRequest, eventDelta, streamApi } = require('../lib/providers')
const { cliDelta, cliEnv } = require('../lib/subscriptions')
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http')
test('fresh profile and credentials are blank and export drops foreign fields', () => {
  assert.ok(Object.values(DEFAULTS.profile).every(x => x === ''))
  assert.equal(DEFAULTS.assemblyai_key, '')
  const p = validateProfile({ profile: { name: 'Alex', resume: 'Actual work', openai_api_key: 'do-not-copy' }, assemblyai_key: 'do-not-copy' })
  assert.equal(p.name, 'Alex'); assert.equal(p.resume, 'Actual work'); assert.equal(p.openai_api_key, undefined)
  assert.throws(() => validateProfile({ resume: ['bad'] }))
})
test('clearing credentials persists and UI gets only presence markers', () => {
  const cfg = validateConfig({ assemblyai_key: '' }, { ...DEFAULTS, assemblyai_key: 'secret' })
  assert.equal(cfg.assemblyai_key, '')
  const visible = publicConfig({ ...DEFAULTS, openai_api_key: 'secret' })
  assert.equal(visible.openai_api_key, '__present__'); assert.ok(!JSON.stringify(visible).includes('secret'))
})
test('configuration rejects remote HTTP and credential-bearing URLs', () => {
  assert.throws(() => validateConfig({ customBaseUrl: 'http://example.com/v1' }))
  assert.throws(() => validateConfig({ customBaseUrl: 'https://user:pass@example.com/v1' }))
  assert.equal(validateConfig({ provider: 'custom', connection: 'subscription', customBaseUrl: 'http://localhost:1234/v1' }).connection, 'api')
})
test('universal prompt keeps STAR and factuality without imposing a personal voice', () => {
  const prompt = systemPrompt({ ...DEFAULTS.profile, name: 'Alex' })
  assert.match(prompt, /Situation, Task, Action, Result/); assert.match(prompt, /Never invent/); assert.match(prompt, /concise/)
  assert.match(prompt, /"name":"Alex"/); assert.equal(DEFAULTS.profile.personality, '')
})
test('all API modes route keys and multimodal input correctly', () => {
  const openai = makeRequest({ ...DEFAULTS, provider: 'openai', openai_api_key: 'oa', openaiApiModel: 'test-model' }, 'rules', 'question', ['img'])
  assert.equal(openai.url, 'https://api.openai.com/v1/responses'); assert.equal(openai.body.input[0].content[1].type, 'input_image')
  const claude = makeRequest({ ...DEFAULTS, provider: 'claude', claude_api_key: 'cl' }, 'rules', 'question', ['img'])
  assert.equal(claude.headers['x-api-key'], 'cl'); assert.equal(claude.body.messages[0].content[1].source.data, 'img')
  const custom = makeRequest({ ...DEFAULTS, provider: 'custom', customBaseUrl: 'http://localhost:1234/v1/', customModel: 'local' }, 'rules', 'question')
  assert.equal(custom.url, 'http://localhost:1234/v1/chat/completions'); assert.equal(custom.headers.Authorization, undefined)
  assert.throws(() => makeRequest({ ...DEFAULTS, provider: 'claude' }, '', 'question'))
})
test('subscription event streams emit only answers and preserve errors', () => {
  assert.equal(cliDelta('openai', { type: 'item.completed', item: { type: 'agent_message', text: 'Answer' } }), 'Answer')
  assert.equal(cliDelta('openai', { type: 'item.completed', item: { type: 'reasoning', text: 'Hidden' } }), '')
  assert.equal(cliDelta('claude', { type: 'stream_event', event: { type: 'content_block_delta', delta: { text: 'Answer' } } }), 'Answer')
  assert.throws(() => eventDelta({ type: 'response.failed', response: { error: { message: 'failure' } } }), /failure/)
})
test('subscription auth is isolated from machine API credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-test-'))
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'inherited-test'
  try { const opts = cliEnv(dir, 'openai'); assert.equal(opts.env.OPENAI_API_KEY, undefined); assert.ok(opts.env.CODEX_HOME.startsWith(dir)); assert.ok(opts.cwd.startsWith(dir)) }
  finally { old === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = old; fs.rmSync(dir, { recursive: true, force: true }) }
})
test('streaming handles split UTF-8/SSE chunks and HTTP errors end cleanly', async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/bad')) { res.writeHead(401); res.end('credential error'); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Hel'); setTimeout(() => { res.end('lo"}}]}\n\ndata: [DONE]\n') }, 5)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`, signal = new AbortController().signal
  try {
    let answer = ''; const cfg = { ...DEFAULTS, provider: 'custom', customModel: 'mock', customBaseUrl: base + '/v1' }
    await streamApi(cfg, 'rules', 'question', [], d => { answer += d }, signal); assert.equal(answer, 'Hello')
    await assert.rejects(streamApi({ ...cfg, customBaseUrl: base + '/bad' }, 'rules', 'question', [], () => {}, signal), /HTTP 401/)
  } finally { await new Promise(r => server.close(r)) }
})
