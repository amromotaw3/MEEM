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
    /* ── Vault Chat Backdrop ── */
    .vault-chat-backdrop {
      position: fixed; top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 9998;
      opacity: 0; pointer-events: none;
      transition: opacity 0.35s ease;
    }
    .vault-chat-backdrop.active { opacity: 1; pointer-events: auto; }

    /* ── Chat Drawer (Glassmorphic) ── */
    .vault-chat-drawer {
      position: fixed;
      top: 0; right: -400px;
      width: 380px; height: 100vh;
      background: linear-gradient(135deg, rgba(13,13,24,0.95) 0%, rgba(8,8,16,0.98) 100%);
      border-left: 1px solid rgba(255,255,255,0.12);
      z-index: 9999;
      display: flex; flex-direction: column;
      box-shadow: -30px 0 80px rgba(0,0,0,0.9), -10px 0 40px rgba(99,102,241,0.1);
      transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    .vault-chat-drawer.active { transform: translateX(-400px); }
    .vault-chat-drawer.fullscreen {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      right: 0;
      border-radius: 0;
      box-shadow: none;
    }

    /* ── Scrollbar ── */
    .vault-chat-messages::-webkit-scrollbar { width: 4px; }
    .vault-chat-messages::-webkit-scrollbar-track { background: transparent; }
    .vault-chat-messages::-webkit-scrollbar-thumb { background: rgba(129,140,248,0.25); border-radius: 2px; }

    /* ── Unread Badge ── */
    .chat-unread-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #f43f5e, #ef4444);
      color: #fff; font-size: 9px; font-weight: 900;
      min-width: 17px; height: 17px; border-radius: 10px;
      padding: 0 4px; margin-left: 6px;
      box-shadow: 0 0 10px rgba(239,68,68,0.7);
      vertical-align: middle; letter-spacing: 0.3px;
    }

    /* ── Header ── */
    .vault-chat-header {
      padding: 20px 22px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: space-between;
      background: linear-gradient(180deg, rgba(99,102,241,0.08) 0%, transparent 100%);
      flex-shrink: 0;
    }
    .vault-chat-drawer.fullscreen .vault-chat-header {
      padding: 25px 30px;
    }
    .vault-chat-header-left {
      display: flex; align-items: center; gap: 12px;
    }
    .vault-chat-header-icon {
      width: 42px; height: 42px; border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #818cf8);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; color: #fff;
      box-shadow: 0 6px 16px rgba(99,102,241,0.4);
    }
    .vault-chat-header-title {
      font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -0.3px;
    }
    .vault-chat-header-sub {
      font-size: 11px; color: rgba(165,180,252,0.75); margin-top: 2px; font-weight: 500;
    }
    .vault-chat-header-actions {
      display: flex; gap: 8px; align-items: center;
    }
    .vault-chat-fullscreen-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      width: 36px; height: 36px;
      color: rgba(255,255,255,0.7);
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-fullscreen-btn:hover {
      background: rgba(99,102,241,0.2);
      border-color: rgba(99,102,241,0.4);
      color: #818cf8;
    }
    .vault-chat-close {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      width: 36px; height: 36px;
      color: rgba(255,255,255,0.6);
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-close:hover { 
      background: rgba(239,68,68,0.15); 
      border-color: rgba(239,68,68,0.4); 
      color: #f87171; 
    }

    /* ── Messages List ── */
    .vault-chat-messages {
      flex: 1; overflow-y: auto;
      padding: 18px 16px;
      display: flex; flex-direction: column;
      gap: 12px;
      background: linear-gradient(180deg, rgba(15,15,25,0.4) 0%, rgba(10,10,20,0.2) 100%);
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
      border: 2px solid rgba(129,140,248,0.6);
      box-shadow: 0 4px 12px rgba(99,102,241,0.2);
    }
    .vault-chat-message-row.own .vault-chat-avatar {
      border-color: rgba(99,102,241,0.8);
      box-shadow: 0 4px 16px rgba(99,102,241,0.3);
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
      font-size: 12px; font-weight: 800; color: #a5b4fc;
      white-space: nowrap;
      text-transform: capitalize;
    }
    .vault-chat-message-row.own .vault-chat-msg-sender { color: rgba(255,255,255,0.9); }
    .vault-chat-msg-time {
      font-size: 10px; color: rgba(255,255,255,0.3); white-space: nowrap;
    }
    .vault-chat-msg-body {
      background: rgba(99,102,241,0.08);
      border: 1.5px solid rgba(129,140,248,0.25);
      border-radius: 18px 18px 18px 6px;
      padding: 11px 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(10px);
    }
    .vault-chat-message-row.own .vault-chat-msg-body {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      border: 1.5px solid rgba(99,102,241,0.8);
      border-radius: 18px 18px 6px 18px;
      box-shadow: 0 6px 24px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
    }
    .vault-chat-msg-text {
      font-size: 13.5px; color: rgba(255,255,255,0.95);
      line-height: 1.48; word-break: break-word;
    }
    .vault-chat-message-row.own .vault-chat-msg-text { color: #ffffff; }

    /* ── Typing Indicator ── */
    .vault-chat-typing-container {
      padding: 0 14px;
      display: flex; align-items: center; gap: 7px;
      opacity: 0; max-height: 0; overflow: hidden;
      transition: opacity 0.3s ease, max-height 0.3s ease, padding 0.3s ease;
      font-size: 11.5px; color: #a5b4fc; font-style: italic;
    }
    .vault-chat-typing-container.active {
      opacity: 1; max-height: 36px;
      padding: 6px 14px 8px;
    }
    .typing-dots { display: flex; gap: 3px; align-items: center; }
    .typing-dots span {
      width: 5px; height: 5px; border-radius: 50%;
      background: #818cf8;
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
      border-top: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(8,8,16,0.7) 0%, rgba(5,5,15,0.9) 100%);
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
      background: rgba(129,140,248,0.15);
      border: 1.5px solid rgba(129,140,248,0.3);
      color: #818cf8; 
      cursor: pointer; 
      font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s ease;
    }
    .vault-chat-attachment-btn:hover {
      background: rgba(129,140,248,0.25);
      border-color: rgba(129,140,248,0.6);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(129,140,248,0.2);
    }
    .vault-chat-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1.5px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      padding: 11px 18px;
      color: #fff; font-size: 14px; font-family: inherit;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      line-height: 1.4;
    }
    .vault-chat-input::placeholder { color: rgba(255,255,255,0.35); }
    .vault-chat-input:focus {
      border-color: rgba(99,102,241,0.7);
      background: rgba(99,102,241,0.1);
      box-shadow: 0 0 0 4px rgba(99,102,241,0.15), inset 0 0 0 1px rgba(99,102,241,0.2);
    }
    .vault-chat-send-btn {
      width: 44px; height: 44px; flex-shrink: 0;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      border: none; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 6px 18px rgba(99,102,241,0.4);
      transition: all 0.2s ease;
      font-weight: 600;
    }
    .vault-chat-send-btn:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 26px rgba(99,102,241,0.6);
      background: linear-gradient(135deg, #818cf8, #6366f1);
    }
    .vault-chat-send-btn:active { 
      transform: translateY(-1px);
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
      <div class="vault-chat-header">
        <div class="vault-chat-header-left">
          <div class="vault-chat-header-icon"><i class="fas fa-comments"></i></div>
          <div>
            <div class="vault-chat-header-title">Vault Chat</div>
            <div class="vault-chat-header-sub">Share notes with your team</div>
          </div>
        </div>
        <div class="vault-chat-header-actions">
          <button class="vault-chat-fullscreen-btn" id="vault-chat-fullscreen-btn" title="Detach Chat"><i class="fas fa-external-link-alt"></i></button>
          <button class="vault-chat-close" onclick="window.socialPresence.toggleChat(false)"><i class="fas fa-times"></i></button>
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
      <input type="file" id="vault-chat-file-input" accept="image/*" style="display: none;" />
    `;
    document.body.appendChild(chatSidebar);

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
            profile_avatar: currentProfile.avatar || 'imgs/avatars/default.jpg'
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

  // Toggle Vault Chat Drawer visibility
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
    
    let backdrop = document.getElementById('vault-chat-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'vault-chat-backdrop';
      backdrop.className = 'vault-chat-backdrop';
      backdrop.onclick = () => window.toggleVaultChat(false);
      document.body.appendChild(backdrop);
    }

    if (targetState) {
      chatSidebar.classList.add('active');
      backdrop.classList.add('active');
      unreadCount = 0;
      updateUnreadBadge();
      loadChatHistory();
    } else {
      chatSidebar.classList.remove('active');
      backdrop.classList.remove('active');
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

      // Note: filter property removed — server-side UUID filtering can break on some Supabase plans.
      // We filter by list_id in JS instead.
      activeChatChannel = client
        .channel(`collection-messages:${listId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'collection_messages'
          },
          async (payload) => {
            try {
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
                  .select('name, avatar')
                  .eq('id', payload.new.profile_id)
                  .maybeSingle();

                const profData = Array.isArray(prof) ? prof[0] : prof;
                appendMessageToUI({
                  ...payload.new,
                  profile_name: profData?.name || 'Friend',
                  profile_avatar: profData?.avatar || 'imgs/avatars/default.jpg'
                });
              } catch (err) {
                appendMessageToUI(payload.new);
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
            profile_avatar: profData?.avatar || 'imgs/avatars/default.jpg'
          }, false);
        });
        scrollToBottom();
      } else {
        messagesEl.innerHTML = '<div class="chat-placeholder" style="text-align:center;color:rgba(255,255,255,0.25);font-size:12px;padding:40px 20px;line-height:1.6;"><i class="fas fa-comments" style="font-size:28px;display:block;margin-bottom:10px;opacity:0.3;"></i>No messages yet.<br>Be the first to share a note!</div>';
      }
    } catch (e) {
      console.error('[Chat] Failed to load history:', e);
      messagesEl.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:12px;padding:20px 0;">Failed to load chat history.</div>';
    }
  }

  // Send message
  async function sendChatMessage() {
    const inputField = document.getElementById('vault-chat-input-field');
    const text = inputField.value.trim();
    if (!text || !activeListId) return;

    const currentProfile = window.currentProfile;
    if (!currentProfile) return;

    inputField.value = '';

    // Clear local typing state instantly when sending
    emitTypingEvent(false);
    isTypingSent = false;
    clearTimeout(typingTimeout);

    try {
      const res = await window.api.invoke('cloud-send-chat-message', {
        listId: activeListId,
        profileId: currentProfile.id,
        text
      });
      if (!res.success) throw new Error(res.error || 'Failed to send message');
      const data = res.data;

      if (data) {
        appendMessageToUI({
          ...data,
          profile_name: currentProfile.name || 'You',
          profile_avatar: currentProfile.avatar || 'imgs/avatars/default.jpg'
        });
      }
    } catch (e) {
      console.error('[Chat] Failed to send message:', e);
      showToast('Failed to send message: ' + e.message);
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
    if (!avatar || avatar.includes('default.jpg')) {
      avatar = 'imgs/avatars/default.jpg';
    }
    if (typeof window.localImg === 'function') avatar = window.localImg(avatar);

    const timeString = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    const msgRow = document.createElement('div');
    msgRow.className = `vault-chat-message-row${isOwnMessage ? ' own' : ''}`;

    let bodyContent = '';
    const isImage = msg.message_text && msg.message_text.startsWith('[IMAGE]:');
    if (isImage) {
      const imgUrl = msg.message_text.substring(8);
      bodyContent = `<img src="${imgUrl}" style="max-width: 100%; max-height: 250px; border-radius: 10px; display: block; margin-top: 4px; cursor: pointer;" onclick="window.api.invoke('open-external', '${imgUrl}')" />`;
    } else {
      bodyContent = `<div class="vault-chat-msg-text">${escapeHTML(msg.message_text)}</div>`;
    }

    msgRow.innerHTML = `
      <div class="vault-chat-avatar" style="background-image: url('${avatar}')"></div>
      <div class="vault-chat-bubble">
        <div class="vault-chat-bubble-header" style="${isOwnMessage ? 'flex-direction: row-reverse;' : ''}">
          <span class="vault-chat-msg-sender">${escapeHTML(name)}</span>
          <span class="vault-chat-msg-time">${timeString}</span>
        </div>
        <div class="vault-chat-msg-body" style="${isImage ? 'padding: 4px 6px;' : ''}">
          ${bodyContent}
        </div>
      </div>
    `;

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

      // Find list IDs the current user is a member of
      const { data: memberLists, error: err } = await client
        .from('list_members')
        .select('list_id')
        .eq('user_id', currentUserId)
        .eq('status', 'joined');

      if (err) throw err;

      const sharedListIds = (memberLists || []).map(m => m.list_id);
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
          badge.style.backgroundImage = `url('${watcherProfile.avatar || 'imgs/avatars/default.jpg'}')`;
          
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
              av.style.backgroundImage = `url('${prof.avatar || 'imgs/avatars/default.jpg'}')`;
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
          profile_avatar: profData?.avatar || 'imgs/avatars/default.jpg'
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
        avatar.style.backgroundImage = `url('${profile.avatar || 'imgs/avatars/default.jpg'}')`;
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

  // Export interface
  window.socialPresence = {
    toggleChat: window.toggleVaultChat,
    subscribeChat: window.subscribeToListChat,
    renderPlaybackPins: window.renderSocialPlaybackPins,
    renderEpisodePresence: window.renderEpisodePresence,
    renderInvitedFriends: window.renderInvitedFriends
  };

})();
