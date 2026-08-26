/**
 * ── MediaVault Social Presence & Vault Chat Orchestrator ──
 * Senior Full-Stack & UI/UX Architect Implementation
 */

(function () {
  const isChatWin = new URLSearchParams(window.location.search).get('mvWindow') === 'chat';
  let activeChatChannel = null;
  let activeListId = null;
  let chatSidebar = null;
  let unreadCount = 0;
  const renderedMessageIds = new Set();
  const activeTypers = new Map();
  let typingTimeout = null;
  let isTypingSent = false;
  // Guards to prevent repeated offline mode logging
  let _offlineLoggedChat = false;
  let _offlineLoggedPlaybackPins = false;
  let _offlineLoggedEpisodePresence = false;

  // Initialize styling dynamically to ensure seamless aesthetic presentation
  const style = document.createElement('style');
  style.textContent = `
    /* ── List Chat Backdrop (Disabled for side-by-side view) ── */
    .vault-chat-backdrop {
      display: none !important;
    }

    /* ── Chat Drawer (Docked & Resizable) ── */
    .vault-chat-drawer {
      position: fixed;
      top: 0; right: 0;
      width: 380px; height: 100vh;
      background: rgba(13, 14, 22, 0.97);
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      z-index: 9999;
      display: flex; flex-direction: column;
      box-shadow: -10px 0 40px rgba(0, 0, 0, 0.5);
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(32px);
      -webkit-backdrop-filter: blur(32px);
    }
    .vault-chat-drawer.active { transform: translateX(0); }
    .vault-chat-drawer.fullscreen {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      right: 0;
      border-radius: 0;
      box-shadow: none;
      transform: none !important;
    }
    .vault-chat-drawer.is-resizing {
      transition: none !important;
      user-select: none;
    }
    #app-body {
      transition: margin-right 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    body.is-resizing-chat #app-body {
      transition: none !important;
      user-select: none;
    }

    /* ── Drag Resizer Handle ── */
    .vault-chat-resizer {
      position: absolute;
      top: 0; left: -4px;
      width: 8px; height: 100%;
      cursor: col-resize;
      z-index: 100;
      user-select: none;
      transition: background 0.2s ease;
    }
    .vault-chat-resizer:hover, .vault-chat-drawer.is-resizing .vault-chat-resizer {
      background: rgba(255, 255, 255, 0.25);
    }

    /* ── Scrollbar ── */
    .vault-chat-messages::-webkit-scrollbar { width: 4px; }
    .vault-chat-messages::-webkit-scrollbar-track { background: transparent; }
    .vault-chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 2px; }

    /* ── Unread Badge ── */
    .chat-unread-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: #ffffff;
      color: #000000; font-size: 9px; font-weight: 900;
      min-width: 17px; height: 17px; border-radius: 10px;
      padding: 0 4px; margin-left: 6px;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
      vertical-align: middle; letter-spacing: 0.3px;
    }

    /* ── Header ── */
    .vault-chat-header {
      padding: 20px 22px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(255, 255, 255, 0.02);
      flex-shrink: 0;
    }
    .vault-chat-drawer.fullscreen .vault-chat-header {
      padding: 25px 30px;
    }
    .vault-chat-header-left {
      display: flex; align-items: center; gap: 12px;
    }
    .vault-chat-header-icon {
      width: 42px; height: 42px; border-radius: 12px;
      background: #ffffff;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; color: #000000; font-weight: 800;
      box-shadow: 0 4px 15px rgba(255, 255, 255, 0.25);
    }
    .vault-chat-header-title {
      font-size: 16px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;
    }
    .vault-chat-header-sub {
      font-size: 11px; color: rgba(255, 255, 255, 0.6); margin-top: 2px; font-weight: 500;
    }
    .vault-chat-header-actions {
      display: flex; gap: 8px; align-items: center;
    }
    .vault-chat-fullscreen-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      width: 36px; height: 36px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-fullscreen-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.4);
      color: #ffffff;
    }
    .vault-chat-close {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      width: 36px; height: 36px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-close:hover { 
      background: rgba(239, 68, 68, 0.2); 
      border-color: rgba(239, 68, 68, 0.5); 
      color: #ff4757; 
    }
    
    /* ── Color Picker Button ── */
    .vault-chat-color-picker-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      width: 36px; height: 36px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-color-picker-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.4);
      color: #ffffff;
    }

    /* ── Color Picker Modal ── */
    .vault-chat-color-picker-modal {
      position: absolute; top: 60px; right: 8px;
      background: rgba(13, 14, 22, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(32px);
      z-index: 10000;
      min-width: 200px;
    }
    .color-picker-content {
      display: flex; flex-direction: column; gap: 12px;
    }
    .color-picker-title {
      font-size: 12px; font-weight: 700; color: rgba(255, 255, 255, 0.7);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .color-picker-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    }
    .color-picker-item {
      width: 32px; height: 32px;
      border-radius: 8px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .color-picker-item:hover {
      transform: scale(1.1);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .color-picker-item.active {
      border-color: #fff;
      box-shadow: 0 0 10px currentColor;
    }
    .custom-color-input {
      width: 100%;
      height: 36px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      cursor: pointer;
    }

    /* ── Messages List ── */
    .vault-chat-messages {
      flex: 1; overflow-y: auto;
      padding: 18px 16px;
      display: flex; flex-direction: column;
      gap: 12px;
      background: transparent;
    }
    .vault-chat-drawer.fullscreen .vault-chat-messages {
      padding: 24px 28px;
      gap: 14px;
    }
    .vault-chat-message-row {
      display: flex; gap: 10px; align-items: flex-end;
      animation: msg-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    @keyframes msg-in {
      from { opacity: 0; transform: translateY(12px) scale(0.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .vault-chat-message-row.own { flex-direction: row-reverse; }

    /* ── Avatar ── */
    .vault-chat-avatar {
      width: 34px; height: 34px; flex-shrink: 0;
      border-radius: 50%;
      background-size: cover; background-position: center;
      border: 2px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .vault-chat-message-row.own .vault-chat-avatar {
      border-color: #ffffff;
      box-shadow: 0 4px 15px rgba(255, 255, 255, 0.3);
    }

    /* ── Bubble ── */
    .vault-chat-bubble {
      max-width: 72%;
      display: flex; flex-direction: column;
      gap: 5px;
    }
    .vault-drawer.fullscreen .vault-chat-bubble {
      max-width: 60%;
    }
    .vault-chat-bubble-header {
      display: flex; align-items: baseline;
      gap: 8px; padding: 0 2px;
    }
    .vault-chat-msg-sender {
      font-size: 12px; font-weight: 700; color: rgba(255, 255, 255, 0.85);
      white-space: nowrap;
      text-transform: capitalize;
    }
    .vault-chat-message-row.own .vault-chat-msg-sender { color: #ffffff; }
    .vault-chat-msg-time {
      font-size: 10px; color: rgba(255, 255, 255, 0.4); white-space: nowrap;
    }
    .vault-chat-msg-body {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px 18px 18px 6px;
      padding: 11px 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(12px);
    }
    .vault-chat-message-row.own .vault-chat-msg-body {
      background: #ffffff;
      border: 1px solid #ffffff;
      border-radius: 18px 18px 6px 18px;
      box-shadow: 0 4px 20px rgba(255, 255, 255, 0.25);
    }
    .vault-chat-msg-text {
      font-size: 13.5px; color: rgba(255, 255, 255, 0.95);
      line-height: 1.48; word-break: break-word;
    }
    .vault-chat-message-row.own .vault-chat-msg-text { color: #000000; font-weight: 600; }

    /* ── Typing Indicator ── */
    .vault-chat-typing-container {
      padding: 0 14px;
      display: flex; align-items: center; gap: 7px;
      opacity: 0; max-height: 0; overflow: hidden;
      transition: opacity 0.3s ease, max-height 0.3s ease, padding 0.3s ease;
      font-size: 11.5px; color: rgba(255, 255, 255, 0.6); font-style: italic;
    }
    .vault-chat-typing-container.active {
      opacity: 1; max-height: 36px;
      padding: 6px 14px 8px;
    }
    .typing-dots { display: flex; gap: 3px; align-items: center; }
    .typing-dots span {
      width: 5px; height: 5px; border-radius: 50%;
      background: #ffffff;
      animation: typing-bounce 1.4s infinite both;
    }
    .typing-dots span:nth-child(2) { animation-delay: .2s; }
    .typing-dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes typing-bounce {
      0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1.2); opacity: 1; }
    }

    /* ── Input Area ── */
    .vault-chat-input-area {
      padding: 14px 16px 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(13, 14, 22, 0.98);
      display: flex; gap: 10px; align-items: center;
      flex-shrink: 0;
    }
    .vault-chat-drawer.fullscreen .vault-chat-input-area {
      padding: 18px 28px 24px;
      gap: 14px;
    }
    .vault-chat-input-wrapper {
      display: flex;
      gap: 8px;
      align-items: center;
      flex: 1;
    }
    .vault-chat-attachment-btn {
      width: 40px; height: 40px; flex-shrink: 0;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.8); 
      cursor: pointer; 
      font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-attachment-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.4);
      color: #ffffff;
      transform: translateY(-2px);
    }
    .vault-chat-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 11px 18px;
      color: #ffffff; font-size: 14px; font-family: inherit;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      line-height: 1.4;
    }
    .vault-chat-input::placeholder { color: rgba(255, 255, 255, 0.35); }
    .vault-chat-input:focus {
      border-color: rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.08);
      box-shadow: 0 0 15px rgba(255, 255, 255, 0.15);
    }
    .vault-chat-send-btn {
      width: 44px; height: 44px; flex-shrink: 0;
      border-radius: 12px;
      background: #ffffff;
      border: none; color: #000000; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 4px 15px rgba(255, 255, 255, 0.25);
      transition: all 0.2s ease;
      font-weight: 800;
    }
    .vault-chat-send-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(255, 255, 255, 0.4);
      background: #ffffff;
    }
    .vault-chat-send-btn:active { 
      transform: translateY(0);
    }

    /* ── Social Presence Badges ── */
    .social-presence-badge {
      position: absolute; top: 8px; right: 8px;
      width: 28px; height: 28px; border-radius: 50%;
      border: 2px solid #10b981;
      box-shadow: 0 0 10px rgba(16,185,129,0.6);
      background-size: cover; background-position: center;
      z-index: 10;
      animation: pulse-glow 2s infinite alternate;
    }
    .social-presence-badge.watching {
      border-color: #818cf8;
      box-shadow: 0 0 12px rgba(129,140,248,0.8);
    }
    .ep-row-presence-container {
      display: inline-flex; align-items: center; gap: 4px;
      margin-left: auto; padding-right: 12px;
    }
    .ep-row-presence-avatar {
      width: 22px; height: 22px; border-radius: 50%;
      border: 1.5px solid #818cf8;
      box-shadow: 0 0 6px rgba(129,140,248,0.4);
      background-size: cover; background-position: center;
      position: relative;
    }
    .ep-row-presence-avatar::after {
      content: ''; position: absolute;
      bottom: -1px; right: -1px;
      width: 6px; height: 6px; border-radius: 50%;
      background: #10b981; border: 1px solid #000;
    }
    @keyframes pulse-glow {
      0% { transform: scale(1); box-shadow: 0 0 6px rgba(129,140,248,0.4); }
      100% { transform: scale(1.06); box-shadow: 0 0 14px rgba(129,140,248,0.9); }
    }
  `;
  document.head.appendChild(style);

  // Initialize DOM structure for the chat sidebar drawer
  function createChatDrawer() {
    if (chatSidebar) return;
    chatSidebar = document.createElement('div');
    chatSidebar.className = 'vault-chat-drawer';
    chatSidebar.innerHTML = `
      <style>
        @keyframes contextMenuFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .vault-chat-bubble:hover .vault-chat-msg-delete {
          display: flex !important;
          align-items: center;
          justify-content: center;
        }
        .vault-chat-msg-delete:hover {
          opacity: 1 !important;
          transform: scale(1.1);
        }
        .vault-chat-members-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 4px;
          font-size: 14px;
          transition: color 0.2s;
          display: flex;
          align-items: center;
        }
        .vault-chat-members-btn:hover {
          color: var(--accent);
        }
        .vault-chat-members-panel {
          position: absolute;
          top: 56px;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(22, 33, 62, 0.95);
          backdrop-filter: blur(10px);
          z-index: 100;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 15px;
          transform: translateY(100%);
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .vault-chat-members-panel.active {
          transform: translateY(0);
        }
        .vault-chat-member-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .vault-chat-member-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vault-chat-member-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1.5px solid #818cf8;
          background-size: cover;
          background-position: center;
        }
        .vault-chat-member-name {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }
        .vault-chat-member-actions {
          display: flex;
          gap: 8px;
        }
        .vault-chat-member-action-btn {
          padding: 6px 10px;
          border-radius: 6px;
          border: none;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .vault-chat-member-action-btn.promote {
          background: rgba(251, 191, 36, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.3);
        }
        .vault-chat-member-action-btn.promote:hover {
          background: rgba(251, 191, 36, 0.25);
        }
        .vault-chat-member-action-btn.kick {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .vault-chat-member-action-btn.kick:hover {
          background: rgba(239, 68, 68, 0.25);
        }
      </style>
      <div class="vault-chat-resizer" id="vault-chat-resizer" title="Drag to resize chat width"></div>
      <div class="vault-chat-header">
        <div class="vault-chat-header-left">
          <div class="vault-chat-header-icon"><i class="fas fa-comments"></i></div>
          <div>
            <div class="vault-chat-header-title">List Chat</div>
            <div class="vault-chat-header-sub">Share notes with your team</div>
          </div>
        </div>
        <div class="vault-chat-header-actions">
          <button class="vault-chat-members-btn" id="vault-chat-members-btn" title="Manage Members" style="display: none;"><i class="fas fa-users-cog"></i></button>
          <button class="vault-chat-color-picker-btn" id="vault-chat-color-picker-btn" title="Avatar Color"><i class="fas fa-palette"></i></button>
          <button class="vault-chat-fullscreen-btn" id="vault-chat-fullscreen-btn" title="Detach Chat"><i class="fas fa-external-link-alt"></i></button>
          <button class="vault-chat-close" onclick="window.socialPresence.toggleChat(false)"><i class="fas fa-times"></i></button>
        </div>
        <div class="vault-chat-color-picker-modal" id="vault-chat-color-picker-modal" style="display: none;">
          <div class="color-picker-content">
            <div class="color-picker-title">Choose Avatar Color</div>
            <div class="color-picker-grid" id="color-picker-grid"></div>
            <input type="color" id="custom-color-input" class="custom-color-input" title="Pick a custom color">
          </div>
        </div>
      </div>
      <div class="vault-chat-messages" id="vault-chat-messages"></div>
      <div id="vault-chat-typing-indicator" class="vault-chat-typing-container">
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <span id="typing-text">Someone is typing</span>
      </div>
      <div class="vault-chat-input-area">
        <div class="vault-chat-input-wrapper">
          <button class="vault-chat-attachment-btn" id="vault-chat-attachment-btn" title="Attach image"><i class="fas fa-paperclip"></i></button>
          <input type="text" class="vault-chat-input" id="vault-chat-input-field" placeholder="Write a message..." />
        </div>
        <button class="vault-chat-send-btn" id="vault-chat-send-btn"><i class="fas fa-paper-plane"></i></button>
      </div>
      <div class="vault-chat-members-panel" id="vault-chat-members-panel">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; margin-bottom: 10px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #fff;">Manage Members</h3>
          <button id="vault-chat-members-close-btn" style="background: none; border: none; color: #ccc; cursor: pointer; font-size: 14px;"><i class="fas fa-times"></i></button>
        </div>
        <div id="vault-chat-members-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin;">
          <!-- Members list will be rendered here -->
        </div>
      </div>
      <input type="file" id="vault-chat-file-input" accept="image/*" style="display: none;" />
    `;
    document.body.appendChild(chatSidebar);

    // Chat width drag resizer logic
    const resizer = document.getElementById('vault-chat-resizer');
    if (resizer) {
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      resizer.onmousedown = (e) => {
        e.preventDefault();
        isResizing = true;
        startX = e.clientX;
        startWidth = chatSidebar.offsetWidth;
        chatSidebar.classList.add('is-resizing');
        document.body.classList.add('is-resizing-chat');

        const onMouseMove = (moveEvt) => {
          if (!isResizing) return;
          const deltaX = startX - moveEvt.clientX;
          let newWidth = startWidth + deltaX;
          const minWidth = 280;
          const maxWidth = Math.min(800, window.innerWidth * 0.6);
          newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

          chatSidebar.style.width = newWidth + 'px';
          const appBody = document.getElementById('app-body');
          if (appBody && !chatSidebar.classList.contains('fullscreen')) {
            appBody.style.marginRight = newWidth + 'px';
          }
        };

        const onMouseUp = () => {
          if (isResizing) {
            isResizing = false;
            chatSidebar.classList.remove('is-resizing');
            document.body.classList.remove('is-resizing-chat');
            const finalWidth = chatSidebar.offsetWidth;
            localStorage.setItem('list_chat_width', finalWidth);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };
    }

    // Event listeners
    const inputField = document.getElementById('vault-chat-input-field');
    const sendBtn = document.getElementById('vault-chat-send-btn');
    const fullscreenBtn = document.getElementById('vault-chat-fullscreen-btn');
    const attachmentBtn = document.getElementById('vault-chat-attachment-btn');
    const fileInput = document.getElementById('vault-chat-file-input');

    sendBtn.onclick = () => sendChatMessage();
    inputField.onkeydown = (e) => {
      if (e.key === 'Enter') sendChatMessage();
    };

    // Detach Chat toggle
    fullscreenBtn.onclick = () => {
      if (window.api && typeof window.api.invoke === 'function') {
        window.api.invoke('cloud-open-chat-window', { listId: activeListId })
          .catch(err => console.error('[Chat] Failed to open detached chat window:', err));
      }
      window.toggleVaultChat(false);
    };

    // Color picker button
    const colorPickerBtn = document.getElementById('vault-chat-color-picker-btn');
    const colorPickerModal = document.getElementById('vault-chat-color-picker-modal');
    const colorPickerGrid = document.getElementById('color-picker-grid');
    const customColorInput = document.getElementById('custom-color-input');

    // Color palette
    const colorPalette = [
      'rgba(129,140,248,0.6)',  // Original indigo
      'rgba(236,72,153,0.6)',   // Pink
      'rgba(34,197,94,0.6)',    // Green
      'rgba(59,130,246,0.6)',   // Blue
      'rgba(249,115,22,0.6)',   // Orange
      'rgba(168,85,247,0.6)',   // Purple
      'rgba(236,252,3,0.6)',    // Yellow
      'rgba(14,165,233,0.6)',   // Sky
    ];

    // Initialize color picker grid
    colorPalette.forEach(color => {
      const colorItem = document.createElement('div');
      colorItem.className = 'color-picker-item';
      colorItem.style.background = color;
      colorItem.onclick = () => selectAvatarColor(color);
      colorPickerGrid.appendChild(colorItem);
    });

    // Initialize color picker with user's current color
    function initializeColorPicker() {
      const currentColor = window.currentProfile?.avatar_border_color || 'rgba(129,140,248,0.6)';
      const colorItems = colorPickerGrid.querySelectorAll('.color-picker-item');
      colorItems.forEach(item => {
        if (item.style.background === currentColor) {
          item.classList.add('active');
        }
      });
    }
    initializeColorPicker();

    // Toggle color picker
    colorPickerBtn.onclick = () => {
      colorPickerModal.style.display = colorPickerModal.style.display === 'none' ? 'block' : 'none';
    };

    // Custom color input
    customColorInput.onchange = async (e) => {
      const color = e.target.value;
      const rgbaColor = hexToRgba(color, 0.6);
      await selectAvatarColor(rgbaColor);
    };

    // Close color picker when clicking outside
    document.addEventListener('click', (e) => {
      if (!colorPickerBtn.contains(e.target) && !colorPickerModal.contains(e.target)) {
        colorPickerModal.style.display = 'none';
      }
    });

    // Attachment button
    attachmentBtn.onclick = () => {
      fileInput.click();
    };

    // File input handler
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        const imageDataUrl = event.target.result;
        const parts = imageDataUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const base64 = parts[1];

        showToast('Uploading image...');
        const uploadRes = await window.api.invoke('cloud-upload-chat-image', {
          base64Data: base64,
          mimeType: mime
        });
        if (!uploadRes.success) {
          showToast('Upload failed: ' + uploadRes.error);
          return;
        }

        const imageUrl = uploadRes.url;
        const currentProfile = window.currentProfile;
        if (!currentProfile || !activeListId) return;
        
        const messageText = `[IMAGE]:${imageUrl}`;
        const sendRes = await window.api.invoke('cloud-send-chat-message', {
          listId: activeListId,
          profileId: currentProfile.id,
          text: messageText
        });
        
        if (!sendRes.success) {
          showToast('Failed to send image: ' + sendRes.error);
        } else {
          showToast('Image sent!');
          appendMessageToUI({
            ...sendRes.data,
            profile_name: currentProfile.name || 'You',
            profile_avatar: currentProfile.avatar || 'imgs/avatars/default.png',
            avatar_border_color: currentProfile.avatar_border_color || 'rgba(129,140,248,0.6)'
          });
        }
      };
      reader.readAsDataURL(file);
      fileInput.value = ''; // Reset file input
    };

    // Keystroke typing indicator broadcast logic
    inputField.oninput = () => {
      if (!isTypingSent) {
        emitTypingEvent(true);
        isTypingSent = true;
      }
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        emitTypingEvent(false);
        isTypingSent = false;
      }, 2500);
    };

    // Initialize slash commands for media search
    if (typeof initSlashCommands === 'function') {
      const searchMedia = async (query) => {
        try {
          console.log('[Chat] Searching for:', query);
          const res = await window.api.invoke('unified-search', query);
          console.log('[Chat] Search response:', res);
          
          let results = [];
          if (res && res.results && Array.isArray(res.results)) {
            results = res.results.map(item => ({
              ...item,
              poster_path: item.poster || '',
              release_date: item.releaseYear ? `${item.releaseYear}-01-01` : '',
              posterUrl: item.poster || ''
            })).slice(0, 8);
          }
          
          console.log('[Chat] Returning results:', results);
          return results;
        } catch (e) {
          console.error('[Chat] Media search failed:', e);
          return [];
        }
      };

      const onMediaSelected = (media) => {
        console.log('[Chat] Media selected for sharing:', media);
        const text = inputField.value;
        const lastSlashIndex = text.lastIndexOf('/');
        
        // Store the selected media globally for sending
        window._selectedMediaForChat = media;
        
        if (lastSlashIndex !== -1) {
          inputField.value = text.substring(0, lastSlashIndex) + media.title;
        } else {
          inputField.value = media.title;
        }
        
        // Send the rich media message immediately
        sendChatMessage();
      };

      initSlashCommands(inputField, searchMedia, onMediaSelected);
      console.log('[Chat] Slash commands initialized');
    } else {
      console.warn('[Chat] slash commands module not loaded');
    }

    // Manage Members panel toggle
    const membersBtn = document.getElementById('vault-chat-members-btn');
    const membersPanel = document.getElementById('vault-chat-members-panel');
    const membersCloseBtn = document.getElementById('vault-chat-members-close-btn');

    if (membersBtn && membersPanel) {
      membersBtn.onclick = () => {
        membersPanel.classList.toggle('active');
        if (membersPanel.classList.contains('active')) {
          renderMembersPanelList();
        }
      };
    }
    if (membersCloseBtn && membersPanel) {
      membersCloseBtn.onclick = () => {
        membersPanel.classList.remove('active');
      };
    }

    async function renderMembersPanelList() {
      const listContainer = document.getElementById('vault-chat-members-list');
      if (!listContainer) return;
      listContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px 0;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

      try {
        const activeList = window.currentProfile?.custom_lists?.find(l => l.id === activeListId);
        if (!activeList) throw new Error('List not found');

        const res = await window.api.invoke('cloud-get-list-sharing-members', {
          listId: activeListId,
          ownerProfileId: activeList.profile_id
        });
        if (!res.success) throw new Error(res.error || 'Failed to fetch members');

        const { ownerProf, joinedMemberProfiles } = res;
        listContainer.innerHTML = '';

        // Render Owner first
        if (ownerProf) {
          const row = document.createElement('div');
          row.className = 'vault-chat-member-row';
          row.innerHTML = `
            <div class="vault-chat-member-info">
              <div class="vault-chat-member-avatar" style="background-image: url('${ownerProf.avatar || 'imgs/avatars/default.png'}'); border-color: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.25);"></div>
              <div>
                <div class="vault-chat-member-name">${escapeHTML(ownerProf.name)}</div>
                <div style="font-size: 10px; color: #fbbf24; font-weight: 700; margin-top: 2px;"><i class="fas fa-crown" style="margin-right: 3px;"></i>Owner</div>
              </div>
            </div>
          `;
          listContainer.appendChild(row);
        }

        // Render other joined members
        if (joinedMemberProfiles && joinedMemberProfiles.length > 0) {
          joinedMemberProfiles.forEach(member => {
            if (member.id === activeList.profile_id) return;
            const row = document.createElement('div');
            row.className = 'vault-chat-member-row';
            row.innerHTML = `
              <div class="vault-chat-member-info">
                <div class="vault-chat-member-avatar" style="background-image: url('${member.avatar || 'imgs/avatars/default.png'}'); border-color: #818cf8;"></div>
                <div class="vault-chat-member-name">${escapeHTML(member.name)}</div>
              </div>
              <div class="vault-chat-member-actions">
                <button class="vault-chat-member-action-btn promote" data-prof-id="${member.id}" title="Transfer Leadership"><i class="fas fa-crown"></i> Make Leader</button>
                <button class="vault-chat-member-action-btn kick" data-user-id="${member.user_id}" title="Kick Member"><i class="fas fa-user-minus"></i> Kick</button>
              </div>
            `;

            // Promote handler
            row.querySelector('.promote').onclick = async (e) => {
              if (!confirm(`Are you sure you want to transfer leadership of this list to ${member.name}? You will become a regular member.`)) return;
              showToast('Transferring leadership...');
              try {
                const trRes = await window.api.invoke('cloud-transfer-list-ownership', {
                  listId: activeListId,
                  targetProfileId: member.id
                });
                if (!trRes.success) throw new Error(trRes.error || 'Transfer failed');
                showToast('Leadership transferred successfully!');
                membersPanel.classList.remove('active');
                
                if (typeof window.refreshCustomListsFromDb === 'function') {
                  await window.refreshCustomListsFromDb();
                }
                if (typeof window.renderCustomListDetail === 'function') {
                  window.renderCustomListDetail(activeListId);
                }
              } catch (err) {
                console.error('[Chat] Transfer failed:', err);
                alert('Failed to transfer leadership: ' + err.message);
              }
            };

            // Kick handler
            row.querySelector('.kick').onclick = async (e) => {
              if (!confirm(`Are you sure you want to kick ${member.name} from this list?`)) return;
              showToast(`Kicking ${member.name}...`);
              try {
                const kickRes = await window.api.invoke('cloud-kick-list-member', {
                  listId: activeListId,
                  targetUserId: member.user_id
                });
                if (!kickRes.success) throw new Error(kickRes.error || 'Kick failed');
                showToast(`${member.name} kicked successfully.`);
                renderMembersPanelList();
                
                if (typeof window.refreshCustomListsFromDb === 'function') {
                  await window.refreshCustomListsFromDb();
                }
                if (typeof window.renderCustomListDetail === 'function') {
                  window.renderCustomListDetail(activeListId);
                }
              } catch (err) {
                console.error('[Chat] Kick failed:', err);
                alert('Failed to kick member: ' + err.message);
              }
            };

            listContainer.appendChild(row);
          });
        } else {
          const empty = document.createElement('div');
          empty.style.cssText = 'text-align:center;color:var(--text-muted);font-size:11px;padding:30px 10px;line-height:1.5;';
          empty.innerHTML = '<i class="fas fa-user-friends" style="font-size:20px;margin-bottom:8px;opacity:0.3;display:block;"></i>No other members in this list.<br>Share the list to invite friends!';
          listContainer.appendChild(empty);
        }
      } catch (err) {
        console.error('[Chat] Failed to render members list:', err);
        listContainer.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:11px;padding:20px 0;">Failed to load members list.</div>';
      }
    }
  }

  function updateUnreadBadge() {
    const btn = document.getElementById('btn-chat-custom-list');
    if (!btn) return;
    let badge = btn.querySelector('.chat-unread-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'chat-unread-badge';
      btn.appendChild(badge);
    }
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Toggle List Chat Drawer visibility (Docked side-by-side)
  window.toggleVaultChat = function (show = null) {
    if (isChatWin && show === false) {
      if (window.api && typeof window.api.closeWindow === 'function') {
        window.api.closeWindow();
      } else {
        window.close();
      }
      return;
    }
    createChatDrawer();
    const isCurrentlyActive = chatSidebar.classList.contains('active');
    const targetState = show !== null ? show : !isCurrentlyActive;
    
    const appBody = document.getElementById('app-body');
    const savedWidth = parseInt(localStorage.getItem('list_chat_width')) || 380;

    if (targetState) {
      chatSidebar.style.width = savedWidth + 'px';
      chatSidebar.classList.add('active');
      document.body.classList.add('chat-docked-active');
      if (appBody && !chatSidebar.classList.contains('fullscreen')) {
        appBody.style.marginRight = savedWidth + 'px';
      }
      unreadCount = 0;
      updateUnreadBadge();
      loadChatHistory();
    } else {
      chatSidebar.classList.remove('active');
      document.body.classList.remove('chat-docked-active');
      if (appBody) {
        appBody.style.marginRight = '0px';
      }
    }
  };

  // Subscribe to Realtime custom list messages
  window.subscribeToListChat = function (listId) {
    if (activeChatChannel) {
      activeChatChannel.unsubscribe();
      activeChatChannel = null;
    }
    activeListId = listId;
    unreadCount = 0;
    updateUnreadBadge();

    // Clear active typers on switch
    activeTypers.clear();
    updateTypingIndicatorUI();
    
    if (!listId) return;

    const client = window.getSupabaseRendererClient?.();
    if (!client) {
      if (!_offlineLoggedChat) {
        console.debug('[Chat] Offline mode: Supabase client not available, skipping chat subscription');
        _offlineLoggedChat = true;
      }
      return;
    }

    // Check for active authenticated session
    client.auth.getSession().then(({ data: sessionData, error: authError }) => {
      if (authError || !sessionData?.session?.user?.id) {
        if (!_offlineLoggedChat) {
          console.debug('[Chat] Offline mode: No active authenticated session available');
          _offlineLoggedChat = true;
        }
        return;
      }
      _offlineLoggedChat = false;  // Reset flag when authenticated

      // Check list ownership to toggle Manage Members button
      const activeList = window.currentProfile?.custom_lists?.find(l => l.id === listId);
      const isOwner = activeList && activeList.profile_id === window.currentProfile.id;
      const membersBtn = document.getElementById('vault-chat-members-btn');
      if (membersBtn) {
        membersBtn.style.display = isOwner ? 'flex' : 'none';
      }
      // Also reset members panel if active
      const membersPanel = document.getElementById('vault-chat-members-panel');
      if (membersPanel) {
        membersPanel.classList.remove('active');
      }

      // Note: filter property removed — server-side UUID filtering can break on some Supabase plans.
      // We filter by list_id in JS instead.
      activeChatChannel = client
        .channel(`collection-messages:${listId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'collection_messages'
          },
          async (payload) => {
            try {
              if (payload.eventType === 'INSERT') {
                // JS-side list_id guard
                if (!payload.new || String(payload.new.list_id) !== String(listId)) return;

                const isDrawerOpen = chatSidebar && chatSidebar.classList.contains('active');
                if (!isDrawerOpen) {
                  unreadCount++;
                  updateUnreadBadge();
                }
                try {
                  const { data: prof } = await client
                    .from('account_profiles')
                    .select('name, avatar, avatar_border_color')
                    .eq('id', payload.new.profile_id)
                    .maybeSingle();

                  const profData = Array.isArray(prof) ? prof[0] : prof;
                  appendMessageToUI({
                    ...payload.new,
                    profile_name: profData?.name || 'Friend',
                    profile_avatar: profData?.avatar || 'imgs/avatars/default.png',
                    avatar_border_color: profData?.avatar_border_color || 'rgba(129,140,248,0.6)'
                  });
                } catch (err) {
                  appendMessageToUI(payload.new);
                }
              } else if (payload.eventType === 'DELETE') {
                const msgId = payload.old.id;
                const msgEl = document.getElementById(`chat-msg-${msgId}`);
                if (msgEl) {
                  msgEl.style.opacity = '0';
                  msgEl.style.transform = 'scale(0.9)';
                  setTimeout(() => msgEl.remove(), 300);
                }
              }
            } catch (e) {
              const errMsg = e?.message || String(e);
              console.warn('[Chat] Error processing incoming message:', errMsg);
            }
          }
        )
        .on(
          'broadcast',
          { event: 'typing' },
          (payload) => {
            if (payload && payload.payload) {
              handleIncomingTypingIndicator(payload.payload);
            }
          }
        )
        .subscribe();
    }).catch((error) => {
      const errMsg = error?.message || String(error);
      console.error('[Chat] Auth check failed:', errMsg);
    });
  };

  // Load old messages from Supabase
  async function loadChatHistory() {
    if (!activeListId) return;

    renderedMessageIds.clear();
    const messagesEl = document.getElementById('vault-chat-messages');
    messagesEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px 0;">Loading history...</div>';

    try {
      const res = await window.api.invoke('cloud-load-chat-history', { listId: activeListId });
      if (!res.success) throw new Error(res.error || 'Failed to load history');
      const data = res.data;

      messagesEl.innerHTML = '';
      if (data && data.length > 0) {
        data.forEach(msg => {
          // account_profiles may be an array or object depending on Supabase join mode
          const profData = Array.isArray(msg.account_profiles) ? msg.account_profiles[0] : msg.account_profiles;
          appendMessageToUI({
            id: msg.id,
            message_text: msg.message_text,
            created_at: msg.created_at,
            profile_id: msg.profile_id,
            profile_name: profData?.name || 'Friend',
            profile_avatar: profData?.avatar || 'imgs/avatars/default.png',
            avatar_border_color: profData?.avatar_border_color || 'rgba(129,140,248,0.6)'
          }, false);
        });
        scrollToBottom();
      } else {
        messagesEl.innerHTML = '<div class="chat-placeholder" style="text-align:center;color:rgba(255,255,255,0.25);font-size:12px;padding:40px 20px;line-height:1.6;"><i class="fas fa-comments" style="font-size:28px;display:block;margin-bottom:10px;opacity:0.3;"></i>No messages yet.<br>Be the first to share a note!</div>';
      }
    } catch (e) {
      console.error('[Chat] Failed to load history:', e);
      messagesEl.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:12px;padding:20px 0;">Failed to load chat history.</div>';
      if (e.message && (e.message.includes('Not authorized') || e.message.includes('authorized'))) {
        showToast('You are no longer authorized to access this list.');
        window.toggleVaultChat(false);
        if (window.activeCustomListId === activeListId) {
          window.switchView('watchlist');
        }
      }
    }
  }

  // Send message
  async function sendChatMessage() {
    const inputField = document.getElementById('vault-chat-input-field');
    const text = inputField.value.trim();
    if (!text || !activeListId) return;

    const currentProfile = window.currentProfile;
    if (!currentProfile) return;

    // Check if this is a media share from slash commands
    const selectedMedia = window._selectedMediaForChat;
    
    inputField.value = '';
    window._selectedMediaForChat = null; // Clear selected media

    // Clear local typing state instantly when sending
    emitTypingEvent(false);
    isTypingSent = false;
    clearTimeout(typingTimeout);

    try {
      let messageText = text;
      
      if (selectedMedia) {
        // Send as media_share type
        const res = await window.api.invoke('cloud-send-media-share', {
          listId: activeListId,
          profileId: currentProfile.id,
          media: selectedMedia
        });
        if (!res.success) throw new Error(res.error || 'Failed to send media');
      } else {
        // Send regular text message
        const res = await window.api.invoke('cloud-send-chat-message', {
          listId: activeListId,
          profileId: currentProfile.id,
          text: messageText
        });
        if (!res.success) throw new Error(res.error || 'Failed to send message');
      }
    } catch (e) {
      console.error('[Chat] Failed to send message:', e);
      showToast('Failed to send message: ' + e.message);
      if (e.message && (e.message.includes('Not authorized') || e.message.includes('authorized'))) {
        showToast('You are no longer authorized to access this list.');
        window.toggleVaultChat(false);
        if (window.activeCustomListId === activeListId) {
          window.switchView('watchlist');
        }
      }
    }
  }

  // Append single message to DOM
  function appendMessageToUI(msg, scroll = true) {
    if (msg.id) {
      if (renderedMessageIds.has(msg.id)) return;
      renderedMessageIds.add(msg.id);
    }

    const messagesEl = document.getElementById('vault-chat-messages');
    if (!messagesEl) return;

    // Remove any placeholder text element
    const placeholder = messagesEl.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    // Robust own-message detection (handles string vs UUID mismatches)
    const myId = String(window.currentProfile?.id || '');
    const msgProfileId = String(msg.profile_id || '');
    const isOwnMessage = myId && myId === msgProfileId;

    let name = msg.profile_name;
    if (isOwnMessage && window.currentProfile?.name) {
      name = window.currentProfile.name;
    } else if (!name || name === 'Anonymous User') {
      name = isOwnMessage ? (window.currentProfile?.name || 'You') : 'Friend';
    }

    // Resolve avatar using localImg if available
    let avatar = msg.profile_avatar;
    if (isOwnMessage && window.currentProfile?.avatar) {
      avatar = window.currentProfile.avatar;
    }
    if (!avatar || avatar.includes('default.png')) {
      avatar = 'imgs/avatars/default.png';
    }
    if (typeof window.localImg === 'function') avatar = window.localImg(avatar);

    // Get avatar border color
    let avatarBorderColor = msg.avatar_border_color || 'rgba(129,140,248,0.6)';
    if (isOwnMessage && window.currentProfile?.avatar_border_color) {
      avatarBorderColor = window.currentProfile.avatar_border_color;
    }

    const timeString = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    const msgRow = document.createElement('div');
    if (msg.id) msgRow.id = 'chat-msg-' + msg.id;
    msgRow.className = `vault-chat-message-row${isOwnMessage ? ' own' : ''}`;

    const isImage = msg.message_text && msg.message_text.startsWith('[IMAGE]:');
    const isMediaShare = msg.message_text && msg.message_text.startsWith('[MEDIA_SHARE]:');

    const bodyBgStyle = isMediaShare
      ? 'background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important;'
      : isOwnMessage
        ? `background: linear-gradient(135deg, ${avatarBorderColor} 0%, ${avatarBorderColor} 100%); border: 1.5px solid ${avatarBorderColor};`
        : '';

    const activeList = window.currentProfile?.custom_lists?.find(l => l.id === activeListId);
    const isListOwner = activeList && activeList.profile_id === window.currentProfile.id;

    msgRow.innerHTML = `
      <div class="vault-chat-avatar" data-profile-id="${msg.profile_id}" style="background-image: url('${avatar}'); border-color: ${avatarBorderColor};"></div>
      <div class="vault-chat-bubble" style="position: relative;">
        <div class="vault-chat-bubble-header" style="${isOwnMessage ? 'flex-direction: row-reverse;' : ''}">
          <span class="vault-chat-msg-sender">${escapeHTML(name)}</span>
          <span class="vault-chat-msg-time">${timeString}</span>
        </div>
        <div class="vault-chat-msg-body" style="${bodyBgStyle}${isImage ? 'padding: 4px 6px;' : ''}">
        </div>
      </div>
    `;

    if ((isListOwner || isOwnMessage) && msg.id) {
      // Add contextmenu listener for right-click deletion
      const bubbleEl = msgRow.querySelector('.vault-chat-bubble');
      if (bubbleEl) {
        bubbleEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          
          // Remove any existing context menus first
          const existingMenu = document.getElementById('vault-chat-context-menu');
          if (existingMenu) existingMenu.remove();

          // Create custom context menu
          const contextMenu = document.createElement('div');
          contextMenu.id = 'vault-chat-context-menu';
          contextMenu.style.cssText = `
            position: fixed;
            left: ${e.clientX}px;
            top: ${e.clientY}px;
            background: rgba(22, 33, 62, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 4px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            z-index: 9999;
            width: max-content;
            display: flex;
            flex-direction: column;
            animation: contextMenuFadeIn 0.15s ease-out;
          `;

          const deleteOption = document.createElement('button');
          deleteOption.style.cssText = `
            background: none;
            border: none;
            color: #f87171;
            padding: 8px 12px;
            text-align: left;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border-radius: 5px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
            white-space: nowrap;
            width: 100%;
          `;
          deleteOption.innerHTML = `<i class="fas fa-trash-alt"></i> Delete Message`;
          deleteOption.onmouseenter = () => {
            deleteOption.style.background = 'rgba(239, 68, 68, 0.15)';
          };
          deleteOption.onmouseleave = () => {
            deleteOption.style.background = 'none';
          };

          deleteOption.onclick = async () => {
            contextMenu.remove();
            if (!confirm('Are you sure you want to delete this message?')) return;
            
            // Remove from DOM immediately for the deleting user
            const msgEl = document.getElementById(`chat-msg-${msg.id}`);
            if (msgEl) {
              msgEl.style.opacity = '0';
              msgEl.style.transform = 'scale(0.9)';
              setTimeout(() => msgEl.remove(), 300);
            }

            try {
              const deleteRes = await window.api.invoke('cloud-delete-chat-message', { messageId: msg.id });
              if (!deleteRes.success) throw new Error(deleteRes.error || 'Failed to delete');
            } catch (err) {
              console.error('[Chat] Failed to delete message:', err);
              alert('Failed to delete message: ' + err.message);
            }
          };

          contextMenu.appendChild(deleteOption);
          document.body.appendChild(contextMenu);

          const closeMenu = (clickEvent) => {
            if (!contextMenu.contains(clickEvent.target)) {
              contextMenu.remove();
              document.removeEventListener('click', closeMenu);
              document.removeEventListener('contextmenu', closeMenu);
            }
          };
          
          setTimeout(() => {
            document.addEventListener('click', closeMenu);
            document.addEventListener('contextmenu', closeMenu);
          }, 50);
        });
      }
    }

    const msgBody = msgRow.querySelector('.vault-chat-msg-body');

    if (isImage) {
      const imgUrl = msg.message_text.substring(8);
      const img = document.createElement('img');
      img.src = imgUrl;
      img.style.cssText = 'max-width: 100%; max-height: 250px; border-radius: 12px; display: block; margin-top: 4px; cursor: pointer;';
      img.onclick = () => window.api.invoke('open-external', imgUrl);
      msgBody.appendChild(img);
    } else if (isMediaShare) {
      try {
        const jsonStr = msg.message_text.substring(14);
        const mediaData = JSON.parse(jsonStr);
        
        const shareMsg = {
          type: 'media_share',
          mediaId: mediaData.mediaId,
          title: mediaData.title,
          posterUrl: mediaData.posterUrl,
          mediaType: mediaData.mediaType
        };
        
        if (window.ChatMediaRenderer && typeof window.ChatMediaRenderer.render === 'function') {
          const renderedEl = window.ChatMediaRenderer.render(shareMsg, (data) => {
            const item = {
              id: data.mediaId,
              title: data.title,
              type: data.mediaType === 'series' || data.mediaType === 'tv' ? 'series' : 'movie',
              poster: data.posterUrl,
              poster_path: data.posterUrl,
              media_type: data.mediaType === 'series' || data.mediaType === 'tv' ? 'tv' : 'movie'
            };
            
            const isOnline = data.mediaId && (data.mediaId.startsWith('tmdb:') || data.mediaId.startsWith('tt'));
            
            if (isOnline && typeof window.renderUnifiedDetail === 'function') {
              window.renderUnifiedDetail(item);
              if (typeof window.toggleVaultChat === 'function') {
                window.toggleVaultChat(false);
              }
            } else if (typeof window.openShowDetail === 'function') {
              window.openShowDetail(item);
              if (typeof window.toggleVaultChat === 'function') {
                window.toggleVaultChat(false);
              }
            }
          });
          while (renderedEl.firstChild) {
            msgBody.appendChild(renderedEl.firstChild);
          }
        } else {
          const textNode = document.createElement('div');
          textNode.className = 'vault-chat-msg-text';
          textNode.innerHTML = `Shared: <b>${escapeHTML(mediaData.title)}</b> (${mediaData.mediaType})`;
          msgBody.appendChild(textNode);
        }
      } catch (err) {
        console.error('[Chat] Failed to parse media share JSON:', err);
        const textNode = document.createElement('div');
        textNode.className = 'vault-chat-msg-text';
        textNode.innerHTML = escapeHTML(msg.message_text);
        msgBody.appendChild(textNode);
      }
    } else {
      const textNode = document.createElement('div');
      textNode.className = 'vault-chat-msg-text';
      textNode.innerHTML = escapeHTML(msg.message_text);
      msgBody.appendChild(textNode);
    }

    messagesEl.appendChild(msgRow);
    if (scroll) scrollToBottom();
  }

  function scrollToBottom() {
    const messagesEl = document.getElementById('vault-chat-messages');
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── Social Playback Pins (Glowing Avatars Overlay on Posters) ──
  window.renderSocialPlaybackPins = async function (containerSelector = '.media-grid') {
    const client = window.getSupabaseRendererClient?.();
    if (!client || !window.currentProfile) {
      if (!_offlineLoggedPlaybackPins) {
        console.debug('[SocialPresence] Offline mode: Client or profile unavailable, skipping playback pins');
        _offlineLoggedPlaybackPins = true;
      }
      return;
    }

    try {
      // Check for active authenticated session
      const { data: sessionData, error: authError } = await client.auth.getSession();
      if (authError || !sessionData?.session?.user?.id) {
        if (!_offlineLoggedPlaybackPins) {
          console.debug('[SocialPresence] Offline mode: No active authenticated session available');
          _offlineLoggedPlaybackPins = true;
        }
        return;
      }
      _offlineLoggedPlaybackPins = false;  // Reset flag when authenticated

      const currentUserId = sessionData.session.user.id || window.currentProfile?.user_id || '';

      // Find list IDs the current profile/user is a member of
      let query = client
        .from('list_members')
        .select('list_id, target_profile_id')
        .eq('user_id', currentUserId)
        .eq('status', 'joined');

      const { data: memberLists, error: err } = await query;
      if (err) throw err;

      const currentProfId = window.currentProfile?.id || null;
      const sharedListIds = (memberLists || [])
        .filter(m => !m.target_profile_id || !currentProfId || m.target_profile_id === currentProfId)
        .map(m => m.list_id);

      if (sharedListIds.length === 0) return;

      // Get other member user_ids from those shared lists (no direct FK to account_profiles, so we do a separate lookup)
      const { data: listMembers, error: memErr } = await client
        .from('list_members')
        .select('user_id')
        .in('list_id', sharedListIds)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);

      if (memErr) throw memErr;

      const otherUserIds = [...new Set((listMembers || []).map(m => m.user_id))];
      if (otherUserIds.length === 0) return;

      // Fetch account_profiles for those user_ids
      const { data: fetchedProfiles } = await client
        .from('account_profiles')
        .select('id, name, avatar, user_id')
        .in('user_id', otherUserIds);

      const otherProfiles = fetchedProfiles || [];
      const profileIds = new Set(otherProfiles.map(p => p.id));

      if (otherProfiles.length === 0) return;

      // Get playback history for these shared members
      const { data: histories, error: histErr } = await client
        .from('playback_history')
        .select(`
          profile_id,
          media_id,
          progress,
          duration,
          last_watched_at
        `)
        .in('profile_id', Array.from(profileIds))
        .order('last_watched_at', { ascending: false });

      if (histErr) throw histErr;

      // Get watchlist items for these shared members
      const { data: watchlists, error: wlFetchErr } = await client
        .from('watchlist_items')
        .select(`
          profile_id,
          media_id
        `)
        .in('profile_id', Array.from(profileIds));

      if (wlFetchErr) throw wlFetchErr;

      // Overlay badges on posters
      const cards = document.querySelectorAll(`${containerSelector} .media-card`);
      cards.forEach(card => {
        const mediaId = card.getAttribute('data-media-id') || card.getAttribute('data-id');
        if (!mediaId) return;

        // Clean existing social badges
        const oldBadges = card.querySelectorAll('.social-presence-badge');
        oldBadges.forEach(b => b.remove());

        // Find matches in histories (Currently Watching)
        const activeWatchers = histories ? histories.filter(h => {
          const isMatch = String(h.media_id) === String(mediaId) || String(h.media_id).startsWith(mediaId + ':');
          const isRecentlyActive = (Date.now() - new Date(h.last_watched_at).getTime()) < 3600000; // Watch activity within last 1 hour
          return isMatch && isRecentlyActive;
        }) : [];

        // Find matches in watchlists (Added to My List)
        const watchlistWatchers = watchlists ? watchlists.filter(w => {
          return String(w.media_id) === String(mediaId);
        }) : [];

        // Determine who to show
        let watcherProfile = null;
        let isWatchingActive = false;

        if (activeWatchers.length > 0) {
          const watcher = activeWatchers[0];
          watcherProfile = otherProfiles.find(p => p.id === watcher.profile_id);
          isWatchingActive = true;
        } else if (watchlistWatchers.length > 0) {
          const watcher = watchlistWatchers[0];
          watcherProfile = otherProfiles.find(p => p.id === watcher.profile_id);
        }

        if (watcherProfile) {
          const badge = document.createElement('div');
          badge.className = 'social-presence-badge' + (isWatchingActive ? ' watching' : '');
          badge.style.backgroundImage = `url('${watcherProfile.avatar || 'imgs/avatars/default.png'}')`;
          
          if (isWatchingActive) {
            badge.title = `${watcherProfile.name} is currently watching this!`;
          } else {
            badge.title = `${watcherProfile.name} added this to My List`;
          }
          
          // Poster wrap container positioning relative
          let imgContainer = card.querySelector('.poster-container') || card.querySelector('.media-poster-wrap') || card;
          imgContainer.style.position = 'relative';
          imgContainer.appendChild(badge);
        }
      });
    } catch (e) {
      const errMsg = e?.message || String(e);
      console.warn('[SocialPresence] Failed to render pins:', errMsg);
    }
  };

  // ── Episode-Level Presence ──
  window.renderEpisodePresence = async function (tvShowId, episodeRowsSelector = '.episode-row') {
    const client = window.getSupabaseRendererClient?.();
    if (!client || !window.currentProfile) {
      if (!_offlineLoggedEpisodePresence) {
        console.debug('[SocialPresence] Offline mode: Client or profile unavailable, skipping episode presence');
        _offlineLoggedEpisodePresence = true;
      }
      return;
    }

    try {
      // Check for active authenticated session
      const { data: sessionData, error: authError } = await client.auth.getSession();
      if (authError || !sessionData?.session?.user?.id) {
        if (!_offlineLoggedEpisodePresence) {
          console.debug('[SocialPresence] Offline mode: No active authenticated session available');
          _offlineLoggedEpisodePresence = true;
        }
        return;
      }
      _offlineLoggedEpisodePresence = false;  // Reset flag when authenticated

      const currentUserId = sessionData.session.user.id || window.currentProfile?.user_id || '';

      // Find list IDs the current user is a member of
      const { data: memberLists } = await client
        .from('list_members')
        .select('list_id')
        .eq('user_id', currentUserId)
        .eq('status', 'joined');

      const sharedListIds = (memberLists || []).map(m => m.list_id);
      if (sharedListIds.length === 0) return;

      // Get other member user_ids from those shared lists
      const { data: listMembers } = await client
        .from('list_members')
        .select('user_id')
        .in('list_id', sharedListIds)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);

      const otherUserIds = [...new Set((listMembers || []).map(m => m.user_id))];
      if (otherUserIds.length === 0) return;

      // Fetch account_profiles for those user_ids
      const { data: fetchedProfiles } = await client
        .from('account_profiles')
        .select('id, name, avatar, user_id')
        .in('user_id', otherUserIds);

      const otherProfiles = fetchedProfiles || [];
      const profileIds = new Set(otherProfiles.map(p => p.id));

      if (otherProfiles.length === 0) return;

      // Get playback histories matching standard episode strings: "showId:season:episode"
      const { data: histories } = await client
        .from('playback_history')
        .select(`
          profile_id,
          media_id,
          last_watched_at
        `)
        .in('profile_id', Array.from(profileIds))
        .like('media_id', `${tvShowId}:%`);

      if (!histories || histories.length === 0) return;

      // Bind badges to specific episode rows
      const rows = document.querySelectorAll(episodeRowsSelector);
      rows.forEach(row => {
        const season = row.getAttribute('data-season') || row.dataset.season;
        const episode = row.getAttribute('data-episode') || row.dataset.episode;
        if (!season || !episode) return;

        const expectedMediaId = `${tvShowId}:${season}:${episode}`;

        // Find matches
        const watchers = histories.filter(h => h.media_id === expectedMediaId);
        
        // Remove existing presence
        const oldPresence = row.querySelector('.ep-row-presence-container');
        if (oldPresence) oldPresence.remove();

        if (watchers.length > 0) {
          const container = document.createElement('div');
          container.className = 'ep-row-presence-container';

          watchers.forEach(w => {
            const prof = otherProfiles.find(p => p.id === w.profile_id);
            if (prof) {
              const av = document.createElement('div');
              av.className = 'ep-row-presence-avatar';
              av.style.backgroundImage = `url('${prof.avatar || 'imgs/avatars/default.png'}')`;
              av.title = `${prof.name} is on this episode`;
              container.appendChild(av);
            }
          });

          // Append to row (flex structure)
          row.appendChild(container);
        }
      });
    } catch (e) {
      const errMsg = e?.message || String(e);
      console.warn('[SocialPresence] Failed to render episode presence:', errMsg);
    }
  };

  // Emit ephemeral typing events via Supabase Broadcast
  function emitTypingEvent(isTyping) {
    if (!activeChatChannel) return;
    const currentProfile = window.currentProfile;
    if (!currentProfile) return;

    activeChatChannel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        profile_id: currentProfile.id,
        name: currentProfile.name || 'Friend',
        is_typing: isTyping
      }
    });
  }

  // Handle incoming broadcast typing events
  function handleIncomingTypingIndicator(payload) {
    const { profile_id, name, is_typing } = payload;
    if (profile_id === window.currentProfile?.id) return;

    const indicatorEl = document.getElementById('vault-chat-typing-indicator');
    const textEl = document.getElementById('typing-text');
    if (!indicatorEl || !textEl) return;

    if (is_typing) {
      if (activeTypers.has(profile_id)) {
        clearTimeout(activeTypers.get(profile_id).timeout);
      }

      // Safety timeout: automatically remove typer after 5 seconds if no updates
      const timeout = setTimeout(() => {
        activeTypers.delete(profile_id);
        updateTypingIndicatorUI();
      }, 5000);

      activeTypers.set(profile_id, { name, timeout });
    } else {
      if (activeTypers.has(profile_id)) {
        clearTimeout(activeTypers.get(profile_id).timeout);
        activeTypers.delete(profile_id);
      }
    }

    updateTypingIndicatorUI();
  }

  function updateTypingIndicatorUI() {
    const indicatorEl = document.getElementById('vault-chat-typing-indicator');
    const textEl = document.getElementById('typing-text');
    if (!indicatorEl || !textEl) return;

    if (activeTypers.size > 0) {
      const names = Array.from(activeTypers.values()).map(t => t.name);
      let text = '';
      if (names.length === 1) {
        text = `${names[0]} is typing`;
      } else if (names.length === 2) {
        text = `${names[0]} and ${names[1]} are typing`;
      } else {
        text = `Multiple people are typing`;
      }
      textEl.textContent = text;
      indicatorEl.classList.add('active');
      scrollToBottom();
    } else {
      indicatorEl.classList.remove('active');
    }
  }

  // ── REST Poll: refresh chat messages every 5s when the drawer is open ──
  let chatPollInterval = null;
  let lastPollTimestamp = null;

  async function pollChatMessages() {
    if (!activeListId) return;
    const isDrawerOpen = chatSidebar && chatSidebar.classList.contains('active');
    if (!isDrawerOpen) return;

    try {
      const res = await window.api.invoke('cloud-load-chat-history', { listId: activeListId });
      if (!res.success) throw new Error(res.error || 'Poll failed');
      const data = res.data;
      if (!data) return;

      data.forEach(msg => {
        if (renderedMessageIds.has(msg.id)) return; // already shown
        const profData = Array.isArray(msg.account_profiles) ? msg.account_profiles[0] : msg.account_profiles;
        appendMessageToUI({
          id: msg.id,
          message_text: msg.message_text,
          created_at: msg.created_at,
          profile_id: msg.profile_id,
          profile_name: profData?.name || 'Friend',
          profile_avatar: profData?.avatar || 'imgs/avatars/default.png',
          avatar_border_color: profData?.avatar_border_color || 'rgba(129,140,248,0.6)'
        });
      });
    } catch (e) {
      // Silent poll failure — websocket handles primary delivery
    }
  }

  chatPollInterval = setInterval(pollChatMessages, 5000);

  // Lightweight periodic poll (every 30s) for social pins & episode presence
  setInterval(() => {
    if (window.currentView === 'library' || (window.currentView === 'custom-list-detail' && activeListId)) {
      window.renderSocialPlaybackPins(window.currentView === 'library' ? '.media-grid' : '#custom-list-grid');
    }
    if (window.currentView === 'discover-detail' || window.currentView === 'show-detail') {
      const showId = window.currentShowId || (window.currentDetailItem?.id);
      if (showId) window.renderEpisodePresence(showId, '.episode-row');
    }
  }, 30000);

  // ── Display Invited Friends on Profile Hero ──
  window.renderInvitedFriends = async function () {
    const countEl = document.getElementById('invited-friends-count');
    const avatarsEl = document.getElementById('invited-friends-avatars');
    if (!countEl || !avatarsEl) return;

    const client = window.getSupabaseRendererClient?.();
    if (!client || !window.currentProfile) {
      console.info('[InvitedFriends] Offline mode or client unavailable');
      return;
    }

    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session?.user?.id) return;

      const currentUserId = sessionData.session.user.id;

      // Fetch list invitations for the current user
      const { data: invitations } = await client
        .from('list_members')
        .select(`
          list_id,
          status,
          invited_by,
          account_profiles:invited_by(name, avatar)
        `)
        .eq('user_id', currentUserId)
        .eq('status', 'pending');

      if (!invitations || invitations.length === 0) {
        countEl.textContent = '0';
        avatarsEl.innerHTML = '';
        return;
      }

      const invitedBy = new Map();
      const uniqueInviters = new Set();

      invitations.forEach(inv => {
        if (inv.account_profiles) {
          const profile = Array.isArray(inv.account_profiles) ? inv.account_profiles[0] : inv.account_profiles;
          if (profile) {
            uniqueInviters.add(profile.name);
            if (!invitedBy.has(profile.name)) {
              invitedBy.set(profile.name, profile);
            }
          }
        }
      });

      countEl.textContent = uniqueInviters.size;
      avatarsEl.innerHTML = '';

      // Display up to 4 avatars
      let count = 0;
      invitedBy.forEach((profile) => {
        if (count >= 4) return;
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.style.backgroundImage = `url('${profile.avatar || 'imgs/avatars/default.png'}')`;
        avatar.title = `${profile.name} invited you`;
        avatarsEl.appendChild(avatar);
        count++;
      });

      // Show "+X more" if there are more than 4
      if (uniqueInviters.size > 4) {
        const more = document.createElement('div');
        more.style.cssText = `
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2.5px solid rgba(129,140,248,0.6);
          background: rgba(99,102,241,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 900;
          color: #a5b4fc;
          margin-right: -12px;
        `;
        more.textContent = `+${uniqueInviters.size - 4}`;
        avatarsEl.appendChild(more);
      }
    } catch (e) {
      console.warn('[InvitedFriends] Failed to render:', e);
    }
  };

  // Listen to IPC events from main process
  if (window.api && typeof window.api.on === 'function') {
    window.api.on('new-chat-message', (msg) => {
      if (!msg) return;
      if (String(msg.list_id) !== String(activeListId)) return;

      const isDrawerOpen = chatSidebar && chatSidebar.classList.contains('active');
      if (!isDrawerOpen) {
        unreadCount++;
        updateUnreadBadge();
      }
      appendMessageToUI(msg);
    });

    window.api.on('set-active-chat-list', ({ listId }) => {
      window.subscribeToListChat(listId);
    });
  }

  // ── Helper Functions for Avatar Color Picker ──
  function hexToRgba(hex, alpha = 0.6) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  async function selectAvatarColor(color) {
    if (!window.currentProfile || !window.currentProfile.id) {
      console.error('[Chat] No current profile to update avatar color');
      return;
    }

    try {
      // Save to Supabase
      const res = await window.api.invoke('cloud-update-profile-avatar-color', {
        profileId: window.currentProfile.id,
        avatarBorderColor: color
      });

      if (!res.success) {
        console.error('[Chat] Failed to update avatar color:', res.error);
        return;
      }

      // Update local profile
      window.currentProfile.avatar_border_color = color;

      // Re-render all messages to apply new color
      const messagesContainer = document.getElementById('vault-chat-messages');
      if (messagesContainer) {
        // Update avatar border colors and message background colors
        const allMessageRows = messagesContainer.querySelectorAll('.vault-chat-message-row.own');
        allMessageRows.forEach(row => {
          const avatar = row.querySelector('[data-profile-id]');
          const msgBody = row.querySelector('.vault-chat-msg-body');
          if (avatar) {
            avatar.style.borderColor = color;
          }
          if (msgBody) {
            msgBody.style.background = `linear-gradient(135deg, ${color} 0%, ${color} 100%)`;
            msgBody.style.border = `1.5px solid ${color}`;
          }
        });
      }

      // Update color picker UI
      const colorPickerItems = document.querySelectorAll('.color-picker-item');
      colorPickerItems.forEach(item => item.classList.remove('active'));
      colorPickerItems.forEach(item => {
        if (item.style.background === color) {
          item.classList.add('active');
        }
      });
      console.log('[Chat] Avatar color updated to:', color);
    } catch (e) {
      console.error('[Chat] Error selecting avatar color:', e);
    }
  }

  // --- HYBRID REALTIME + POLLING NOTIFICATION SYSTEM ---
  let globalInviteChannel = null;
  let globalChatChannel = null;
  let pollingInterval = null;
  let lastCheckedMessagesTime = Date.now();
  let realtimeRetryCount = 0;
  const MAX_RETRIES = 3;
  let isPollingActive = false;
  let reconnectTimeout = null;

  async function startNotificationSync(userId) {
    if (!userId) return;
    stopNotificationSync();
    
    lastCheckedMessagesTime = Date.now();
    realtimeRetryCount = 0;
    
    console.log('[RealtimeNotifier] Starting notification sync for user:', userId);
    connectRealtime(userId);
  }

  function connectRealtime(userId) {
    const client = typeof window.getSupabaseRendererClient === 'function' ? window.getSupabaseRendererClient() : null;
    if (!client) {
      console.warn('[RealtimeNotifier] Supabase client not available, starting polling fallback.');
      startPollingFallback();
      return;
    }

    try {
      // 1. Subscribe to list_members for invitations
      globalInviteChannel = client
        .channel(`global-invites:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'list_members',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            console.log('[RealtimeNotifier] Received list_members insert:', payload);
            if (payload.new && payload.new.status === 'pending') {
              if (typeof window.loadAndRenderInvitations === 'function') {
                window.loadAndRenderInvitations();
              }
            }
          }
        );

      globalInviteChannel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealtimeNotifier] Subscribed to global invites.');
          realtimeRetryCount = 0;
          if (isPollingActive) stopPollingFallback();
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          handleRealtimeError(userId, 'Invites channel failed: ' + status);
        }
      });

      // 2. Subscribe to collection_messages for messages
      globalChatChannel = client
        .channel('global-messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'collection_messages'
          },
          async (payload) => {
            try {
              if (!payload.new) return;
              if (window.currentProfile && String(payload.new.profile_id) === String(window.currentProfile.id)) {
                return; // Ignore our own messages
              }
              
              const customLists = window.currentProfile?.custom_lists || [];
              const list = customLists.find(l => String(l.id) === String(payload.new.list_id));
              if (!list) return;

              const isChatOpen = chatSidebar && chatSidebar.classList.contains('active');
              if (isChatOpen && String(activeListId) === String(payload.new.list_id)) {
                return; // Already viewing
              }

              let senderName = 'A friend';
              try {
                const { data: prof } = await client
                  .from('account_profiles')
                  .select('name')
                  .eq('id', payload.new.profile_id)
                  .maybeSingle();
                if (prof && prof.name) senderName = prof.name;
              } catch (e) {}

              if (typeof window.addNotification === 'function') {
                window.addNotification(
                  list.name || 'Shared List',
                  `${senderName}: ${payload.new.message}`,
                  'chat'
                );
              }
            } catch (e) {
              console.warn('[RealtimeNotifier] Error processing message payload:', e);
            }
          }
        );

      globalChatChannel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealtimeNotifier] Subscribed to global messages.');
          realtimeRetryCount = 0;
          if (isPollingActive) stopPollingFallback();
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          handleRealtimeError(userId, 'Messages channel failed: ' + status);
        }
      });

    } catch (e) {
      handleRealtimeError(userId, e.message);
    }
  }

  function handleRealtimeError(userId, errorMsg) {
    console.warn(`[RealtimeNotifier] Realtime error: ${errorMsg}. Retry count: ${realtimeRetryCount}`);
    realtimeRetryCount++;
    
    cleanupChannels();

    if (realtimeRetryCount >= MAX_RETRIES) {
      console.warn('[RealtimeNotifier] Reached max realtime retries. Falling back to HTTP polling.');
      startPollingFallback();
      
      if (!reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          console.log('[RealtimeNotifier] Reconnecting to Supabase Realtime...');
          connectRealtime(userId);
        }, 15 * 60 * 1000);
      }
    } else {
      setTimeout(() => {
        if (!isPollingActive && !globalInviteChannel) {
          connectRealtime(userId);
        }
      }, 5000);
    }
  }

  function cleanupChannels() {
    const client = typeof window.getSupabaseRendererClient === 'function' ? window.getSupabaseRendererClient() : null;
    if (client) {
      try {
        if (globalInviteChannel) {
          client.removeChannel(globalInviteChannel);
          globalInviteChannel = null;
        }
        if (globalChatChannel) {
          client.removeChannel(globalChatChannel);
          globalChatChannel = null;
        }
      } catch (e) {
        console.warn('[RealtimeNotifier] Failed to cleanup channels:', e);
      }
    }
  }

  function startPollingFallback() {
    if (isPollingActive) return;
    isPollingActive = true;
    console.log('[RealtimeNotifier] Polling fallback active. Checking every 3 minutes.');

    pollCheck();

    pollingInterval = setInterval(() => {
      pollCheck();
    }, 3 * 60 * 1000);
  }

  function stopPollingFallback() {
    isPollingActive = false;
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    console.log('[RealtimeNotifier] Polling fallback stopped.');
  }

  async function pollCheck() {
    console.log('[RealtimeNotifier] Performing HTTP poll check...');
    const client = typeof window.getSupabaseRendererClient === 'function' ? window.getSupabaseRendererClient() : null;
    if (!client || !window.currentProfile) return;

    try {
      if (typeof window.loadAndRenderInvitations === 'function') {
        window.loadAndRenderInvitations();
      }

      const customLists = window.currentProfile?.custom_lists || [];
      const userListIds = customLists.map(l => l.id);
      if (userListIds.length === 0) return;

      const queryTime = new Date(lastCheckedMessagesTime).toISOString();
      const { data: messages, error } = await client
        .from('collection_messages')
        .select('id, list_id, profile_id, message, created_at')
        .in('list_id', userListIds)
        .gt('created_at', queryTime)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (messages && messages.length > 0) {
        const senderIds = [...new Set(messages.map(m => m.profile_id))].filter(id => id !== window.currentProfile.id);
        const sendersMap = new Map();
        
        if (senderIds.length > 0) {
          const { data: profiles } = await client
            .from('account_profiles')
            .select('id, name')
            .in('id', senderIds);
          
          if (profiles) {
            profiles.forEach(p => sendersMap.set(p.id, p.name));
          }
        }

        messages.forEach(msg => {
          if (String(msg.profile_id) === String(window.currentProfile.id)) return;

          const list = customLists.find(l => String(l.id) === String(msg.list_id));
          if (!list) return;

          const isChatOpen = chatSidebar && chatSidebar.classList.contains('active');
          if (isChatOpen && String(activeListId) === String(msg.list_id)) return;

          const senderName = sendersMap.get(msg.profile_id) || 'A friend';
          if (typeof window.addNotification === 'function') {
            window.addNotification(
              list.name || 'Shared List',
              `${senderName}: ${msg.message}`,
              'chat'
            );
          }
        });

        const newestMsg = messages[messages.length - 1];
        lastCheckedMessagesTime = new Date(newestMsg.created_at).getTime();
      } else {
        lastCheckedMessagesTime = Date.now();
      }

    } catch (e) {
      console.warn('[RealtimeNotifier] Polling check failed:', e);
    }
  }

  function stopNotificationSync() {
    console.log('[RealtimeNotifier] Stopping notification sync.');
    cleanupChannels();
    stopPollingFallback();
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  // Export interface
  window.socialPresence = {
    toggleChat: window.toggleVaultChat,
    subscribeChat: window.subscribeToListChat,
    renderPlaybackPins: window.renderSocialPlaybackPins,
    renderEpisodePresence: window.renderEpisodePresence,
    renderInvitedFriends: window.renderInvitedFriends,
    startNotificationSync,
    stopNotificationSync
  };

})();
