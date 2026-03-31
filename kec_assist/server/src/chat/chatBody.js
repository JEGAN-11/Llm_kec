import { KEC_SYSTEM_PROMPT } from './systemPrompt.js'
import { wantsStructuredOutput } from './utils.js'

export async function buildPromptBody({
  message,
  role,
  mode,
  agent,
  model,
  mcpToolPolicy,
  allowedServers,
  getDefaultChatModel,
  opencodeClient,
}) {
  const body = {
    system: KEC_SYSTEM_PROMPT,
    parts: [{ type: 'text', text: String(message || '').trim() }],
  }

  body.system += `
You must never say that you searched the web, checked online sources, or fetched external data. Such capabilities do not exist.`

  if ((role === 'FACULTY' || role === 'ADMIN') && mcpToolPolicy && typeof mcpToolPolicy === 'object') {
    body.tools = mcpToolPolicy
  } else {
    body.tools = mcpToolPolicy || undefined
    body.system += `

You are answering for a STUDENT.
Do NOT access or reference faculty, staff, HR, policy, or administrative content.
If asked, reply: "Access denied for faculty content."`
  }

  if (Array.isArray(allowedServers) && allowedServers.length) {
    const roleLabel = role === 'ADMIN' ? 'ADMIN' : role === 'FACULTY' ? 'FACULTY' : 'STUDENT'
    body.system += `

For this ${roleLabel} session, you may use these MCP servers: ${allowedServers.join(',')}.
Consult every available server that is relevant, aggregate their answers, and surface a single concise reply.
You MUST call the relevant MCP tools for this question before responding.
If the tools return no relevant data, reply: "I do not have sufficient permission or data to answer this."`
  }

  if (model && typeof model === 'object' && model.providerID && model.modelID) {
    body.model = { providerID: String(model.providerID), modelID: String(model.modelID) }
  } else {
    const defaultModel = await getDefaultChatModel(opencodeClient)
    if (defaultModel) body.model = defaultModel
  }

  if (wantsStructuredOutput(message)) {
    body.system += `

If the user asks for tabular output, respond with an HTML <table> element containing appropriate columns based on the data. Use <thead> for headers and <tbody> for rows. Choose column names that match the actual content (e.g., Grade, Travel Mode, Metro DA, Other DA, Duration, etc.). Do not use a fixed schema. Do not include markdown code fences.`
  }

  const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : 'ask'
  if (normalizedMode === 'ask') {
    body.agent = 'general'
  } else if (agent && typeof agent === 'string' && agent.trim()) {
    body.agent = agent.trim()
  }

  return { body, normalizedMode }
}
