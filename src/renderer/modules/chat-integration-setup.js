/**
 * chat-integration-setup.js
 * Bridges ChatSlashCommands and ChatMediaRenderer with the chat input & Supabase Realtime channel.
 */

(function () {
  /**
   * Initializes the slash commands system on the active chat input field
   */
  function setupChatSlashCommands(chatInputSelector, searchFn, onSendPayload) {
    const chatInput = document.querySelector(chatInputSelector || '.chat-input-field, .vault-chat-input, input[placeholder*="Message"]');

    if (!chatInput) {
      console.warn('[SlashCommands] Chat input not found. Retrying in 1s...');
      setTimeout(() => setupChatSlashCommands(chatInputSelector, searchFn, onSendPayload), 1000);
      return;
    }

    console.log('[SlashCommands] Chat input target bound successfully:', chatInput);

    // Fallback search function using TMDB bridge if none provided
    const mediaSearch = searchFn || async function (query) {
      try {
        if (window.api && window.api.invoke) {
          const results = await window.api.invoke('search-tmdb', { query, type: 'multi' });
          return (results || []).slice(0, 8);
        }
        return [];
      } catch (err) {
        console.error('[SlashCommands] Search execution failed:', err);
        return [];
      }
    };

    // Callback when media item is selected from autocomplete menu
    const handleSelect = (item) => {
      const payload = {
        type: 'media_share',
        mediaId: item.id || item.tmdb_id,
        title: item.title || item.name,
        posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '',
        mediaType: item.media_type || (item.title ? 'movie' : 'series'),
        releaseDate: item.release_date || item.first_air_date || '',
        timestamp: new Date().toISOString()
      };

      if (onSendPayload) {
        onSendPayload(payload);
      } else if (window.activeChatChannel) {
        // Fallback: send message directly to Supabase Realtime Channel
        window.activeChatChannel.send({
          type: 'broadcast',
          event: 'chat_message',
          payload: { content: payload }
        });
      }
    };

    // Initialize the module listener
    if (window.ChatSlashCommands && window.ChatSlashCommands.init) {
      window.ChatSlashCommands.init(chatInput, mediaSearch, handleSelect);
    }
  }

  window.ChatIntegrationSetup = { setupChatSlashCommands };
})();
