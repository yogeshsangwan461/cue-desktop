'use strict'
const api = window.cue, $ = id => document.getElementById(id)
let cfg, mode = 'interview', expanded = false, privateMode = true, recording = false, starting = false, busy = false, answerNode, shots = 0
let captureTracks = [], audioNodes = [], turns = [], autoTimer, pendingTurn
const removedKeys = new Set(), answeredTurns = new Set()
const profileFields = { name: 'profile-name', targetRole: 'profile-role', personality: 'profile-personality', answerStyle: 'profile-style', resume: 'profile-resume', projects: 'profile-projects' }
const keyFor = p => ({ openai: 'openai_api_key', claude: 'claude_api_key', custom: 'custom_api_key' })[p]
function toast(message) { $('status-txt').textContent = $('settings-status').textContent = message; if (!expanded) expand(true) }
async function safe(fn) { try { return await fn() } catch (e) { toast(e.message || String(e)); return null } }
async function expand(value) { expanded = value; document.body.classList.toggle('compact', !value); await api.setExpanded(value) }
function togglePanel() { if (expanded) document.querySelectorAll('.overlay').forEach(n => n.classList.remove('open')); return safe(() => expand(!expanded)) }
function setProfile(p) { for (const [k, id] of Object.entries(profileFields)) $(id).value = p[k] || '' }
function currentModel(p, c) { return p === 'openai' ? (c === 'api' ? cfg.openaiApiModel : cfg.openaiModel) : p === 'claude' ? (c === 'api' ? cfg.claudeApiModel : cfg.claudeModel) : cfg.customModel }
function opacity(value) { document.documentElement.style.setProperty('--bg', `rgba(17,18,20,${value})`); document.documentElement.style.setProperty('--panel-bg', `rgba(8,9,11,${Math.min(1, value + .04)})`) }
function updateProvider() {
  const p = $('provider').value
  if (p === 'custom') $('connection').value = 'api'
  $('connection').disabled = p === 'custom'
  const c = $('connection').value
  $('subscription-options').hidden = c !== 'subscription'; $('api-options').hidden = c !== 'api'; $('base-url-row').hidden = p !== 'custom'; $('claude-note').hidden = p !== 'claude' || c !== 'subscription'
  $('model-id').value = currentModel(p, c); $('model-key').value = ''
  $('model-id').placeholder = c === 'subscription' && p === 'openai' ? 'Leave blank for account default' : 'Model available to your account'
  $('model-key-state').textContent = cfg[keyFor(p)] && !removedKeys.has(keyFor(p)) ? 'Key saved · leave blank to keep it' : 'No key saved'
  $('connection-state').textContent = 'Not checked'; $('connection-log').hidden = true
}
function updateLabels() {
  $('model-indicator').textContent = { openai: 'ChatGPT', claude: 'Claude', custom: 'Other' }[cfg.provider]
  $('sub-label').textContent = cfg.connection === 'api' ? 'API key' : 'Subscription'
  $('assembly-key-state').textContent = cfg.assemblyai_key ? 'Key saved · leave blank to keep it' : 'No key saved'
  document.querySelectorAll('.model-btn').forEach(b => b.classList.toggle('active', b.dataset.model === cfg.provider))
}
async function fillSettings() {
  cfg = await api.getConfig(); removedKeys.clear()
  $('provider').value = cfg.provider; $('connection').value = cfg.connection; $('base-url').value = cfg.customBaseUrl; $('assembly-key').value = ''
  $('overlay-opacity').value = cfg.overlayOpacity; $('auto-answer').checked = cfg.autoAnswer; opacity(cfg.overlayOpacity)
  setProfile(cfg.profile); updateProvider(); updateLabels(); showDocuments(await api.documents())
}
function toggleSettingsPanel(force) { return safe(async () => {
  const open = typeof force === 'boolean' ? force : !$('settings-overlay').classList.contains('open')
  if (open) { await expand(true); await fillSettings(); $('history-overlay').classList.remove('open'); $('settings-status').textContent = '' }
  $('settings-overlay').classList.toggle('open', open)
}) }
function showDocuments(docs) {
  $('document-list').replaceChildren(); $('context-strip').replaceChildren()
  const names = [...(cfg.profile.name || cfg.profile.resume ? ['Your profile'] : []), ...(docs || []).map(d => d.name)]
  for (const name of names) { const chip = document.createElement('span'); chip.className = 'context-chip'; chip.textContent = name; $('context-strip').append(chip) }
  if (!names.length) $('context-strip').textContent = 'Add your profile in Settings'
  for (const doc of docs || []) {
    const row = document.createElement('div'); row.className = 'document-row'
    const name = document.createElement('span'); name.textContent = doc.name
    const remove = document.createElement('button'); remove.className = 'settings-save-btn'; remove.textContent = 'Remove'; remove.onclick = () => safe(async () => showDocuments(await api.removeDocument(doc.name)))
    row.append(name, remove); $('document-list').append(row)
  }
}
async function saveSettings(close = true) {
  const provider = $('provider').value, connection = $('connection').value, model = $('model-id').value.trim()
  if (!model && connection === 'api' && provider !== 'custom') throw new Error('Enter a model ID for your API provider.')
  const patch = { provider, connection, profile: Object.fromEntries(Object.entries(profileFields).map(([k, id]) => [k, $(id).value])), customBaseUrl: $('base-url').value.trim(), overlayOpacity: Number($('overlay-opacity').value), autoAnswer: $('auto-answer').checked }
  patch[provider === 'openai' ? (connection === 'api' ? 'openaiApiModel' : 'openaiModel') : provider === 'claude' ? (connection === 'api' ? 'claudeApiModel' : 'claudeModel') : 'customModel'] = model
  for (const key of removedKeys) patch[key] = ''
  if ($('assembly-key').value.trim()) patch.assemblyai_key = $('assembly-key').value.trim()
  if ($('model-key').value.trim()) patch[keyFor(provider)] = $('model-key').value.trim()
  cfg = await api.saveConfig(patch); removedKeys.clear(); $('assembly-key').value = $('model-key').value = ''; updateLabels(); showDocuments(await api.documents())
  if (close) $('settings-overlay').classList.remove('open')
  toast('Settings saved.')
}
async function getAnswer(screenshot = false, request) {
  if (busy) throw new Error('An answer is running. Click Stop answer first.')
  const question = request || $('prompt').value.trim() || turns.filter(t => t.role === 'Other speaker' && t.final).at(-1)?.text || turns.filter(t => t.final).at(-1)?.text || ''
  if (!question && !screenshot) throw new Error('Type a question or start listening first.')
  await expand(true); const payload = { question, mode }
  if (screenshot) await api.screenshot(payload); else await api.ask(payload)
}
function suggestResponse() { return safe(() => getAnswer()) }
function assistScreen() { return safe(() => getAnswer(true, $('prompt').value.trim() || 'Help me answer what is visible on this screen.')) }
function suggestFollowup() { return safe(() => getAnswer(false, 'Suggest one useful concise follow-up question based on this conversation.')) }
function recapSession() { return safe(() => getAnswer(false, 'Give a concise factual recap of this conversation and next steps.')) }
function captureScreen() { return safe(async () => { shots = await api.capture(); $('capture-chip').textContent = `📸 Capture (${shots})`; toast(`Screen captured. ${shots} ready to solve.`) }) }
function solveShots() { return safe(async () => { await expand(true); await api.solve({ question: $('prompt').value.trim(), mode }); shots = 0; $('capture-chip').textContent = '📸 Capture' }) }
function addContextFile() { return safe(async () => showDocuments(await api.importDocument())) }
function exportTranscript() { return safe(async () => { if (await api.exportTranscript()) toast('Transcript exported.') }) }
function clearChat() { return safe(async () => { api.cancel(); clearTimeout(autoTimer); pendingTurn = null; turns = []; answeredTurns.clear(); await api.clearConversation(); $('transcript-text').textContent = recording ? 'Listening…' : 'Not listening'; $('transcript-text').classList.add('empty'); $('response-area').replaceChildren(); answerNode = null; shots = 0; $('capture-chip').textContent = '📸 Capture' }) }
function toggleStealth() { return safe(async () => { privateMode = await api.privacy(!privateMode); $('stealth-toggle').classList.toggle('active', privateMode); $('stealth-row').title = privateMode ? 'Capture protection on' : 'Capture protection off' }) }
function wirePcm(stream, role) {
  const ctx = new AudioContext({ sampleRate: 16000 }), source = ctx.createMediaStreamSource(stream), processor = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain()
  mute.gain.value = 0; source.connect(processor); processor.connect(mute); mute.connect(ctx.destination)
  processor.onaudioprocess = e => {
    if (!recording) return
    const input = e.inputBuffer.getChannelData(0), ratio = ctx.sampleRate / 16000, output = new Int16Array(Math.floor(input.length / ratio))
    for (let i = 0; i < output.length; i++) { const v = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)])); output[i] = v < 0 ? v * 32768 : v * 32767 }
    api.audio(role, output.buffer)
  }
  audioNodes.push({ ctx, source, processor, mute }); captureTracks.push(...stream.getTracks())
  stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (recording) { toast(`${role} capture ended.`); safe(stopListening) } }))
  return ctx.resume()
}
function recordingUi() {
  $('start-label').textContent = busy && !recording ? 'Stop answer' : recording ? 'Stop' : 'Start'
  $('start-btn').classList.toggle('recording', recording); $('mic-btn').classList.toggle('active', recording); $('live-dot').classList.toggle('active', recording); $('session-type-badge').textContent = recording ? mode : ''
  $('mic').disabled = $('system').disabled = recording || starting
}
async function startListening() {
  cfg = await api.getConfig()
  if (!cfg.assemblyai_key) { await toggleSettingsPanel(true); throw new Error('Add your AssemblyAI key before listening.') }
  const roles = [], streams = []; starting = true; $('start-btn').disabled = true; recordingUi()
  try {
    if ($('mic').checked) { streams.push({ role: 'You', stream: await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }) }); roles.push('You') }
    if ($('system').checked) {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw new Error('System audio is unavailable. Turn it off in Settings to use the microphone.') }
      streams.push({ role: 'Other speaker', stream }); roles.push('Other speaker')
    }
    if (!roles.length) throw new Error('Choose microphone or system audio in Settings.')
    await api.startAudio(roles); recording = true; turns = []; answeredTurns.clear(); $('transcript-text').textContent = 'Listening…'; $('transcript-text').classList.add('empty')
    for (const { role, stream } of streams) await wirePcm(stream, role)
    await expand(true); toast('Listening to selected audio sources.')
  } catch (e) { streams.forEach(({ stream }) => stream.getTracks().forEach(t => t.stop())); await stopListening(); throw e }
  finally { starting = false; $('start-btn').disabled = false; recordingUi() }
}
async function stopListening() {
  recording = false; clearTimeout(autoTimer); pendingTurn = null
  for (const n of audioNodes) { n.processor.onaudioprocess = null; n.source.disconnect(); n.processor.disconnect(); n.mute.disconnect(); await n.ctx.close().catch(() => {}) }
  audioNodes = []; captureTracks.forEach(t => t.stop()); captureTracks = []; await api.stopAudio(); recordingUi()
}
function toggleRecording() { if (!starting) return safe(recording ? stopListening : startListening) }
function toggleSession() { if (busy) { api.cancel(); if (recording) safe(stopListening) } else toggleRecording() }
function queueAnswer(turn) {
  clearTimeout(autoTimer); pendingTurn = turn
  autoTimer = setTimeout(() => { if (!recording || !$('auto-answer').checked || answeredTurns.has(turn.id)) { pendingTurn = null; return } if (busy) return; pendingTurn = null; answeredTurns.add(turn.id); safe(() => getAnswer(false, turn.text)) }, 700)
}
function transcript(turn) {
  if (!recording) return
  const existing = turns.find(t => t.id === turn.id); if (existing) Object.assign(existing, turn); else turns.push(turn)
  const area = $('transcript-text'); if (area.classList.contains('empty')) { area.replaceChildren(); area.classList.remove('empty') }
  let node = document.getElementById(`turn-${turn.id}`)
  if (!node) { node = document.createElement('div'); node.id = `turn-${turn.id}`; node.className = 'transcript-turn'; node.append(document.createElement('strong'), document.createElement('span')); area.append(node) }
  node.firstChild.textContent = turn.role + ': '; node.lastChild.textContent = turn.text; node.style.opacity = turn.final ? '1' : '.6'; area.scrollTop = area.scrollHeight
  if (turn.final && turn.role === 'Other speaker' && $('auto-answer').checked && !answeredTurns.has(turn.id) && /\?|^(?:how|what|why|when|where|can you|could you|tell me|describe|explain|walk me)\b/i.test(turn.text.trim())) queueAnswer(turn)
}
function toggleHistory(force) { return safe(async () => {
  const open = typeof force === 'boolean' ? force : !$('history-overlay').classList.contains('open')
  if (open) {
    await expand(true); $('settings-overlay').classList.remove('open'); const history = await api.history(); $('history-body').replaceChildren()
    if (!history.length) $('history-body').textContent = 'Completed answers will appear here.'
    for (const item of history) { const d = document.createElement('details'), s = document.createElement('summary'), a = document.createElement('div'); s.textContent = `${new Date(item.date).toLocaleString()} · ${item.question || 'Screenshot'}`; a.textContent = item.answer; a.className = 'history-detail'; d.append(s, a); $('history-body').append(d) }
  }
  $('history-overlay').classList.toggle('open', open)
}) }
$('save-settings').onclick = () => safe(() => saveSettings())
$('provider').onchange = $('connection').onchange = updateProvider
$('overlay-opacity').oninput = () => opacity(Number($('overlay-opacity').value))
$('clear-assembly-key').onclick = () => { removedKeys.add('assemblyai_key'); $('assembly-key').value = ''; $('assembly-key-state').textContent = 'Will be removed when you save' }
$('clear-model-key').onclick = () => { removedKeys.add(keyFor($('provider').value)); $('model-key').value = ''; $('model-key-state').textContent = 'Will be removed when you save' }
$('assembly-link').onclick = () => safe(() => api.openLink('https://www.assemblyai.com/dashboard/signup'))
$('connect').onclick = () => safe(async () => { $('connect').disabled = true; $('connection-log').textContent = ''; $('connection-log').hidden = false; try { await api.connect($('provider').value); const s = await api.connectionStatus($('provider').value); $('connection-state').textContent = s.connected ? 'Connected' : 'Finish sign-in, then Check connection' } finally { $('connect').disabled = false } })
$('check-connection').onclick = () => safe(async () => { const s = await api.connectionStatus($('provider').value); $('connection-state').textContent = s.connected ? 'Connected' : (s.installed ? 'Finish sign-in with Connect' : 'Click Connect to install and sign in') })
$('import-profile').onclick = () => safe(async () => { const p = await api.importProfile(); if (p) { setProfile(p); cfg.profile = p; showDocuments(await api.documents()); toast('Profile imported.') } })
$('export-profile').onclick = () => safe(async () => { await saveSettings(false); if (await api.exportProfile()) toast('Profile exported without credentials.') })
$('import-document').onclick = addContextFile; $('open-data').onclick = () => safe(() => api.openData())
$('prompt').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); suggestResponse() } }
document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => { mode = b.dataset.mode; document.querySelectorAll('.mode-btn').forEach(n => n.classList.toggle('active', n.dataset.mode === mode)); recordingUi() })
document.querySelectorAll('.model-btn').forEach(b => b.onclick = () => safe(async () => { const provider = b.dataset.model; cfg = await api.saveConfig({ provider, connection: provider === 'custom' ? 'api' : cfg.connection }); updateLabels(); if (provider === 'custom' && (!cfg.customBaseUrl || !cfg.customModel)) await toggleSettingsPanel(true) }))
api.on('answer-start', () => {
  busy = true; expand(true); const row = document.createElement('div'); row.className = 'response-row'
  answerNode = document.createElement('div'); answerNode.className = `response-bubble ${cfg.provider} typing-cursor`
  const copy = document.createElement('button'); copy.className = 'copy-btn'; copy.textContent = 'Copy'; const target = answerNode
  copy.onclick = () => safe(async () => { await navigator.clipboard.writeText(target.textContent); toast('Answer copied.') })
  row.append(answerNode, copy); $('response-area').append(row); $('status-txt').textContent = 'Thinking…'; recordingUi()
})
api.on('answer-delta', text => { if (answerNode) answerNode.textContent += text; $('status-txt').textContent = 'Writing…'; $('response-area').scrollTop = $('response-area').scrollHeight })
api.on('answer-end', () => { busy = false; answerNode?.classList.remove('typing-cursor'); recordingUi(); if ($('status-txt').textContent === 'Writing…' || $('status-txt').textContent === 'Thinking…') $('status-txt').textContent = ''; if (pendingTurn) queueAnswer(pendingTurn) })
api.on('error', toast); api.on('transcript', transcript); api.on('audio-status', text => { if (recording) $('status-txt').textContent = text }); api.on('stop-recording', () => safe(stopListening))
api.on('connection-log', (provider, text) => { if (provider === $('provider').value) { $('connection-log').hidden = false; $('connection-log').textContent += text + '\n'; $('connection-log').scrollTop = $('connection-log').scrollHeight } })
api.on('ask-now', suggestResponse); api.on('screenshot-now', captureScreen); api.on('settings-now', () => toggleSettingsPanel(true)); api.on('history-now', () => toggleHistory(true))
api.on('compact-state', state => { expanded = !state; document.body.classList.toggle('compact', state) })
safe(async () => { await fillSettings(); if (!cfg.profile.resume && !cfg.assemblyai_key) await toggleSettingsPanel(true) })
