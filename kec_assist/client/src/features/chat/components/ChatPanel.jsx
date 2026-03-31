import { renderMessageText } from '../utils/messageFormatting'

function ChatComposer({ input, loading, onInputChange, onSend, onStop }) {
  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); onSend() }}>
      <textarea
        className="composerInput"
        rows={1}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="Ask here"
        disabled={loading}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
      />

      {loading ? (
        <button type="button" className="composerBtn stopBtn" onClick={onStop} title="Stop generating">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button type="submit" className="composerBtn sendBtn" disabled={!input.trim()} title="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      )}
    </form>
  )
}

function ThinkingBlock({ tools }) {
  return (
    <div className="thinkingBlock">
      <div className="thinkingHeader">
        <span className="thinkingSpinner" />
        Thinking
      </div>

      <div className="thinkingContent">
        {Array.isArray(tools) && tools.length > 0 ? (
          tools.map((tool, index) => (
            <div key={`${tool.callId || index}`} className="thinkingItem">
              <span className="thinkingBullet">*</span>
              <span className="thinkingText">{tool.title || tool.tool || 'Processing...'}</span>
            </div>
          ))
        ) : (
          <div className="thinkingItem">
            <span className="thinkingBullet">*</span>
            <span className="thinkingText">Processing your request...</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatPanel({ messages, loading, input, setInput, send, stopGeneration, scrollRef }) {
  return (
    <main className="main">
      <section className="chat">
        <div className="messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="empty">
              <div className="emptyTitle">How can I help you today?</div>
              <form className="composerCentered" onSubmit={(event) => { event.preventDefault(); send() }}>
                <textarea
                  className="composerInput"
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask here"
                  disabled={loading}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      send()
                    }
                  }}
                />
                <button type="submit" className="composerBtn sendBtn" disabled={!input.trim()} title="Send message">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </form>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div key={index} className={`msg ${message.role === 'user' ? 'user' : 'assistant'}`}>
              <div className="avatar">
                {message.role === 'user' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />
                  </svg>
                )}
              </div>

              <div className="bubble">
                {message.role === 'assistant' && !message.text && loading && index === messages.length - 1 ? (
                  <ThinkingBlock tools={message.tools} />
                ) : null}
                {message.text ? <div className="text">{renderMessageText(message.role, message.text)}</div> : null}
              </div>
            </div>
          ))}
        </div>

        {messages.length > 0 ? (
          <div className="composerWrapper">
            <ChatComposer
              input={input}
              loading={loading}
              onInputChange={setInput}
              onSend={send}
              onStop={stopGeneration}
            />
          </div>
        ) : null}
      </section>
    </main>
  )
}
