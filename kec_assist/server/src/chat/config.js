import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const API_PORT = Number(process.env.PORT || 8787)
export const OPENCODE_HOSTNAME = process.env.OPENCODE_HOSTNAME || '127.0.0.1'
export const OPENCODE_PORT_RAW = process.env.OPENCODE_PORT
const opencodePortIsAuto = OPENCODE_PORT_RAW === 'auto'
export const OPENCODE_PORT = opencodePortIsAuto || !OPENCODE_PORT_RAW ? null : Number(OPENCODE_PORT_RAW)
export const OPENCODE_STARTUP_TIMEOUT_MS = Number(process.env.OPENCODE_STARTUP_TIMEOUT_MS || 30_000)
export const OPENCODE_EAGER_START = 1

export const CHAT_DEFAULT_PROVIDER_ID = process.env.CHAT_DEFAULT_PROVIDER_ID || 'opencode'
export const CHAT_DEFAULT_MODEL_ID = process.env.CHAT_DEFAULT_MODEL_ID || 'kimi-k2.5-free'

export const DEBUG_CHAT_TIMING = process.env.DEBUG_CHAT_TIMING === '1'
export const MCP_STORE_PATH = process.env.MCP_STORE_PATH || path.resolve(__dirname, '..', 'mcp-configs.json')
