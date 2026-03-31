const STUDENT_BLOCKED_TOOL_PATTERNS = [/chroma/i, /policy[_-]?docs?/i, /policy[_-]?documents?/i]

export function deriveRole(req) {
  const headerRole = (req.headers['x-role'] || req.headers['x-user-role'] || '').toString().toUpperCase()
  if (headerRole === 'ADMIN') return 'ADMIN'
  if (headerRole === 'FACULTY') return 'FACULTY'
  return 'STUDENT'
}

export function isBlockedTool(idOrName) {
  const value = String(idOrName || '')
  return STUDENT_BLOCKED_TOOL_PATTERNS.some((pattern) => pattern.test(value))
}

export function filterToolsForRole(role, tools) {
  if (role === 'FACULTY' || role === 'ADMIN') return tools
  if (!Array.isArray(tools)) return tools

  return tools.filter((tool) => {
    if (typeof tool === 'string') return !isBlockedTool(tool)
    if (tool && typeof tool === 'object') {
      const candidate = tool.id || tool.name || tool.tool || tool.title || ''
      return !isBlockedTool(candidate)
    }
    return true
  })
}

export function allowedMcpServersForRole(role, serverNames) {
  const list = Array.isArray(serverNames) ? serverNames : []
  if (role === 'FACULTY' || role === 'ADMIN') return list
  return list.filter((name) => !isBlockedTool(name))
}
