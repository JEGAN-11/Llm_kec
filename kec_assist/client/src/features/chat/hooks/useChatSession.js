import { useEffect, useState } from 'react'

import { readNdjsonLines } from '../utils/ndjson'

function conversationStorageKey(prefix) {
  return `${prefix}-conversations`
}

function messagesStorageKey(prefix, conversationId) {
  return `${prefix}-messages-${conversationId}`
}

function loadConversations(prefix) {
  try {
    const raw = localStorage.getItem(conversationStorageKey(prefix))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function useChatSession(storagePrefix) {
  const [conversations, setConversations] = useState(() => loadConversations(storagePrefix))
  const [currentConvId, setCurrentConvId] = useState(null)
  const [threadId, setThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [abortController, setAbortController] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(conversationStorageKey(storagePrefix), JSON.stringify(conversations))
    } catch {
      // Ignore localStorage write failures.
    }
  }, [conversations, storagePrefix])

  useEffect(() => {
    if (!currentConvId || messages.length === 0) return

    try {
      localStorage.setItem(
        messagesStorageKey(storagePrefix, currentConvId),
        JSON.stringify({ messages, threadId }),
      )
    } catch {
      // Ignore localStorage write failures.
    }
  }, [currentConvId, messages, threadId, storagePrefix])

  const stopGeneration = () => {
    if (!abortController) return

    abortController.abort()
    setAbortController(null)
    setLoading(false)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setError('')
    setInput('')

    const optimisticUser = { role: 'user', text }
    const assistantIndex = messages.length + 1
    const nextMessages = [...messages, optimisticUser, { role: 'assistant', text: '', tools: [] }]
    setMessages(nextMessages)
    setLoading(true)

    if (!currentConvId && messages.length === 0) {
      const conversationId = Date.now().toString()
      const title = text.slice(0, 40) + (text.length > 40 ? '...' : '')
      setCurrentConvId(conversationId)
      setConversations((prev) => [{ id: conversationId, title, timestamp: new Date() }, ...prev])
    }

    const controller = new AbortController()
    setAbortController(controller)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: text, mode: 'ask', agent: 'general' }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const fallback = await response.text().catch(() => '')
        throw new Error(fallback || `HTTP ${response.status}`)
      }

      const reader = response.body.getReader()

      for await (const event of readNdjsonLines(reader)) {
        if (event?.type === 'meta' && event.threadId && !threadId) {
          setThreadId(event.threadId)
        }

        if (event?.type === 'delta' && typeof event.text === 'string') {
          setMessages((current) => {
            const updated = [...current]
            if (!updated[assistantIndex]) return updated

            updated[assistantIndex] = {
              ...updated[assistantIndex],
              text: (updated[assistantIndex].text || '') + event.text,
            }

            return updated
          })
        }

        if (event?.type === 'tool' && event.tool) {
          setMessages((current) => {
            const updated = [...current]
            const assistant = updated[assistantIndex]
            if (!assistant) return updated

            const tools = Array.isArray(assistant.tools) ? [...assistant.tools] : []
            const existingIndex = tools.findIndex((tool) => tool.callId && tool.callId === event.callId)
            const payload = {
              callId: event.callId,
              tool: event.tool,
              status: event.status || 'unknown',
              title: event.title || '',
            }

            if (existingIndex >= 0) {
              tools[existingIndex] = { ...tools[existingIndex], ...payload }
            } else {
              tools.push(payload)
            }

            updated[assistantIndex] = { ...assistant, tools }
            return updated
          })
        }

        if (event?.type === 'assistant_error' && event.error) {
          const msg =
            event.error?.data?.message ||
            event.error?.message ||
            (typeof event.error === 'string' ? event.error : null) ||
            'Provider/agent error'

          setError(msg)
        }

        if (event?.type === 'error') {
          throw new Error(event.error || 'Chat failed')
        }

        if (event?.type === 'done') break
      }

      setMessages((current) => {
        const updated = [...current]
        const assistant = updated[assistantIndex]

        if (assistant && !String(assistant.text || '').trim()) {
          updated[assistantIndex] = { ...assistant, text: '(no text response)' }
        }

        return updated
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        setMessages((current) => {
          const updated = [...current]

          if (updated[assistantIndex]) {
            updated[assistantIndex] = {
              ...updated[assistantIndex],
              text: `${updated[assistantIndex].text || ''}\n\n_Generation stopped._`,
            }
          }

          return updated
        })
      } else {
        setError(String(err?.message || err))
        setMessages((current) => {
          const updated = [...current]
          if (updated[assistantIndex]) {
            updated[assistantIndex] = { ...updated[assistantIndex], text: 'Sorry - something went wrong.' }
          }
          return updated
        })
      }
    } finally {
      setLoading(false)
      setAbortController(null)
    }
  }

  const newChat = () => {
    setCurrentConvId(null)
    setThreadId(null)
    setMessages([])
    setError('')
  }

  const loadConversation = (conversationId) => {
    setCurrentConvId(conversationId)
    setError('')

    try {
      const raw = localStorage.getItem(messagesStorageKey(storagePrefix, conversationId))
      if (!raw) {
        setMessages([])
        setThreadId(null)
        return
      }

      const parsed = JSON.parse(raw)
      setMessages(parsed.messages || [])
      setThreadId(parsed.threadId || null)
    } catch {
      setMessages([])
      setThreadId(null)
    }
  }

  const deleteConversation = (conversationId, event) => {
    event.stopPropagation()
    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId))

    try {
      localStorage.removeItem(messagesStorageKey(storagePrefix, conversationId))
    } catch {
      // Ignore localStorage cleanup failures.
    }

    if (currentConvId === conversationId) {
      newChat()
    }
  }

  return {
    conversations,
    currentConvId,
    threadId,
    messages,
    input,
    loading,
    error,
    setInput,
    send,
    stopGeneration,
    newChat,
    loadConversation,
    deleteConversation,
  }
}
