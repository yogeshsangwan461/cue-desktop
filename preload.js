'use strict'
const { contextBridge, ipcRenderer } = require('electron')
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args)
contextBridge.exposeInMainWorld('cue', {
  getConfig: invoke('get-config'), saveConfig: invoke('save-config'), importProfile: invoke('import-profile'),
  exportProfile: invoke('export-profile'), importDocument: invoke('import-document'), documents: invoke('documents'), removeDocument: invoke('remove-document'),
  ask: invoke('ask'), screenshot: invoke('screenshot'), startAudio: invoke('start-audio'), stopAudio: invoke('stop-audio'),
  connect: invoke('connect'), connectionStatus: invoke('connection-status'), history: invoke('history'),
  openData: invoke('open-data'), openLink: invoke('open-link'), compact: invoke('compact'), privacy: invoke('privacy'),
  setExpanded: invoke('set-expanded'), hide: invoke('hide'), capture: invoke('capture'), solve: invoke('solve'), exportTranscript: invoke('export-transcript'),
  audio: (role, data) => ipcRenderer.send('audio', role, data), clearConversation: invoke('clear-conversation'), cancel: () => ipcRenderer.send('cancel-answer'),
  on: (event, fn) => { if (['answer-start', 'answer-delta', 'answer-end', 'error', 'transcript', 'audio-status', 'connection-log', 'ask-now', 'compact-state', 'stop-recording', 'screenshot-now', 'settings-now', 'history-now'].includes(event)) ipcRenderer.on(event, (_, ...args) => fn(...args)) }
})
