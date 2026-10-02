'use strict'
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, desktopCapturer, session, safeStorage, Tray, Menu, screen } = require('electron')
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const WS = require('ws')
const { DEFAULTS, SECRET_FIELDS, validateConfig, validateProfile, publicConfig, systemPrompt, transcriptPrompt } = require('./lib/core')
const { streamApi } = require('./lib/providers')
const subscription = require('./lib/subscriptions')
app.setName('Cue')
app.setPath('userData', process.env.CUE_TEST_DATA || path.join(app.getPath('appData'), 'Cue-Standalone'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }
let win, tray, quitting = false, answerController, audioActive = false, sockets = {}, reconnects = {}, turns = [], currentAnswer = '', compact = true, shots = []
const root = app.getPath('userData'), documentsDir = path.join(root, 'documents'), historyDir = path.join(root, 'sessions')
function emit(event, ...args) { if (win && !win.isDestroyed()) win.webContents.send(event, ...args) }
function readConfig() {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8')) } catch {}
  let cfg = validateConfig(saved)
  for (const key of SECRET_FIELDS) {
    const encoded = saved.secrets?.[key]
    cfg[key] = ''
    if (encoded) { try { cfg[key] = safeStorage.decryptString(Buffer.from(encoded, 'base64')) } catch {} }
  }
  return cfg
}
function writeConfig(raw) {
  const current = readConfig(), cfg = validateConfig(raw, current)
  if (SECRET_FIELDS.some(k => cfg[k]) && !safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Your keys were not saved.')
  const saved = { ...cfg, secrets: {} }
  for (const key of SECRET_FIELDS) {
    if (cfg[key]) saved.secrets[key] = safeStorage.encryptString(cfg[key]).toString('base64')
    delete saved[key]
  }
  fs.mkdirSync(root, { recursive: true })
  const target = path.join(root, 'settings.json'), temp = target + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(saved, null, 2)); fs.renameSync(temp, target)
  return publicConfig(cfg)
}
function documents() {
  return fs.readdirSync(documentsDir).filter(n => /\.(md|txt)$/i.test(n)).map(name => ({ name, size: fs.statSync(path.join(documentsDir, name)).size }))
}
function loadDocuments() { return documents().map(d => `=== ${d.name} ===\n${fs.readFileSync(path.join(documentsDir, d.name), 'utf8')}`).join('\n\n').slice(0, 150000) }
function stopAudio() {
  audioActive = false
  for (const timer of Object.values(reconnects)) clearTimeout(timer)
  reconnects = {}
  for (const ws of Object.values(sockets)) {
    if (ws.readyState === WS.OPEN) { ws.send(JSON.stringify({ type: 'Terminate' })); setTimeout(() => ws.terminate(), 600) }
    else ws.terminate()
  }
  sockets = {}; emit('audio-status', 'Stopped')
}
function connectAudio(role, key, attempts = 0) {
  if (!audioActive) return
  const ws = new WS('wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&speech_model=universal-streaming-english', { headers: { Authorization: key }, handshakeTimeout: 15000 })
  sockets[role] = ws
  ws.on('open', () => emit('audio-status', `${role} connected`))
  ws.on('message', data => {
    let event
    try { event = JSON.parse(data.toString()) } catch { return }
    if (event.type === 'Turn' && event.transcript) {
      const t = { role, text: event.transcript, final: !!event.end_of_turn, id: `${role}-${event.turn_order}` }
      emit('transcript', t)
      if (t.final) { const last = turns.find(x => x.id === t.id); if (last) last.text = t.text; else turns.push(t) }
    }
    if (event.type === 'Error' || event.error) emit('error', event.error || 'Transcription failed. Check your AssemblyAI account.')
  })
  ws.on('error', () => emit('audio-status', `${role}: check connection and AssemblyAI key`))
  ws.on('close', code => {
    if (sockets[role] !== ws || !audioActive) return
    if ([1008, 4001, 4003, 4029].includes(code) || attempts >= 3) { emit('error', `${role} transcription stopped. Check your AssemblyAI key, credits, and connection.`); emit('stop-recording'); stopAudio(); return }
    reconnects[role] = setTimeout(() => connectAudio(role, key, attempts + 1), 1500 * (attempts + 1))
  })
}
async function ask(question, mode = 'interview', images = []) {
  if (answerController) throw new Error('An answer is already running. Stop it before asking again.')
  if (typeof question !== 'string' || question.length > 100000) throw new Error('Enter a shorter question.')
  const cfg = readConfig(), controller = new AbortController()
  answerController = controller; currentAnswer = ''; emit('answer-start')
  const timer = setTimeout(() => controller.abort(), 180000)
  try {
    const sys = systemPrompt(cfg.profile, mode, loadDocuments()), prompt = transcriptPrompt(question, turns)
    const onDelta = text => { currentAnswer += text; emit('answer-delta', text) }
    if (cfg.connection === 'subscription') await subscription.streamSubscription(root, cfg, sys, prompt, images, onDelta, controller.signal)
    else await streamApi(cfg, sys, prompt, images.map(p => fs.readFileSync(p).toString('base64')), onDelta, controller.signal)
    const id = crypto.randomUUID()
    fs.writeFileSync(path.join(historyDir, `${id}.json`), JSON.stringify({ id, date: new Date().toISOString(), question, answer: currentAnswer, turns: turns.slice(-24) }))
  } catch (e) { emit('error', controller.signal.aborted ? 'Answer stopped.' : e.message) }
  finally { clearTimeout(timer); if (answerController === controller) answerController = null; emit('answer-end') }
}
function setExpanded(expanded) {
  compact = !expanded
  win.setResizable(true)
  win.setSize(540, compact ? 64 : 480)
  if (compact) win.setResizable(false)
  const bounds = win.getBounds(), area = screen.getDisplayMatching(bounds).workArea
  win.setPosition(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)))
  emit('compact-state', compact)
  return compact
}
function showOverlay() { win.show(); win.focus() }
function clearShots() { for (const file of shots) fs.rmSync(file, { force: true }); shots = [] }
async function captureImage() {
  let file
  try {
    const display = screen.getDisplayMatching(win.getBounds())
    win.hide(); await new Promise(r => setTimeout(r, 180))
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture the screen.')
    const dir = path.join(root, 'temporary'); fs.mkdirSync(dir, { recursive: true })
    file = path.join(dir, crypto.randomUUID() + '.png'); fs.writeFileSync(file, source.thumbnail.toPNG())
    return file
  } finally { if (win && !win.isDestroyed()) win.showInactive() }
}
app.whenReady().then(() => {
  for (const dir of [root, documentsDir, historyDir]) fs.mkdirSync(dir, { recursive: true })
  session.defaultSession.setPermissionRequestHandler((_, permission, cb) => cb(['media', 'display-capture'].includes(permission)))
  session.defaultSession.setPermissionCheckHandler((_, permission) => ['media', 'display-capture'].includes(permission))
  session.defaultSession.setDisplayMediaRequestHandler(async (_, cb) => {
    try { const sources = await desktopCapturer.getSources({ types: ['screen'] }); cb({ video: sources[0], audio: 'loopback' }) } catch { cb({}) }
  })
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({ width: 540, height: 64, x: area.x + Math.round((area.width - 540) / 2), y: area.y + 20, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, hasShadow: false, resizable: false, maximizable: false, fullscreenable: false, title: 'Cue', icon: path.join(__dirname, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.setAlwaysOnTop(true, 'screen-saver'); win.setContentProtection(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide() } })
  win.on('closed', () => { win = null; stopAudio(); answerController?.abort() })
  tray = new Tray(path.join(__dirname, 'icon.png')); tray.setToolTip('Cue overlay')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show Cue', click: showOverlay }, { label: 'Stop listening', click: () => { emit('stop-recording'); stopAudio() } }, { type: 'separator' }, { label: 'Quit Cue', click: () => app.quit() }]))
  tray.on('double-click', showOverlay)
  globalShortcut.register('CommandOrControl+Return', () => emit('ask-now'))
  globalShortcut.register('CommandOrControl+Shift+Space', () => emit('screenshot-now'))
  globalShortcut.register('CommandOrControl+\\', () => win.isVisible() ? win.hide() : showOverlay())
  globalShortcut.register('CommandOrControl+Shift+\\', () => { emit('stop-recording'); stopAudio() })
  globalShortcut.register('CommandOrControl+,', () => { showOverlay(); emit('settings-now') })
  globalShortcut.register('CommandOrControl+Shift+H', () => { showOverlay(); emit('history-now') })
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { quitting = true; answerController?.abort(); clearShots() })
app.on('will-quit', () => { stopAudio(); globalShortcut.unregisterAll(); tray?.destroy() })
ipcMain.handle('get-config', () => publicConfig(readConfig()))
ipcMain.handle('save-config', (_, raw) => writeConfig(raw))
ipcMain.handle('ask', (_, { question, mode }) => { if (!question?.trim()) throw new Error('Enter a question or record a conversation first.'); return ask(question, mode) })
ipcMain.on('cancel-answer', () => answerController?.abort())
ipcMain.handle('start-audio', (_, roles) => {
  const cfg = readConfig()
  if (!cfg.assemblyai_key) throw new Error('Add your AssemblyAI API key in Settings first.')
  if (!Array.isArray(roles) || roles.some(r => !['You', 'Other speaker'].includes(r))) throw new Error('Invalid audio source.')
  stopAudio(); turns = []; audioActive = true
  for (const role of roles) connectAudio(role, cfg.assemblyai_key)
  return { ok: true }
})
ipcMain.on('audio', (_, role, data) => {
  if (!['You', 'Other speaker'].includes(role)) return
  const ws = sockets[role]
  if (ws?.readyState === WS.OPEN && ws.bufferedAmount < 1048576 && data?.byteLength <= 65536) ws.send(Buffer.from(data))
})
ipcMain.handle('stop-audio', () => stopAudio())
ipcMain.handle('clear-conversation', () => { turns = []; clearShots() })
ipcMain.handle('connect', (_, provider) => subscription.connect(root, provider, text => emit('connection-log', provider, text)))
ipcMain.handle('connection-status', (_, provider) => { if (!['openai', 'claude'].includes(provider)) return { connected: false }; return subscription.status(root, provider) })
ipcMain.handle('import-profile', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cue profile', extensions: ['json'] }] })
  if (result.canceled) return null
  const stat = fs.statSync(result.filePaths[0]); if (stat.size > 1048576) throw new Error('Profile is too large.')
  const profile = validateProfile(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')))
  writeConfig({ profile }); return profile
})
ipcMain.handle('export-profile', async () => {
  const result = await dialog.showSaveDialog(win, { defaultPath: 'cue-profile.json', filters: [{ name: 'Cue profile', extensions: ['json'] }] })
  if (result.canceled) return false
  fs.writeFileSync(result.filePath, JSON.stringify({ profile: readConfig().profile }, null, 2)); return true
})
ipcMain.handle('import-document', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text and Markdown', extensions: ['txt', 'md'] }] })
  if (result.canceled) return documents()
  for (const file of result.filePaths) {
    if (!/\.(txt|md)$/i.test(file) || fs.statSync(file).size > 262144) throw new Error('Use .txt or .md documents smaller than 256 KB.')
    fs.copyFileSync(file, path.join(documentsDir, path.basename(file)))
  }
  return documents()
})
ipcMain.handle('documents', () => documents())
ipcMain.handle('remove-document', (_, name) => { if (typeof name !== 'string' || path.basename(name) !== name || !/\.(txt|md)$/i.test(name)) throw new Error('Invalid document name.'); fs.unlinkSync(path.join(documentsDir, name)); return documents() })
ipcMain.handle('history', () => fs.readdirSync(historyDir).filter(n => n.endsWith('.json')).map(n => { try { return JSON.parse(fs.readFileSync(path.join(historyDir, n), 'utf8')) } catch { return null } }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30))
ipcMain.handle('open-data', () => shell.openPath(root))
ipcMain.handle('open-link', (_, url) => { const u = new URL(url); if (u.protocol !== 'https:' || !['auth.openai.com', 'platform.openai.com', 'www.assemblyai.com', 'platform.claude.com', 'code.claude.com', 'chatgpt.com'].includes(u.hostname)) throw new Error('Unsupported link.'); return shell.openExternal(u.href) })
ipcMain.handle('compact', () => setExpanded(compact))
ipcMain.handle('set-expanded', (_, expanded) => setExpanded(Boolean(expanded)))
ipcMain.handle('hide', () => win.hide())
ipcMain.handle('privacy', (_, enabled) => { win.setContentProtection(Boolean(enabled)); return Boolean(enabled) })
ipcMain.handle('capture', async () => { if (shots.length >= 4) throw new Error('Solve or clear the four captured screens first.'); shots.push(await captureImage()); return shots.length })
ipcMain.handle('solve', async (_, { question, mode }) => {
  if (!shots.length) throw new Error('Capture a screen first.')
  if (answerController) throw new Error('Stop the current answer first.')
  const captured = shots; shots = []
  try { await ask(question || 'Solve the question shown in these screens.', mode, captured) }
  finally { for (const file of captured) fs.rmSync(file, { force: true }) }
})
ipcMain.handle('export-transcript', async () => {
  const result = await dialog.showSaveDialog(win, { defaultPath: 'cue-transcript.txt', filters: [{ name: 'Text', extensions: ['txt'] }] })
  if (result.canceled) return false
  fs.writeFileSync(result.filePath, turns.map(t => `${t.role}: ${t.text}`).join('\n\n')); return true
})
ipcMain.handle('screenshot', async (_, { question, mode }) => {
  if (answerController) throw new Error('Stop the current answer first.')
  let file
  try {
    file = await captureImage()
    await ask(question || 'Answer the question visible on this screen.', mode, [file])
  } finally { if (file) fs.rmSync(file, { force: true }) }
})
