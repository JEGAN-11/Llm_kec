import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'

function extractBoldNumberedItems(text) {
  const splitPattern = /(\*\*\d+(?:\.\d+)*\*\*)/g
  const itemPattern = /^\*\*\d+(?:\.\d+)*\*\*$/
  const parts = String(text || '').split(splitPattern).map((part) => part.trim()).filter(Boolean)
  const items = []

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (!itemPattern.test(part)) continue

    const label = part.replace(/\*\*/g, '')
    const body = parts[i + 1] && !itemPattern.test(parts[i + 1]) ? parts[i + 1] : ''
    items.push({ label, body })

    if (body) i += 1
  }

  return items.length > 1 ? items : null
}

function extractJsonPayload(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const tryParse = (candidate) => {
    if (!candidate) return null
    try {
      return JSON.parse(candidate)
    } catch {
      return null
    }
  }

  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1])
    if (parsed) return parsed
  }

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    const parsed = tryParse(raw)
    if (parsed && typeof parsed === 'object') return parsed
  }

  return null
}

function renderStructuredPayload(payload) {
  if (!payload || typeof payload !== 'object') return null

  if (Array.isArray(payload) && payload.length && payload.every((row) => row && typeof row === 'object')) {
    const headers = Object.keys(payload[0] || {})
    if (!headers.length) return null

    return (
      <table className="formattedTable">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {payload.map((row, rowIndex) => (
            <tr key={rowIndex}>{headers.map((header) => <td key={header}>{String(row?.[header] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (payload.table && typeof payload.table === 'object') {
    const headers = Array.isArray(payload.table.headers) ? payload.table.headers : []
    const rows = Array.isArray(payload.table.rows) ? payload.table.rows : []

    if (headers.length && rows.length) {
      return (
        <table className="formattedTable">
          <thead>
            <tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, headerIndex) => <td key={headerIndex}>{String(row?.[headerIndex] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
    }
  }

  if (Array.isArray(payload.rules)) {
    const rows = payload.rules.filter((row) => row && typeof row === 'object')
    if (rows.length) {
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))))
      const prettyLabel = (value) =>
        String(value || '')
          .trim()
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/(^\w|\s\w)/g, (char) => char.toUpperCase())

      return (
        <table className="formattedTable">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{prettyLabel(header)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((header) => <td key={header}>{String(row?.[header] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
    }
  }

  return null
}

function renderMarkdown(text) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, rehypeKatex]}>
      {String(text || '')}
    </ReactMarkdown>
  )
}

function extractLineItems(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return null

  const numbered = lines.every((line) => /^\d+\.\s+/.test(line))
  if (numbered) {
    return { type: 'ol', items: lines.map((line) => line.replace(/^\d+\.\s+/, '')) }
  }

  const bulleted = lines.every((line) => /^[-*\u2022]\s+/.test(line))
  if (bulleted) {
    return { type: 'ul', items: lines.map((line) => line.replace(/^[-*\u2022]\s+/, '')) }
  }

  return null
}

export function renderMessageText(role, text) {
  if (role !== 'assistant') return text

  if (/<table[\s\S]*?>/i.test(String(text || ''))) {
    return renderMarkdown(text)
  }

  const payload = extractJsonPayload(text)
  if (payload) {
    const table = renderStructuredPayload(payload)
    if (table) {
      const display = payload.display_text || payload.displayText || payload.message || ''
      return (
        <div className="structuredBlock">
          {display ? <div className="structuredIntro">{renderMarkdown(display)}</div> : null}
          {table}
        </div>
      )
    }
  }

  const boldItems = extractBoldNumberedItems(text)
  if (boldItems) {
    return (
      <ul className="formattedList">
        {boldItems.map((item, index) => (
          <li key={index}>
            <strong>{item.label}</strong>
            {item.body ? ` ${item.body}` : ''}
          </li>
        ))}
      </ul>
    )
  }

  const lineItems = extractLineItems(text)
  if (lineItems) {
    const ListTag = lineItems.type === 'ol' ? 'ol' : 'ul'
    return (
      <ListTag className="formattedList">
        {lineItems.items.map((item, index) => <li key={index}>{item}</li>)}
      </ListTag>
    )
  }

  return renderMarkdown(text)
}
