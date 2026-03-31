export function readNdjsonLines(reader) {
  const decoder = new TextDecoder()
  let buffer = ''

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        while (true) {
          const separatorIndex = buffer.indexOf('\n')
          if (separatorIndex === -1) break

          const line = buffer.slice(0, separatorIndex).trim()
          buffer = buffer.slice(separatorIndex + 1)
          if (!line) continue

          try {
            yield JSON.parse(line)
          } catch {
            // Ignore malformed line and keep stream processing alive.
          }
        }
      }

      const tail = buffer.trim()
      if (!tail) return

      try {
        yield JSON.parse(tail)
      } catch {
        // Ignore malformed tail payload.
      }
    },
  }
}
