/**
 * INTEGRATION EXAMPLE: How to use slash commands in your chat
 * 
 * Usage in your social-presence.js or chat.js:
 */

// 1. ADD THESE SCRIPT TAGS TO index.html:
// <link rel="stylesheet" href="css/chat-slash-commands.css">
// <link rel="stylesheet" href="css/chat-media-renderer.css">
// <script src="modules/chat-slash-commands.js"></script>
// <script src="modules/chat-media-renderer.js"></script>

// 2. IN YOUR CHAT INIT FUNCTION:

async function initChatWithSlashCommands() {
  const chatInput = document.querySelector('.chat-input, input[placeholder*="Message"]');
  
  if (!chatInput) {
    console.error('[Chat] Input element not found');
    return;
  }

  // Define a search function (use your existing TMDB search or bridge function)
  const searchMediaFn = async (query) => {
    try {
      // Call your existing search function
      // Example: await window.api.invoke('search-tmdb', query);
      const results = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json());
      return results;
    } catch (err) {
      console.error('[Chat] Search error:', err);
      return [];
    }
  };

  // Define callback when media is selected
  const onMediaSelected = async (mediaItem) => {
    const payload = createMediaSharePayload(mediaItem);
    
    // Send through Supabase Realtime or your chat API
    await sendChatMessage({
      ...payload,
      conversationId: getCurrentConversationId()
    });

    // Show confirmation toast
    showToast(`Shared: ${mediaItem.title}`, 'success');
  };

  // Initialize slash command listener
  window.onSlashMediaSelected = onMediaSelected;
  initSlashCommands(chatInput, searchMediaFn, onMediaSelected);

  console.log('[Chat] Slash commands initialized');
}

// 3. IN YOUR MESSAGE RENDERING LOOP:

async function sendChatMessage(messageData) {
  try {
    // Insert into Supabase or your database
    const { data, error } = await supabase
      .from('chat_messages')
      .insert([{
        conversation_id: messageData.conversationId,
        type: messageData.type,
        content: messageData.type === 'media_share' ? '' : messageData.content,
        media_id: messageData.mediaId,
        title: messageData.title,
        poster_url: messageData.posterUrl,
        media_type: messageData.mediaType,
        user_id: getCurrentUserId(),
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;

    // Broadcast through Realtime
    supabase
      .channel(`chat:${messageData.conversationId}`)
      .send({
        type: 'broadcast',
        event: 'message_added',
        payload: data[0]
      });

  } catch (err) {
    console.error('[Chat] Send error:', err);
    showToast('Failed to send message', 'error');
  }
}

// 4. IN YOUR MESSAGE RENDER FUNCTION:

function renderChatMessages(messages) {
  const chatContainer = document.querySelector('.chat-messages-container');
  
  messages.forEach(msg => {
    // Convert database message to client format
    const formattedMsg = {
      id: msg.id,
      type: msg.type || 'text',
      content: msg.content,
      mediaId: msg.media_id,
      title: msg.title,
      posterUrl: msg.poster_url,
      mediaType: msg.media_type,
      releaseDate: msg.release_date
    };

    // Render using the media renderer
    const messageEl = renderChatMessage(formattedMsg, (media) => {
      // Handle click on media card
      window.openUnifiedDetail({
        mediaId: media.mediaId,
        type: media.mediaType,
        title: media.title,
        posterPath: media.posterUrl
      });
    });

    chatContainer.appendChild(messageEl);
  });
}

// 5. SET UP REALTIME LISTENER:

function setupChatRealtimeListener(conversationId) {
  supabase
    .channel(`chat:${conversationId}`)
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`
      },
      (payload) => {
        const newMsg = {
          id: payload.new.id,
          type: payload.new.type || 'text',
          content: payload.new.content,
          mediaId: payload.new.media_id,
          title: payload.new.title,
          posterUrl: payload.new.poster_url,
          mediaType: payload.new.media_type,
          user: payload.new.user_id
        };

        const messageEl = renderChatMessage(newMsg, (media) => {
          window.openUnifiedDetail({
            mediaId: media.mediaId,
            type: media.mediaType,
            title: media.title
          });
        });

        document.querySelector('.chat-messages-container').appendChild(messageEl);
      }
    )
    .subscribe();
}

// BONUS: Helper utilities

function getCurrentConversationId() {
  // Return the current conversation ID from your app state
  return window.appState?.currentConversation?.id;
}

function getCurrentUserId() {
  return window.appState?.user?.id;
}

function showToast(message, type = 'info') {
  // Use your existing toast function
  if (window.showToast) {
    window.showToast(message);
  }
}
