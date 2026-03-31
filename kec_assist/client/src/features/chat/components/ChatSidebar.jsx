export function ChatSidebar({
  loading,
  conversations,
  currentConvId,
  loadConversation,
  deleteConversation,
  newChat,
  session,
  onLogout,
  error,
}) {
  return (
    <aside className="sidebar">
      <div className="logoContainer">
        <img src="/kec-logo.png" alt="KEC - Kongu Engineering College" className="logo" />
      </div>

      <div className="sidebarHeader">
        <button className="btn newChatBtn" onClick={newChat} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>
      </div>

      <div className="chatHistory">
        {conversations.length === 0 ? (
          <div className="emptyHistory">No conversations yet</div>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`historyItem ${currentConvId === conversation.id ? 'active' : ''}`}
              onClick={() => loadConversation(conversation.id)}
            >
              <div className="historyTitle">{conversation.title}</div>
              <button className="deleteBtn" onClick={(event) => deleteConversation(conversation.id, event)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebarFooter">
        {session && (
          <div className="userProfile">
            <div className="userAvatar">{session.email?.charAt(0).toUpperCase() || 'U'}</div>
            <div className="userInfo">
              <div className="userName">{session.email?.split('@')[0] || 'User'}</div>
              <div className="userRole">{session.role || 'Go'}</div>
            </div>
            {onLogout && (
              <button className="logoutBtn" onClick={onLogout} title="Logout">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            )}
          </div>
        )}

        {error ? <div className="error">{error}</div> : null}
      </div>
    </aside>
  )
}
