import 'dotenv/config'

import cors from 'cors'
import express from 'express'

import { API_PORT, DEBUG_CHAT_TIMING, OPENCODE_EAGER_START, OPENCODE_HOSTNAME, OPENCODE_PORT } from './chat/config.js'
import { buildPromptBody } from './chat/chatBody.js'
import { allowedMcpServersForRole, deriveRole, filterToolsForRole } from './chat/rolePolicy.js'
import {
  getDefaultChatModel,
  getEnabledMcpServers,
  getMcpConfigsFromOpencode,
  getMcpStorePath,
  getMcpToolPolicy,
  getOpencode,
  getStoredMcpServerNames,
  initMcpSynchronization,
  listMcpToolsFromConfig,
  resolveStoredMcpConfig,
  setMcpConfig,
} from './chat/runtime.js'
import { extractText, fetchJson, redactSecrets, unwrap, writeNdjson } from './chat/utils.js'

const STUDENT_FALLBACK_MESSAGE = 'I do not have sufficient permission or data to answer this.'
const STUDENT_BLOCKED_REPLY_PATTERN =
  /\b(portal|website|handbook|advisor|department|office|admin|policy|faculty|staff|teacher|web|internet|external)\b|general practice|typically available|check (the|your)\b|refer to\b|contact\b/i

function sanitizeStudentReply(text) {
  const raw = String(text || '').trim()
  if (!raw) return STUDENT_FALLBACK_MESSAGE
  if (STUDENT_BLOCKED_REPLY_PATTERN.test(raw)) return STUDENT_FALLBACK_MESSAGE
  if (raw === STUDENT_FALLBACK_MESSAGE) return raw
  return raw
}

await initMcpSynchronization()

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(cors({ origin: true }))

app.get('/', (_req, res) => {
  res.type('text/plain').send('OK. Try /api/health')
})

app.get('/api/health', async (_req, res) => {
  try {
    const { server } = await getOpencode()
    const health = await fetchJson(server.url, '/global/health')
    res.json({ ok: true, opencode: health, server: { url: server.url } })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/models', async (_req, res) => {
  try {
    const { client } = await getOpencode()
    const providers = unwrap(await client.config.providers())
    res.json({ ok: true, providers: redactSecrets(providers) })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/mcp/status', async (_req, res) => {
  try {
    const { client } = await getOpencode()
    const status = unwrap(await client.mcp.status())
    res.json({ ok: true, status })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.post('/api/mcp/add', async (req, res) => {
  try {
    const { name, config } = req.body || {}
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ ok: false, error: "Missing 'name'" })
      return
    }
    if (!config || typeof config !== 'object') {
      res.status(400).json({ ok: false, error: "Missing 'config'" })
      return
    }

    const { client } = await getOpencode()
    const status = unwrap(await client.mcp.add({ body: { name: name.trim(), config } }))

    await setMcpConfig(name.trim(), config)
    res.json({ ok: true, status })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.post('/api/mcp/connect', async (req, res) => {
  try {
    const { name } = req.body || {}
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ ok: false, error: "Missing 'name'" })
      return
    }

    const { client } = await getOpencode()
    const result = unwrap(await client.mcp.connect({ path: { name: name.trim() } }))
    res.json({ ok: true, result })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.post('/api/mcp/disconnect', async (req, res) => {
  try {
    const { name } = req.body || {}
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ ok: false, error: "Missing 'name'" })
      return
    }

    const { client } = await getOpencode()
    const result = unwrap(await client.mcp.disconnect({ path: { name: name.trim() } }))
    res.json({ ok: true, result })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/mcp/tools', async (req, res) => {
  try {
    const role = deriveRole(req)
    const name = (req.query?.name || '').toString().trim()
    if (!name) {
      res.status(400).json({ ok: false, error: 'Missing query param: name' })
      return
    }

    const { baseName, config: fromStore } = resolveStoredMcpConfig(name) || {}

    const { client } = await getOpencode()
    const mcpConfigs = await getMcpConfigsFromOpencode(client)
    const fromOpencode = mcpConfigs?.[name] || (baseName && baseName !== name ? mcpConfigs?.[baseName] : undefined)
    const config = fromStore || fromOpencode

    if (!config) {
      res.status(404).json({
        ok: false,
        error: `No MCP config found for '${name}'. If this server was not added via this UI, add it here (MCP -> Add server) so we know how to reach it.`,
      })
      return
    }

    const tools = await listMcpToolsFromConfig(name, config)
    res.json({ ok: true, name, tools: filterToolsForRole(role, tools) })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/mcp/config', async (_req, res) => {
  try {
    const { client } = await getOpencode()
    const cfg = unwrap(await client.config.get())
    const mcp = await getMcpConfigsFromOpencode(client)

    res.json({
      ok: true,
      storePath: getMcpStorePath(),
      stored: getStoredMcpServerNames(),
      opencodeMcp: redactSecrets(mcp || cfg),
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/tools', async (req, res) => {
  try {
    const role = deriveRole(req)
    const provider = (req.query?.provider || '').toString().trim()
    const model = (req.query?.model || '').toString().trim()

    if (!provider || !model) {
      res.status(400).json({ ok: false, error: 'Missing query params: provider, model' })
      return
    }

    const { client } = await getOpencode()
    const tools = unwrap(await client.tool.list({ query: { provider, model } }))
    res.json({ ok: true, tools: filterToolsForRole(role, tools) })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/tool-ids', async (req, res) => {
  try {
    const role = deriveRole(req)
    const { client } = await getOpencode()
    const ids = unwrap(await client.tool.ids())
    res.json({ ok: true, ids: filterToolsForRole(role, ids) })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/agents', async (_req, res) => {
  try {
    const { client } = await getOpencode()
    const agents = unwrap(await client.app.agents())
    res.json({ ok: true, agents })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.get('/api/thread/:id/messages', async (req, res) => {
  try {
    const { client } = await getOpencode()
    const sessionId = req.params.id
    const messages = unwrap(await client.session.messages({ path: { id: sessionId } }))

    const normalized = (messages || []).map((message) => {
      const info = message?.info
      const parts = message?.parts
      return {
        id: info?.id,
        role: info?.role,
        createdAt: info?.createdAt,
        text: extractText(parts),
        parts,
      }
    })

    res.json({ ok: true, threadId: sessionId, messages: normalized })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.post('/api/chat', async (req, res) => {
  try {
    const t0 = Date.now()
    const { threadId, message, model, title, agent, mode } = req.body || {}
    const role = deriveRole(req)

    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ ok: false, error: "Missing 'message'" })
      return
    }

    if (role === 'STUDENT' && /\bfaculty\b|\bstaff\b|\bteacher\b/i.test(message)) {
      res.status(403).json({ ok: false, error: 'Access denied for faculty content' })
      return
    }

    const { client } = await getOpencode()

    let sessionId = threadId
    if (!sessionId) {
      const created = unwrap(await client.session.create({ body: { title: title || 'Chat' } }))
      sessionId = created?.id
    }

    const allowedServers = allowedMcpServersForRole(role, getEnabledMcpServers())
    const { body, normalizedMode } = await buildPromptBody({
      message,
      role,
      mode,
      agent,
      model,
      mcpToolPolicy: getMcpToolPolicy(),
      allowedServers,
      getDefaultChatModel,
      opencodeClient: client,
    })

    const assistant = unwrap(await client.session.prompt({ path: { id: sessionId }, body }))
    const replyText = role === 'STUDENT' ? sanitizeStudentReply(extractText(assistant?.parts)) : extractText(assistant?.parts)
    const assistantError = assistant?.info?.error || null

    res.json({
      ok: true,
      threadId: sessionId,
      reply: replyText,
      assistantError,
      assistant,
    })

    if (DEBUG_CHAT_TIMING) {
      const mid = body?.model ? `${body.model.providerID}/${body.model.modelID}` : '(default)'
      console.log(`[timing] chat_ms=${Date.now() - t0} session=${sessionId} mode=${normalizedMode} agent=${body.agent || '(default)'} model=${mid}`)
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || error) })
  }
})

app.post('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    const t0 = Date.now()
    const { threadId, message, model, title, agent, mode } = req.body || {}
    const role = deriveRole(req)

    if (typeof message !== 'string' || !message.trim()) {
      res.status(400)
      writeNdjson(res, { type: 'error', error: "Missing 'message'" })
      res.end()
      return
    }

    if (role === 'STUDENT' && /\bfaculty\b|\bstaff\b|\bteacher\b/i.test(message)) {
      writeNdjson(res, { type: 'error', error: 'Access denied for faculty content' })
      writeNdjson(res, { type: 'done' })
      res.end()
      return
    }

    const { client } = await getOpencode()

    let sessionId = threadId
    if (!sessionId) {
      const created = unwrap(await client.session.create({ body: { title: title || 'Chat' } }))
      sessionId = created?.id
    }

    const allowedServers = allowedMcpServersForRole(role, getEnabledMcpServers())
    const { body, normalizedMode } = await buildPromptBody({
      message,
      role,
      mode,
      agent,
      model,
      mcpToolPolicy: getMcpToolPolicy(),
      allowedServers,
      getDefaultChatModel,
      opencodeClient: client,
    })

    writeNdjson(res, { type: 'meta', threadId: sessionId })

    if (role === 'STUDENT') {
      const assistant = unwrap(await client.session.prompt({ path: { id: sessionId }, body }))
      const replyText = sanitizeStudentReply(extractText(assistant?.parts))
      writeNdjson(res, { type: 'delta', text: replyText })
      writeNdjson(res, { type: 'done' })
      res.end()
      return
    }

    const abort = new AbortController()
    req.on('close', () => abort.abort())

    const timeoutMs = 120_000
    const timeoutId = setTimeout(() => abort.abort(), timeoutMs)

    let sawDelta = false
    let firstDeltaMs = null
    let aborted = false
    let sessionError = null
    let promptError = null
    const seenToolCalls = new Set()

    try {
      const subscription = await client.event.subscribe({ signal: abort.signal })

      const promptPromise = client.session.promptAsync({ path: { id: sessionId }, body }).catch((error) => {
        promptError = error
      })

      for await (const evt of subscription.stream) {
        if (!evt || typeof evt !== 'object') continue

        if (evt.type === 'message.part.updated') {
          const part = evt.properties?.part
          const delta = evt.properties?.delta

          if (part && part.sessionID === sessionId && part.type === 'text' && typeof delta === 'string' && delta) {
            sawDelta = true
            if (firstDeltaMs === null) firstDeltaMs = Date.now() - t0
            writeNdjson(res, { type: 'delta', text: delta })
          }

          if (part && part.sessionID === sessionId && part.type === 'tool') {
            const callId = part.callID || part.id || `${part.tool}-${part.messageID || ''}`
            if (!seenToolCalls.has(callId)) {
              seenToolCalls.add(callId)
            }

            writeNdjson(res, {
              type: 'tool',
              callId,
              tool: part.tool,
              status: part.state?.status || 'unknown',
              title: part.state?.title,
            })
          }
        }

        if (evt.type === 'session.error') {
          const sid = evt.properties?.sessionID
          if (!sid || sid === sessionId) {
            sessionError = evt.properties?.error || { message: 'session.error' }
          }
        }

        if (evt.type === 'session.idle' && evt.properties?.sessionID === sessionId) {
          break
        }
      }

      await promptPromise
    } catch (error) {
      aborted = abort.signal.aborted
      if (!aborted) {
        writeNdjson(res, { type: 'error', error: String(error?.message || error) })
      }
    } finally {
      clearTimeout(timeoutId)
    }

    if (promptError && !sessionError && !abort.signal.aborted) {
      writeNdjson(res, { type: 'assistant_error', error: { message: String(promptError?.message || promptError) } })
    }

    if (!sawDelta && !abort.signal.aborted) {
      try {
        const messages = unwrap(await client.session.messages({ path: { id: sessionId } }))
        const last = Array.isArray(messages) ? messages[messages.length - 1] : null
        const replyText = extractText(last?.parts) || ''
        if (replyText) {
          writeNdjson(res, { type: 'delta', text: replyText })
          sawDelta = true
        }
      } catch {
        // Ignore fallback read failure.
      }
    }

    if (!abort.signal.aborted) {
      try {
        const messages = unwrap(await client.session.messages({ path: { id: sessionId } }))
        const last = Array.isArray(messages) ? messages[messages.length - 1] : null
        const parts = Array.isArray(last?.parts) ? last.parts : []

        for (const part of parts) {
          if (part?.type !== 'tool') continue

          const callId = part.callID || part.id || `${part.tool}-${part.messageID || ''}`
          if (seenToolCalls.has(callId)) continue
          seenToolCalls.add(callId)

          writeNdjson(res, {
            type: 'tool',
            callId,
            tool: part.tool,
            status: part.state?.status || 'unknown',
            title: part.state?.title,
          })
        }
      } catch {
        // Ignore fallback tool read failure.
      }
    }

    if (sessionError) {
      writeNdjson(res, { type: 'assistant_error', error: sessionError })
    } else if (!sawDelta && aborted) {
      writeNdjson(res, { type: 'error', error: `Timed out after ${Math.round(timeoutMs / 1000)}s` })
    }

    writeNdjson(res, { type: 'done' })
    res.end()

    if (DEBUG_CHAT_TIMING) {
      const chosenModel = body?.model ? `${body.model.providerID}/${body.model.modelID}` : '(default)'
      console.log(`[timing] stream_total_ms=${Date.now() - t0} first_delta_ms=${firstDeltaMs ?? 'null'} saw_delta=${sawDelta} session=${sessionId} mode=${normalizedMode} agent=${body.agent || '(default)'} model=${chosenModel}`)
    }
  } catch (error) {
    try {
      res.status(500)
      writeNdjson(res, { type: 'error', error: String(error?.message || error) })
      writeNdjson(res, { type: 'done' })
      res.end()
    } catch {
      // Ignore response close error.
    }
  }
})

app.listen(API_PORT, () => {
  console.log(`API listening on http://localhost:${API_PORT}`)
  const portHint = OPENCODE_PORT === null ? 'auto' : OPENCODE_PORT

  if (OPENCODE_EAGER_START) {
    console.log(`Starting OpenCode now (target http://${OPENCODE_HOSTNAME}:${portHint})`)
    getOpencode().catch((error) => {
      console.error('Failed to start OpenCode:', error)
      console.error('If you want to start OpenCode only when needed, set OPENCODE_EAGER_START=0')
    })
  } else {
    console.log(`OpenCode server is started lazily on first /api/* call (target http://${OPENCODE_HOSTNAME}:${portHint})`)
  }
})
