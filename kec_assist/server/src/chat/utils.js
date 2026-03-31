export function unwrap(result) {
  if (!result || typeof result !== 'object') return result
  if ('data' in result && result.data !== undefined) return result.data
  if ('body' in result && result.body !== undefined) return result.body
  return result
}

export async function withTimeout(promise, timeoutMs, label) {
  const ms = Number(timeoutMs)
  if (!ms || ms <= 0) return await promise

  return await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || 'Operation'} timed out after ${ms}ms`)), ms)),
  ])
}

export async function fetchJson(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl).toString()
  const res = await fetch(url, { headers: { Accept: 'application/json' } })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenCode HTTP ${res.status} for ${url}${text ? `: ${text}` : ''}`)
  }

  return res.json()
}

export function extractText(parts) {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

export function writeNdjson(res, obj) {
  res.write(`${JSON.stringify(obj)}\n`)
}

export function wantsStructuredOutput(message) {
  const text = String(message || '').toLowerCase()
  return (
    text.includes('tabular') ||
    text.includes('table') ||
    text.includes('json') ||
    text.includes('schema') ||
    text.includes('rule') ||
    text.includes('regulation')
  )
}

export function redactSecrets(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactSecrets)

  const out = {}
  for (const [key, nextValue] of Object.entries(value)) {
    const normalized = String(key).toLowerCase()
    if (normalized === 'key' || normalized === 'apikey' || normalized === 'api_key' || normalized === 'token' || normalized.endsWith('_token')) {
      continue
    }
    out[key] = redactSecrets(nextValue)
  }

  return out
}

export function normalizeProvidersPayload(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : []
  const defaults = payload?.default && typeof payload.default === 'object' ? payload.default : {}
  return { providers, defaults }
}

export function normalizeModelList(provider) {
  if (!provider || typeof provider !== 'object') return []
  const models = provider.models
  if (!models) return []
  const list = Array.isArray(models) ? models : Object.values(models)
  return list.filter((model) => model && typeof model === 'object' && model.id)
}
