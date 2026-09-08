/* ═══════════════════════════════════════════════════════════════════════════
   MEEM — BUG REPORT & ADMIN INBOX MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

/* global appData, showToast */

(function () {
  'use strict';

  let selectedCategory = 'playback';
  let selectedSeverity = 'normal';
  let attachedImages = []; // Array of { name, type, dataUrl, size }
  let adminReportsCache = [];
  let currentAdminTab = 'submit'; // 'submit' | 'admin'
  let currentFilterStatus = 'all';
  let currentFilterCategory = 'all';
  let currentSearchQuery = '';

  const ADMIN_EMAILS = [
    'amro.motawa@icloud.com',
    'amromotaw3@gmail.com',
    'amro.motawa@gmail.com'
  ];

  function getSupabaseClient() {
    if (window._supabaseRendererClientShared) return window._supabaseRendererClientShared;
    if (typeof window.getSupabaseRendererClient === 'function') {
      try { return window.getSupabaseRendererClient(); } catch (_) {}
    }
    if (window.supabase) {
      const url = window.MEDIAVAULT_SUPABASE_URL || window.SUPABASE_URL || 'https://vvjnkgdrhyxilnderjdy.supabase.co';
      const key = window.MEDIAVAULT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2am5rZ2RyaHl4aWxuZGVyamR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTM2ODEsImV4cCI6MjA5NDg4OTY4MX0.Rb1OLJGXDToYZz-8h_gy2UNx_ou0P6BwGXc1ExFWSCU';
      return window.supabase.createClient(url, key);
    }
    return null;
  }

  function isCurrentUserAdmin() {
    const email = (appData?.user?.email || '').toLowerCase().trim();
    const role = (appData?.user?.role || '').toLowerCase().trim();
    return role === 'admin' || ADMIN_EMAILS.includes(email);
  }

  function getSystemInfo() {
    const userAgent = navigator.userAgent || '';
    let platform = 'Desktop (Windows)';
    if (/android/i.test(userAgent)) platform = 'Android Mobile';
    else if (/mac/i.test(userAgent)) platform = 'macOS';
    else if (/linux/i.test(userAgent)) platform = 'Linux';

    return {
      app_version: '3.10.0',
      platform: platform,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      window_size: `${window.innerWidth}x${window.innerHeight}`,
      user_agent: userAgent,
      user_email: appData?.user?.email || 'Anonymous / Guest',
      user_id: appData?.user?.id || null,
      online: navigator.onLine,
      timestamp: new Date().toISOString()
    };
  }

  // ---------- Image Compression & Conversion ----------
  async function fileToDataUrl(file, maxWidth = 1600, maxHeight = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            if (width / height > maxWidth / maxHeight) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({
            name: file.name || `screenshot_${Date.now()}.jpg`,
            type: 'image/jpeg',
            dataUrl: compressedDataUrl,
            size: compressedDataUrl.length
          });
        };
        img.onerror = () => reject(new Error('Invalid image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function addImagesToAttachmentList(files) {
    if (!files || files.length === 0) return;
    const maxFiles = 5;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    Array.from(files).forEach(async (file) => {
      if (attachedImages.length >= maxFiles) {
        if (typeof showToast === 'function') showToast('Maximum 5 screenshots allowed');
        return;
      }
      if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/')) {
        if (typeof showToast === 'function') showToast('Only image files are allowed');
        return;
      }
      try {
        const compressed = await fileToDataUrl(file);
        attachedImages.push(compressed);
        renderAttachmentsList();
      } catch (err) {
        console.error('[BUG_REPORT] Failed to process image:', err);
      }
    });
  }

  function renderAttachmentsList() {
    const grid = document.getElementById('bug-attachments-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (attachedImages.length === 0) {
      grid.style.display = 'none';
      return;
    }
    grid.style.display = 'grid';

    attachedImages.forEach((img, idx) => {
      const item = document.createElement('div');
      item.className = 'bug-thumb-item';
      item.innerHTML = `
        <img class="bug-thumb-img" src="${img.dataUrl}" alt="${img.name}">
        <button type="button" class="bug-thumb-delete" data-index="${idx}" title="Remove">
          <i class="fa-solid fa-xmark"></i>
        </button>
      `;

      item.querySelector('.bug-thumb-img').addEventListener('click', () => {
        openLightbox(img.dataUrl);
      });

      item.querySelector('.bug-thumb-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        attachedImages.splice(idx, 1);
        renderAttachmentsList();
      });

      grid.appendChild(item);
    });
  }

  function openLightbox(src) {
    let lightbox = document.getElementById('bug-lightbox-modal');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'bug-lightbox-modal';
      lightbox.className = 'bug-lightbox-modal';
      lightbox.innerHTML = `
        <button class="bug-lightbox-close"><i class="fa-solid fa-xmark"></i></button>
        <img class="bug-lightbox-img" src="" alt="Enlarged screenshot">
      `;
      document.body.appendChild(lightbox);

      lightbox.addEventListener('click', (e) => {
        if (e.target !== lightbox.querySelector('.bug-lightbox-img')) {
          lightbox.classList.remove('active');
        }
      });
      lightbox.querySelector('.bug-lightbox-close').addEventListener('click', () => {
        lightbox.classList.remove('active');
      });
    }

    lightbox.querySelector('.bug-lightbox-img').src = src;
    lightbox.classList.add('active');
  }

  // ---------- Form Submission ----------
  async function handleBugReportSubmit(e) {
    if (e) e.preventDefault();
    const titleInput = document.getElementById('bug-input-title');
    const descInput = document.getElementById('bug-input-description');
    const stepsInput = document.getElementById('bug-input-steps');
    const submitBtn = document.getElementById('bug-btn-submit');
    const includeDiag = document.getElementById('bug-chk-diag')?.checked ?? true;

    const title = (titleInput?.value || '').trim();
    const description = (descInput?.value || '').trim();
    const steps = (stepsInput?.value || '').trim();

    if (!title) {
      if (typeof showToast === 'function') showToast('Please enter an issue title');
      titleInput?.focus();
      return;
    }
    if (!description) {
      if (typeof showToast === 'function') showToast('Please describe the problem');
      descInput?.focus();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
    }

    const systemInfo = includeDiag ? getSystemInfo() : { app_version: '3.10.0' };
    const userEmail = appData?.user?.email || null;
    const userId = appData?.user?.id || null;

    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase connection unavailable');

      // Upload attachments or store as compressed JSON payload
      const attachmentsPayload = attachedImages.map(img => ({
        name: img.name,
        type: img.type,
        dataUrl: img.dataUrl,
        size: img.size
      }));

      const { data, error } = await client.rpc('submit_bug_report', {
        p_title: title,
        p_category: selectedCategory,
        p_description: description,
        p_steps_to_reproduce: steps || null,
        p_severity: selectedSeverity,
        p_system_info: systemInfo,
        p_attachments: attachmentsPayload,
        p_user_email: userEmail,
        p_user_id: userId
      });

      if (error) throw error;
      if (data && data.success === false) throw new Error(data.error || 'Submission failed');

      if (typeof showToast === 'function') {
        showToast('✓ Bug report submitted successfully! Thank you.', 4000);
      }

      // Reset form
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';
      if (stepsInput) stepsInput.value = '';
      attachedImages = [];
      renderAttachmentsList();

      // If admin, refresh the inbox
      if (isCurrentUserAdmin()) {
        loadAdminBugReports();
      }
    } catch (err) {
      console.error('[BUG_REPORT] Submission error:', err);
      if (typeof showToast === 'function') {
        showToast('Error submitting report: ' + err.message);
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Report';
      }
    }
  }

  // ---------- Admin Inbox & Dashboard ----------
  async function loadAdminBugReports() {
    const container = document.getElementById('bug-reports-feed');
    const loadingEl = document.getElementById('bug-admin-loading');
    const userEmail = appData?.user?.email || null;
    const userId = appData?.user?.id || null;

    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const client = getSupabaseClient();
      if (!client) return;

      const { data, error } = await client.rpc('get_bug_reports', {
        p_user_email: userEmail,
        p_user_id: userId,
        p_status: currentFilterStatus,
        p_category: currentFilterCategory,
        p_limit: 100,
        p_offset: 0
      });

      if (error) throw error;
      if (data && data.success) {
        adminReportsCache = data.reports || [];
        updateAdminStats(data.stats || {});
        renderAdminReportsFeed();
      }
    } catch (err) {
      console.error('[BUG_REPORT] Failed to load admin reports:', err);
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding: 40px; color:#ef4444;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:24px; margin-bottom:10px;"></i>
            <p>Failed to load bug reports: ${err.message}</p>
          </div>
        `;
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function updateAdminStats(stats) {
    const totalEl = document.getElementById('bug-stat-total');
    const openEl = document.getElementById('bug-stat-open');
    const progEl = document.getElementById('bug-stat-progress');
    const resEl = document.getElementById('bug-stat-resolved');
    const tabBadge = document.getElementById('bug-admin-tab-badge');

    if (totalEl) totalEl.innerText = stats.total || '0';
    if (openEl) openEl.innerText = stats.open || '0';
    if (progEl) progEl.innerText = stats.in_progress || '0';
    if (resEl) resEl.innerText = stats.resolved || '0';

    if (tabBadge) {
      const openCount = stats.open || 0;
      if (openCount > 0) {
        tabBadge.innerText = openCount;
        tabBadge.style.display = 'inline-block';
      } else {
        tabBadge.style.display = 'none';
      }
    }
  }

  function renderAdminReportsFeed() {
    const container = document.getElementById('bug-reports-feed');
    if (!container) return;

    let reports = [...adminReportsCache];

    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      reports = reports.filter(r => 
        (r.title || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.user_email || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      );
    }

    if (reports.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 60px 20px; color:#71717a;">
          <i class="fa-solid fa-inbox" style="font-size:36px; margin-bottom:14px; opacity:0.4;"></i>
          <h3 style="color:#ffffff; font-size:16px; margin-bottom:4px;">No Bug Reports Found</h3>
          <p style="font-size:13px;">Everything is running smoothly or no reports match your filter.</p>
        </div>
      `;
      return;
    }

    const catLabels = {
      playback: '🎬 Video Playback',
      ui: '🎨 UI & Theming',
      addons: '🧩 Add-ons / Stremio',
      iptv: '📺 Live TV & Radio',
      account: '👤 Account & VIP',
      performance: '⚡ Performance',
      general: '💡 General / Other'
    };

    container.innerHTML = reports.map(r => {
      const dateStr = new Date(r.created_at).toLocaleString();
      const statusClass = `bug-badge-status-${r.status || 'open'}`;
      const catLabel = catLabels[r.category] || r.category || 'General';
      const user = r.user_email || 'Anonymous User';
      const attachments = Array.isArray(r.attachments) ? r.attachments : [];
      const sysInfo = r.system_info || {};

      return `
        <div class="bug-report-item" data-id="${r.id}">
          <div class="bug-item-header">
            <div class="bug-item-title-group">
              <div class="bug-item-badges">
                <span class="bug-badge ${statusClass}">${(r.status || 'open').replace('_', ' ')}</span>
                <span class="bug-badge bug-badge-cat">${catLabel}</span>
                <span class="bug-badge" style="background:rgba(255,255,255,0.03); color:#a1a1aa; border:1px solid rgba(255,255,255,0.06);">${r.severity || 'normal'}</span>
              </div>
              <h3 class="bug-item-title">${escapeHtml(r.title)}</h3>
              <div class="bug-item-meta">
                <span><i class="fa-regular fa-user"></i> ${escapeHtml(user)}</span>
                <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
                ${sysInfo.platform ? `<span><i class="fa-solid fa-desktop"></i> ${escapeHtml(sysInfo.platform)} (${escapeHtml(sysInfo.app_version || 'v3.10.0')})</span>` : ''}
              </div>
            </div>
          </div>

          <div class="bug-item-body">${escapeHtml(r.description)}</div>

          ${r.steps_to_reproduce ? `
            <div class="bug-item-steps">
              <strong style="color:#ffffff; display:block; margin-bottom:4px;"><i class="fa-solid fa-list-ol"></i> Steps to Reproduce:</strong>
              ${escapeHtml(r.steps_to_reproduce)}
            </div>
          ` : ''}

          ${attachments.length > 0 ? `
            <div class="bug-attachments-grid" style="margin-top:6px;">
              ${attachments.map((att) => `
                <div class="bug-thumb-item" onclick="window.MEEM_BugReport_openLightbox('${att.dataUrl}')">
                  <img class="bug-thumb-img" src="${att.dataUrl}" alt="${escapeHtml(att.name || 'attachment')}">
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${r.admin_notes ? `
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:10px 14px; border-radius:10px; font-size:12px; color:#d4d4d8;">
              <strong style="color:#ffffff;"><i class="fa-solid fa-comment-dots"></i> Admin Note:</strong> ${escapeHtml(r.admin_notes)}
            </div>
          ` : ''}

          <div class="bug-item-footer">
            <div class="bug-status-changer">
              <label style="font-size:11px; font-weight:700; color:#a1a1aa;">STATUS:</label>
              <select onchange="window.MEEM_BugReport_changeStatus('${r.id}', this.value)">
                <option value="open" ${r.status === 'open' ? 'selected' : ''}>Open</option>
                <option value="in_progress" ${r.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="resolved" ${r.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                <option value="closed" ${r.status === 'closed' ? 'selected' : ''}>Closed</option>
              </select>
            </div>

            <div style="display:flex; align-items:center; gap:8px;">
              <button class="bug-btn-sm" style="background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.12);" onclick="window.MEEM_BugReport_addNotePrompt('${r.id}', '${escapeAttr(r.admin_notes || '')}')">
                <i class="fa-solid fa-pen"></i> Add Note
              </button>
              <button class="bug-btn-sm bug-btn-delete" onclick="window.MEEM_BugReport_deleteReport('${r.id}')">
                <i class="fa-solid fa-trash-can"></i> Delete
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.MEEM_BugReport_openLightbox = openLightbox;

  window.MEEM_BugReport_changeStatus = async function(reportId, newStatus) {
    const userEmail = appData?.user?.email || null;
    const userId = appData?.user?.id || null;
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const { data, error } = await client.rpc('update_bug_report_status', {
        p_user_email: userEmail,
        p_report_id: reportId,
        p_status: newStatus,
        p_admin_notes: null,
        p_user_id: userId
      });

      if (error) throw error;
      if (typeof showToast === 'function') showToast(`Status updated to ${newStatus}`);
      loadAdminBugReports();
    } catch (err) {
      console.error('[BUG_REPORT] Error updating status:', err);
      if (typeof showToast === 'function') showToast('Failed to update status: ' + err.message);
    }
  };

  window.MEEM_BugReport_addNotePrompt = async function(reportId, existingNote) {
    const note = prompt('Enter admin note / resolution response:', existingNote || '');
    if (note === null) return;

    const userEmail = appData?.user?.email || null;
    const userId = appData?.user?.id || null;
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const { error } = await client.rpc('update_bug_report_status', {
        p_user_email: userEmail,
        p_report_id: reportId,
        p_status: null,
        p_admin_notes: note,
        p_user_id: userId
      });

      if (error) throw error;
      if (typeof showToast === 'function') showToast('Admin note saved');
      loadAdminBugReports();
    } catch (err) {
      console.error('[BUG_REPORT] Error saving note:', err);
      if (typeof showToast === 'function') showToast('Failed to save note: ' + err.message);
    }
  };

  window.MEEM_BugReport_deleteReport = async function(reportId) {
    if (!confirm('Are you sure you want to delete this bug report permanently?')) return;

    const userEmail = appData?.user?.email || null;
    const userId = appData?.user?.id || null;
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const { error } = await client.rpc('delete_bug_report', {
        p_user_email: userEmail,
        p_report_id: reportId,
        p_user_id: userId
      });

      if (error) throw error;
      if (typeof showToast === 'function') showToast('Bug report deleted');
      loadAdminBugReports();
    } catch (err) {
      console.error('[BUG_REPORT] Error deleting report:', err);
      if (typeof showToast === 'function') showToast('Failed to delete report: ' + err.message);
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // ---------- Init UI & Event Listeners ----------
  function initBugReportUI() {
    // 1. Category Pills
    document.querySelectorAll('.bug-cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.bug-cat-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        selectedCategory = pill.dataset.cat || 'general';
      });
    });

    // 2. Severity Pills
    document.querySelectorAll('.bug-sev-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.bug-sev-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        selectedSeverity = pill.dataset.sev || 'normal';
      });
    });

    // 3. Dropzone & File Input
    const dropzone = document.getElementById('bug-dropzone');
    const fileInput = document.getElementById('bug-file-input');
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        addImagesToAttachmentList(e.target.files);
        fileInput.value = '';
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          addImagesToAttachmentList(e.dataTransfer.files);
        }
      });
    }

    // 4. Clipboard paste for screenshots (Ctrl+V anywhere in Bug Report view)
    window.addEventListener('paste', (e) => {
      const activeView = document.querySelector('.view.active');
      if (activeView && activeView.id === 'view-bug-report') {
        if (e.clipboardData && e.clipboardData.items) {
          const items = e.clipboardData.items;
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
              const blob = items[i].getAsFile();
              if (blob) {
                addImagesToAttachmentList([blob]);
                if (typeof showToast === 'function') showToast('✓ Screenshot pasted from clipboard');
              }
            }
          }
        }
      }
    });

    // 5. Form Submit
    const form = document.getElementById('bug-report-form');
    if (form) {
      form.addEventListener('submit', handleBugReportSubmit);
    }

    // 6. View Tabs (Submit vs Admin Inbox)
    const tabSubmitBtn = document.getElementById('bug-tab-btn-submit');
    const tabAdminBtn = document.getElementById('bug-tab-btn-admin');
    const formSection = document.getElementById('bug-form-section');
    const adminSection = document.getElementById('bug-admin-section');

    if (tabSubmitBtn && tabAdminBtn) {
      tabSubmitBtn.addEventListener('click', () => {
        tabSubmitBtn.classList.add('active');
        tabAdminBtn.classList.remove('active');
        if (formSection) formSection.style.display = 'grid';
        if (adminSection) adminSection.style.display = 'none';
        currentAdminTab = 'submit';
      });

      tabAdminBtn.addEventListener('click', () => {
        tabAdminBtn.classList.add('active');
        tabSubmitBtn.classList.remove('active');
        if (formSection) formSection.style.display = 'none';
        if (adminSection) adminSection.style.display = 'flex';
        currentAdminTab = 'admin';
        loadAdminBugReports();
      });
    }

    // 7. Admin Filters & Search
    const filterStatus = document.getElementById('bug-filter-status');
    const filterCategory = document.getElementById('bug-filter-category');
    const filterSearch = document.getElementById('bug-filter-search');
    const refreshBtn = document.getElementById('bug-btn-refresh');

    if (filterStatus) {
      filterStatus.addEventListener('change', (e) => {
        currentFilterStatus = e.target.value;
        loadAdminBugReports();
      });
    }

    if (filterCategory) {
      filterCategory.addEventListener('change', (e) => {
        currentFilterCategory = e.target.value;
        loadAdminBugReports();
      });
    }

    if (filterSearch) {
      let debounceTimer = null;
      filterSearch.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentSearchQuery = e.target.value.trim();
          renderAdminReportsFeed();
        }, 200);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadAdminBugReports();
      });
    }

    // Dynamic Admin Tab Visibility
    checkAndApplyAdminState();
  }

  function checkAndApplyAdminState() {
    const tabAdminBtn = document.getElementById('bug-tab-btn-admin');
    const isAdmin = isCurrentUserAdmin();

    if (tabAdminBtn) {
      if (isAdmin) {
        tabAdminBtn.style.display = 'inline-flex';
        // Auto-fetch count for badge
        loadAdminBugReports();
      } else {
        tabAdminBtn.style.display = 'none';
      }
    }
  }

  // Hook into auth state changes to update admin visibility
  window.addEventListener('meem-auth-updated', checkAndApplyAdminState);

  document.addEventListener('DOMContentLoaded', () => {
    initBugReportUI();
  });

  window.initBugReportUI = initBugReportUI;
  window.checkAndApplyAdminState = checkAndApplyAdminState;

})();
