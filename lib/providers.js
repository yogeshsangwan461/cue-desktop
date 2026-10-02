'use strict'
function makeRequest(cfg, system, prompt, images = []) {
  if (cfg.provider === 'openai') {
    if (!cfg.openai_api_key) throw new Error('Add your OpenAI API key in Settings.')
    return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${cfg.openai_api_key}` }, body: {
      model: cfg.openaiApiModel, instructions: system, stream: true, store: false,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(data => ({ type: 'input_image', image_url: `data:image/png;base64,${data}` }))] }]
    } }
  }
  if (cfg.provider === 'claude') {
    if (!cfg.claude_api_key) throw new Error('Add your Claude API key in Settings.')
    return { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': cfg.claude_api_key, 'anthropic-version': '2023-06-01' }, body: {
      model: cfg.claudeApiModel, system, max_tokens: 4096, stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }))] }]
    } }
  }
  if (!cfg.customBaseUrl || !cfg.customModel) throw new Error('Enter the other provider’s API base URL and model ID.')
  const u = new URL(cfg.customBaseUrl)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Remote providers require HTTPS.')
  if (!cfg.custom_api_key && u.protocol === 'https:') throw new Error('Add the other provider’s API key.')
  return { url: cfg.customBaseUrl.replace(/\/+$/, '') + '/chat/completions', headers: cfg.custom_api_key ? { Authorization: `Bearer ${cfg.custom_api_key}` } : {}, body: {
    model: cfg.customModel, stream: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: images.length ? [{ type: 'text', text: prompt }, ...images.map(data => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }))] : prompt }]
  } }
}
function eventDelta(event) {
  if (event.type === 'error' || event.type === 'response.failed') throw new Error(event.error?.message || event.response?.error?.message || event.message || 'The provider could not complete the response.')
  if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') return event.delta || ''
  if (event.type === 'content_block_delta') return event.delta?.text || ''
  return event.choices?.[0]?.delta?.content || ''
}
async function streamApi(cfg, system, prompt, images, onDelta, signal) {
  const req = makeRequest(cfg, system, prompt, images)
  const res = await fetch(req.url, { method: 'POST', headers: { ...req.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal, redirect: 'error' })
  if (!res.ok) {
    // Never return a request body or headers in an error (they may contain secrets).
    throw new Error(`Provider returned HTTP ${res.status}. Check your key, model access, balance, and endpoint.`)
  }
  const decoder = new TextDecoder()
  let buffer = '', received = false
  const consume = line => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let event
    try { event = JSON.parse(data) } catch { return }
    const delta = eventDelta(event)
    if (delta) { received = true; onDelta(delta) }
  }
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop()
    for (const line of lines) consume(line.replace(/\r$/, ''))
  }
  buffer += decoder.decode(); consume(buffer)
  if (!received) throw new Error('The provider returned no answer. Check that the selected model supports this API.')
}
module.exports = { makeRequest, eventDelta, streamApi }
