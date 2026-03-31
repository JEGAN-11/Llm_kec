import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import { createOpencodeClient } from '@opencode-ai/sdk'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import {
  CHAT_DEFAULT_MODEL_ID,
  CHAT_DEFAULT_PROVIDER_ID,
  DEBUG_CHAT_TIMING,
  MCP_STORE_PATH,
  OPENCODE_HOSTNAME,
  OPENCODE_PORT,
  OPENCODE_PORT_RAW,
  OPENCODE_STARTUP_TIMEOUT_MS,
} from './config.js'
import { normalizeModelList, normalizeProvidersPayload, unwrap, withTimeout } from './utils.js'

let opencodePromise
let opencodeProc
let opencodeBaseUrl

const mcpConfigStore = new Map()
let mcpWatcherStarted = false
let mcpSyncInFlight = null
let mcpToolPolicy = null
let resolvedDefaultChatModel = null

function debounce(fn, delayMs) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }
}

async function loadMcpStore({ replace = false } = {}) {
  try {
    const raw = await fs.readFile(MCP_STORE_PATH, 'utf8')
    const json = JSON.parse(raw)
    const servers = json?.servers
    const tools = json?.tools

    if (servers && typeof servers === 'object') {
      if (replace) mcpConfigStore.clear()
      for (const [name, config] of Object.entries(servers)) {
        if (typeof name === 'string' && name.trim() && config && typeof config === 'object') {
          mcpConfigStore.set(name, config)
        }
      }
    }

    if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
      mcpToolPolicy = { ...tools }
    } else if (replace) {
      mcpToolPolicy = null
    }

    return true
  } catch {
    return false
  }
}

async function saveMcpStore() {
  const servers = Object.fromEntries(mcpConfigStore.entries())
  const payload = { version: 1, servers }

  if (mcpToolPolicy && typeof mcpToolPolicy === 'object') {
    payload.tools = mcpToolPolicy
  }

  await fs.writeFile(MCP_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeMcpConfigs(configRoot) {
  const candidates = [
    configRoot?.mcp,
    configRoot?.mcpServers,
    configRoot?.mcp_servers,
    configRoot?.experimental?.mcp,
    configRoot?.mcp?.servers,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue

    if (Array.isArray(candidate)) {
      const out = {}
      for (const entry of candidate) {
        if (!entry || typeof entry !== 'object') continue
        const name = typeof entry.name === 'string' ? entry.name.trim() : ''
        if (!name) continue
        out[name] = entry
      }
      if (Object.keys(out).length) return out
      continue
    }

    if (candidate && typeof candidate === 'object') {
      if (candidate.servers && typeof candidate.servers === 'object' && !Array.isArray(candidate.servers)) {
        return candidate.servers
      }
      return candidate
    }
  }

  return {}
}

async function syncMcpFromStoreIntoOpencode(opencodeClient) {
  if (mcpSyncInFlight) return await mcpSyncInFlight

  mcpSyncInFlight = (async () => {
    const entries = Array.from(mcpConfigStore.entries())
    if (!entries.length) return

    for (const [name, config] of entries) {
      if (typeof name !== 'string' || !name.trim()) continue
      if (!config || typeof config !== 'object') continue

      try {
        await opencodeClient.mcp.add({ body: { name, config } })
      } catch {
        // Ignore invalid/unreachable MCP configs.
      }

      const enabled = config.enabled !== false
      if (!enabled) {
        try {
          await opencodeClient.mcp.disconnect({ path: { name } })
        } catch {
          // Ignore disconnect failures.
        }
        continue
      }

      try {
        await opencodeClient.mcp.connect({ path: { name } })
      } catch {
        // Ignore connect failures.
      }
    }
  })().finally(() => {
    mcpSyncInFlight = null
  })

  return await mcpSyncInFlight
}

async function getFreePort(hostname) {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => resolve(port))
    })
  })
}

async function isPortAvailable(hostname, port) {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, hostname, () => {
      server.close(() => resolve(true))
    })
  })
}

async function startOpencodeServer() {
  if (opencodeBaseUrl) return opencodeBaseUrl

  const t0 = Date.now()

  let port = OPENCODE_PORT ?? (await getFreePort(OPENCODE_HOSTNAME))
  if (!port) {
    throw new Error('Failed to allocate a free port for OpenCode server')
  }

  if (OPENCODE_PORT !== null) {
    const available = await isPortAvailable(OPENCODE_HOSTNAME, port)
    if (!available) {
      const explicitlySet = typeof OPENCODE_PORT_RAW === 'string' && OPENCODE_PORT_RAW.length > 0
      if (explicitlySet) {
        throw new Error(`OpenCode port ${port} is already in use. Free that port or set OPENCODE_PORT=auto (or another free port).`)
      }

      const fallback = await getFreePort(OPENCODE_HOSTNAME)
      if (!fallback) {
        throw new Error('Failed to allocate a free port for OpenCode server')
      }

      console.warn(`OpenCode port ${port} is in use; falling back to free port ${fallback}`)
      port = fallback
    }
  }

  const args = ['serve', `--hostname=${OPENCODE_HOSTNAME}`, `--port=${port}`]
  const env = { ...process.env }

  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', 'npx', '--no-install', 'opencode-ai', ...args], { env })
      : spawn('npx', ['--no-install', 'opencode-ai', ...args], { env })

  opencodeProc = child

  const url = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for OpenCode server to start after ${OPENCODE_STARTUP_TIMEOUT_MS}ms`))
    }, OPENCODE_STARTUP_TIMEOUT_MS)

    let output = ''
    const onChunk = (chunk) => {
      output += chunk.toString()
      const lines = output.split('\n')
      for (const line of lines) {
        if (!line.startsWith('opencode server listening')) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) continue
        clearTimeout(timeoutId)
        resolve(match[1])
        return
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('exit', (code) => {
      clearTimeout(timeoutId)
      let message = `OpenCode server exited with code ${code}`
      if (output.trim()) message += `\nOutput: ${output}`
      reject(new Error(message))
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
  })

  opencodeBaseUrl = url
  console.log(`OpenCode server started at ${opencodeBaseUrl}`)

  if (DEBUG_CHAT_TIMING) {
    console.log(`[timing] opencode_start_ms=${Date.now() - t0}`)
  }

  return url
}

export async function getOpencode() {
  if (!opencodePromise) {
    opencodePromise = (async () => {
      const baseUrl = await startOpencodeServer()
      const client = createOpencodeClient({ baseUrl })

      try {
        await syncMcpFromStoreIntoOpencode(client)
      } catch {
        // Ignore MCP sync startup failures.
      }

      return {
        client,
        server: {
          url: baseUrl,
          close() {
            opencodeProc?.kill()
          },
        },
      }
    })().catch((error) => {
      opencodePromise = undefined
      throw error
    })
  }

  return opencodePromise
}

export async function getMcpConfigsFromOpencode(client) {
  const cfg = unwrap(await client.config.get())
  return normalizeMcpConfigs(cfg)
}

export async function listMcpToolsFromConfig(name, config) {
  const client = new McpClient({ name: 'opencode-chat-ui', version: '1.0.0' }, { capabilities: {} })

  let transport
  if (config?.type === 'remote') {
    const url = config?.url
    if (typeof url !== 'string' || !url.trim()) throw new Error(`MCP server '${name}' missing url`)
    const headers = config?.headers && typeof config.headers === 'object' ? config.headers : undefined
    transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: headers ? { headers } : undefined,
    })
  } else if (config?.type === 'local') {
    const cmd = Array.isArray(config?.command) ? config.command : null
    if (!cmd || cmd.length === 0) throw new Error(`MCP server '${name}' missing command`)

    const env = config?.environment && typeof config.environment === 'object' ? config.environment : undefined
    transport = new StdioClientTransport({
      command: String(cmd[0]),
      args: cmd.slice(1).map(String),
      env,
      cwd: process.cwd(),
      stderr: 'pipe',
    })
  } else {
    throw new Error(`Unsupported MCP config type for '${name}'`)
  }

  try {
    await client.connect(transport)
    const timeoutMs = Number(config?.timeout || 5000)
    const result = await withTimeout(client.listTools(), timeoutMs, `List MCP tools for '${name}'`)
    return result?.tools || []
  } finally {
    try {
      await transport.close()
    } catch {
      // Ignore transport close failure.
    }
  }
}

export async function getDefaultChatModel(client) {
  if (resolvedDefaultChatModel) return resolvedDefaultChatModel

  const payload = unwrap(await client.config.providers())
  const { providers, defaults } = normalizeProvidersPayload(payload)
  if (!providers.length) return null

  const provider =
    providers.find((entry) => entry?.id === CHAT_DEFAULT_PROVIDER_ID) ||
    providers.find((entry) => /opencode/i.test(String(entry?.id || entry?.name || ''))) ||
    providers[0]

  if (!provider?.id) return null

  const models = normalizeModelList(provider)
  const preferredById = models.find((entry) => String(entry.id) === CHAT_DEFAULT_MODEL_ID)
  const preferredByName =
    models.find((entry) => /kimi/i.test(String(entry?.name || '')) && /(2\.?5|k2\.?5)/i.test(String(entry?.name || ''))) ||
    models.find((entry) => /kimi/i.test(String(entry?.id || '')) && /(2\.?5|k2\.?5)/i.test(String(entry?.id || '')))

  const providerDefault = defaults?.[provider.id]
    ? models.find((entry) => String(entry.id) === String(defaults[provider.id]))
    : null

  const chosen = preferredById || preferredByName || providerDefault || models[0]
  if (!chosen?.id) return null

  resolvedDefaultChatModel = {
    providerID: String(provider.id),
    modelID: String(chosen.id),
  }

  return resolvedDefaultChatModel
}

export function getMcpStorePath() {
  return MCP_STORE_PATH
}

export function getStoredMcpServerNames() {
  return Array.from(mcpConfigStore.keys())
}

export function getEnabledMcpServers() {
  return Array.from(mcpConfigStore.entries())
    .filter(([, cfg]) => cfg && typeof cfg === 'object' && cfg.enabled !== false)
    .map(([name]) => name)
}

export function getMcpToolPolicy() {
  return mcpToolPolicy
}

export async function setMcpConfig(name, config) {
  mcpConfigStore.set(name, config)
  await saveMcpStore()
}

export function resolveStoredMcpConfig(name) {
  if (!name) return null
  const trimmed = String(name).trim()
  if (!trimmed) return null

  const baseName = (() => {
    const match = trimmed.match(/^(.*):\d+$/)
    return match ? match[1] : trimmed
  })()

  return {
    baseName,
    config: mcpConfigStore.get(trimmed) || (baseName !== trimmed ? mcpConfigStore.get(baseName) : undefined),
  }
}

export async function initMcpSynchronization() {
  await loadMcpStore({ replace: true })

  if (mcpWatcherStarted) return
  mcpWatcherStarted = true

  const dir = path.dirname(MCP_STORE_PATH)
  const file = path.basename(MCP_STORE_PATH).toLowerCase()

  const onChange = debounce(async () => {
    const ok = await loadMcpStore({ replace: true })
    if (!ok || !opencodePromise) return

    try {
      const { client } = await getOpencode()
      await syncMcpFromStoreIntoOpencode(client)
    } catch {
      // Ignore watcher sync failures.
    }
  }, 300)

  try {
    watch(dir, { persistent: false }, (_eventType, filename) => {
      if (!filename) return
      if (String(filename).toLowerCase() !== file) return
      onChange()
    })
  } catch {
    // Ignore fs watch startup failures.
  }
}
