import '../../App.css'
import 'katex/dist/katex.min.css'

import { ChatSidebar } from './components/ChatSidebar'
import { ChatPanel } from './components/ChatPanel'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useChatSession } from './hooks/useChatSession'

export function ChatApp({ storagePrefix = 'kec', session = null, onLogout = null }) {
  const chat = useChatSession(storagePrefix)
  const scrollRef = useAutoScroll(chat.messages.length + (chat.loading ? 1 : 0))

  return (
    <div className="app">
      <div className="topLine" />
      <div className="appContent">
        <ChatSidebar
          loading={chat.loading}
          conversations={chat.conversations}
          currentConvId={chat.currentConvId}
          loadConversation={chat.loadConversation}
          deleteConversation={chat.deleteConversation}
          newChat={chat.newChat}
          session={session}
          onLogout={onLogout}
          error={chat.error}
        />

        <ChatPanel
          messages={chat.messages}
          loading={chat.loading}
          input={chat.input}
          setInput={chat.setInput}
          send={chat.send}
          stopGeneration={chat.stopGeneration}
          scrollRef={scrollRef}
        />
      </div>
    </div>
  )
}

