/**
 * MediaVault v2 Disclaimer & Legal Terms System
 * Pure Pitch Black & White Minimalist Theme (B&W Minimalist Card Layout).
 */

(function () {
  'use strict';

  // Helper to create glassmorphic modal overlays dynamically
  function createDisclaimerModal({ id, title, iconClass, contentHtml, primaryBtnText, secondaryBtnText, onPrimary, onSecondary }) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'mv-disclaimer-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: mvDisclaimerFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    const card = document.createElement('div');
    card.className = 'mv-disclaimer-card';
    card.style.cssText = `
      width: 100%;
      max-width: 530px;
      background: #000000;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.95);
      display: flex;
      flex-direction: column;
      gap: 20px;
      position: relative;
      overflow: hidden;
      color: #ffffff;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    `;

    // Header with Icon & Title
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 16px;
    `;

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-size: 18px;
      flex-shrink: 0;
    `;
    iconWrap.innerHTML = `<i class="${iconClass || 'fas fa-shield-alt'}"></i>`;

    const titleEl = document.createElement('h3');
    titleEl.style.cssText = `
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #ffffff;
      line-height: 1.3;
    `;
    titleEl.textContent = title;

    header.appendChild(iconWrap);
    header.appendChild(titleEl);
    card.appendChild(header);

    // Content Body
    const body = document.createElement('div');
    body.className = 'mv-disclaimer-body';
    body.style.cssText = `
      font-size: 0.88rem;
      line-height: 1.65;
      color: rgba(255, 255, 255, 0.78);
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 58vh;
      overflow-y: auto;
      padding-right: 4px;
    `;
    body.innerHTML = contentHtml;
    card.appendChild(body);

    // Actions Row
    const actions = document.createElement('div');
    actions.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 6px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    `;

    if (secondaryBtnText) {
      const secBtn = document.createElement('button');
      secBtn.type = 'button';
      secBtn.className = 'mv-disclaimer-btn-sec';
      secBtn.style.cssText = `
        padding: 10px 20px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.85);
        font-weight: 600;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      secBtn.textContent = secondaryBtnText;
      secBtn.onmouseover = () => { secBtn.style.background = 'rgba(255, 255, 255, 0.12)'; };
      secBtn.onmouseout = () => { secBtn.style.background = 'rgba(255, 255, 255, 0.06)'; };
      secBtn.onclick = () => {
        overlay.remove();
        if (typeof onSecondary === 'function') onSecondary();
      };
      actions.appendChild(secBtn);
    }

    const priBtn = document.createElement('button');
    priBtn.type = 'button';
    priBtn.className = 'mv-disclaimer-btn-pri';
    priBtn.style.cssText = `
      padding: 11px 24px;
      border-radius: 12px;
      background: #ffffff;
      border: none;
      color: #000000;
      font-weight: 700;
      font-size: 0.88rem;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(255, 255, 255, 0.15);
      transition: all 0.25s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    `;
    priBtn.innerHTML = `${primaryBtnText || 'I Agree'} <i class="fas fa-arrow-right" style="font-size: 11px; color: #000000;"></i>`;
    priBtn.onmouseover = () => { priBtn.style.background = '#e5e5e5'; priBtn.style.transform = 'translateY(-1px)'; };
    priBtn.onmouseout = () => { priBtn.style.background = '#ffffff'; priBtn.style.transform = 'none'; };
    priBtn.onclick = () => {
      overlay.remove();
      if (typeof onPrimary === 'function') onPrimary();
    };
    actions.appendChild(priBtn);

    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return overlay;
  }

  // Inject keyframe animation for overlay fade in
  if (!document.getElementById('mv-disclaimer-styles')) {
    const style = document.createElement('style');
    style.id = 'mv-disclaimer-styles';
    style.textContent = `
      @keyframes mvDisclaimerFadeIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  // 1. App First-Launch Disclaimer (General legal + Moral/Religious responsibility)
  function showAppFirstLaunchDisclaimer() {
    try {
      const seen = localStorage.getItem('mv_disclaimer_app_seen') === 'true' || window.appData?.disclaimerAppSeen === true;
      if (seen) return;
    } catch (e) {}

    const contentHtml = `
      <p style="margin-top:0; color: rgba(255,255,255,0.7); font-size: 0.88rem;">
        Welcome to <strong>MediaVault</strong> — your personal, high-performance media organizer and player interface.
      </p>
      
      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin-bottom: 8px;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-hand-holding-heart"></i> Moral & Religious Responsibility
        </strong>
        <p style="margin: 0; font-size: 0.84rem; color: rgba(255,255,255,0.75); line-height: 1.6;">
          MediaVault is a general playback tool. You bear sole moral, ethical, and religious responsibility before God (Allah) for whatever content you choose to view, download, or stream using this application. Entertainment should enrich your life, not burden your conscience. Please ensure your usage aligns with righteous values and avoids harmful or forbidden content.
        </p>
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin: 4px 0;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-gavel"></i> Terms of Use & Legal Disclaimer
        </strong>
        <ul style="margin: 0; padding-left: 18px; color: rgba(255,255,255,0.75); font-size: 0.84rem; line-height: 1.6;">
          <li style="margin-bottom: 6px;">MediaVault does <strong>not host, stream, index, or store</strong> any digital media files on its servers.</li>
          <li style="margin-bottom: 6px;">All external streams, metadata, and add-ons are provided by independent third parties.</li>
          <li>You are solely responsible for ensuring your media usage complies with applicable copyright laws in your jurisdiction.</li>
        </ul>
      </div>
      <p style="margin-bottom:0; font-size: 0.82rem; color: rgba(255,255,255,0.5);">By clicking "I Agree & Continue", you accept these general terms of service.</p>
    `;

    createDisclaimerModal({
      id: 'mv-disclaimer-app-modal',
      title: 'Terms of Service & Disclaimer',
      iconClass: 'fas fa-shield-alt',
      contentHtml: contentHtml,
      primaryBtnText: 'I Agree & Continue',
      onPrimary: () => {
        try {
          localStorage.setItem('mv_disclaimer_app_seen', 'true');
          if (window.appData) window.appData.disclaimerAppSeen = true;
          if (typeof window.persist === 'function') window.persist(true);
        } catch (e) {}
      }
    });
  }

  // 2. First Stream Playback Disclaimer (Stream & External server notice + Religious responsibility)
  function showStreamDisclaimer(onProceed) {
    try {
      const seen = localStorage.getItem('mv_disclaimer_stream_seen') === 'true' || window.appData?.disclaimerStreamSeen === true;
      if (seen) {
        if (typeof onProceed === 'function') onProceed();
        return;
      }
    } catch (e) {}

    const contentHtml = `
      <p style="margin-top:0; color: rgba(255,255,255,0.7); font-size: 0.88rem;">
        You are about to access an external stream provided by a third-party server.
      </p>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin-bottom: 8px;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-hand-holding-heart"></i> Moral & Religious Responsibility
        </strong>
        <p style="margin: 0; font-size: 0.84rem; color: rgba(255,255,255,0.75); line-height: 1.6;">
          You are solely accountable before God for what you watch, listen to, or stream. Be mindful of your time, eyes, and heart while using this media player.
        </p>
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin: 4px 0;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-exclamation-triangle"></i> External Stream Notice
        </strong>
        <ul style="margin: 0; padding-left: 18px; color: rgba(255,255,255,0.75); font-size: 0.84rem; line-height: 1.6;">
          <li style="margin-bottom: 6px;">MediaVault is not affiliated with external media providers or streaming servers.</li>
          <li style="margin-bottom: 6px;">Playback speed, stream quality, and subtitle availability are controlled by external hosts.</li>
          <li>MediaVault does not guarantee availability, stability, or accuracy of third-party streams.</li>
        </ul>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; font-size: 0.84rem; color: rgba(255,255,255,0.7); cursor: pointer; margin-top: 6px;">
        <input type="checkbox" id="mv-stream-disclaimer-dontshow" checked style="accent-color: #ffffff; width: 16px; height: 16px; cursor: pointer;">
        Do not show this streaming warning again
      </label>
    `;

    createDisclaimerModal({
      id: 'mv-disclaimer-stream-modal',
      title: 'Third-Party Content Disclaimer',
      iconClass: 'fas fa-play-circle',
      contentHtml: contentHtml,
      primaryBtnText: 'Understand & Proceed',
      secondaryBtnText: 'Cancel',
      onPrimary: () => {
        const checkbox = document.getElementById('mv-stream-disclaimer-dontshow');
        if (checkbox && checkbox.checked) {
          try {
            localStorage.setItem('mv_disclaimer_stream_seen', 'true');
            if (window.appData) window.appData.disclaimerStreamSeen = true;
            if (typeof window.persist === 'function') window.persist(true);
          } catch (e) {}
        }
        if (typeof onProceed === 'function') onProceed();
      }
    });
  }

  // 3. Mod & Addon Installation Warning (Triggers EVERY time a mod/addon is installed + Religious responsibility)
  function showModInstallDisclaimer(addonOrName, onConfirm, onCancel) {
    const name = (typeof addonOrName === 'string') ? addonOrName : (addonOrName?.name || 'Add-on');
    const version = (typeof addonOrName === 'object' && addonOrName?.version) ? ` (v${addonOrName.version})` : '';

    const contentHtml = `
      <p style="margin-top:0; color: rgba(255,255,255,0.7); font-size: 0.88rem;">
        You are about to install an external addon: <strong style="color: #ffffff;">${window.escapeHTML ? window.escapeHTML(name) : name}</strong>${version}.
      </p>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin-bottom: 8px;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-hand-holding-heart"></i> Moral & Religious Responsibility
        </strong>
        <p style="margin: 0; font-size: 0.84rem; color: rgba(255,255,255,0.75); line-height: 1.6;">
          Addons allow access to additional external content. You remain accountable before God for how you use these tools and what content you access through them.
        </p>
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 16px; border-radius: 14px; margin: 4px 0;">
        <strong style="color: #ffffff; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.9rem;">
          <i class="fas fa-puzzle-piece"></i> Security & Third-Party Code Notice
        </strong>
        <ul style="margin: 0; padding-left: 18px; color: rgba(255,255,255,0.75); font-size: 0.84rem; line-height: 1.6;">
          <li style="margin-bottom: 6px;">Addons run third-party code and communicate directly with external web servers.</li>
          <li style="margin-bottom: 6px;">Ensure you trust the developer or source before enabling this extension.</li>
          <li>MediaVault does not review, control, or guarantee third-party add-on code.</li>
        </ul>
      </div>
      <p style="margin-bottom:0; font-size: 0.84rem; color: rgba(255,255,255,0.5);">Do you want to proceed with installing this addon?</p>
    `;

    createDisclaimerModal({
      id: 'mv-disclaimer-mod-modal',
      title: 'Addon Installation Warning',
      iconClass: 'fas fa-puzzle-piece',
      contentHtml: contentHtml,
      primaryBtnText: 'Install & Enable',
      secondaryBtnText: 'Cancel',
      onPrimary: () => {
        if (typeof onConfirm === 'function') onConfirm();
      },
      onSecondary: () => {
        if (typeof onCancel === 'function') onCancel();
      }
    });
  }

  // 4. Streams About / Guide Modal (Explains Streams page, missing streams, steps & examples)
  function showStreamsAboutModal() {
    const existing = document.getElementById('mv-streams-about-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mv-streams-about-modal';
    overlay.className = 'mv-disclaimer-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: mvDisclaimerFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: 100%;
      max-width: 580px;
      background: #000000;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.95);
      display: flex;
      flex-direction: column;
      gap: 20px;
      position: relative;
      color: #ffffff;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    `;

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); display: flex; align-items: center; justify-content: center; color: #ffffff; font-size: 18px;">
            <i class="fas fa-info-circle"></i>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; color: #ffffff;">About Streaming Links</h3>
            <span style="font-size: 0.78rem; color: rgba(255,255,255,0.5);">How sources are resolved & how to add more</span>
          </div>
        </div>
        <button onclick="document.getElementById('mv-streams-about-modal').remove()" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #ffffff; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div style="font-size: 0.88rem; line-height: 1.65; color: rgba(255,255,255,0.8); display: flex; flex-direction: column; gap: 14px; max-height: 60vh; overflow-y: auto; padding-right: 4px;">
        
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px;">
          <strong style="color: #ffffff; font-size: 0.9rem; display: block; margin-bottom: 6px;">💡 How this page works:</strong>
          This panel searches and aggregates active online viewing sources (servers, torrent scrapers, and media resolvers) for the selected movie or TV episode.
        </div>

        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px;">
          <strong style="color: #ffffff; font-size: 0.9rem; display: block; margin-bottom: 6px;">❓ No streams showing up?</strong>
          If no streaming options appear or if links fail to load, your installed Add-ons currently do not provide a stream for this specific title. You can easily add more streaming providers!
        </div>

        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px;">
          <strong style="color: #ffffff; font-size: 0.9rem; display: block; margin-bottom: 10px;">📋 How to add stream sources (Step-by-Step):</strong>
          <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px;">
            <li>Go to the <strong>Addons Store</strong> tab in the main sidebar.</li>
            <li>Browse the <strong>Available Addons</strong> catalog or paste a custom Addon manifest URL.</li>
            <li>Click <strong>Install</strong> on stream providers (such as community torrent scrapers or media resolvers).</li>
            <li>Return to this media page — new 1080p / 4K stream links will appear instantly!</li>
          </ol>
        </div>

      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
        <button onclick="if(typeof window.switchView==='function'){window.switchView('addons');} document.getElementById('mv-streams-about-modal').remove();" style="padding: 10px 20px; border-radius: 12px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); color: #ffffff; font-weight: 600; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;">
          <i class="fas fa-puzzle-piece"></i> Open Addons Store
        </button>
        <button onclick="document.getElementById('mv-streams-about-modal').remove()" style="padding: 10px 24px; border-radius: 12px; background: #ffffff; border: none; color: #000000; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
          Got It!
        </button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // Export to global scope
  window.showAppFirstLaunchDisclaimer = showAppFirstLaunchDisclaimer;
  window.showStreamDisclaimer = showStreamDisclaimer;
  window.showDisclaimerAndProceed = showStreamDisclaimer; // Map existing call
  window.showModInstallDisclaimer = showModInstallDisclaimer;
  window.showStreamsAboutModal = showStreamsAboutModal;

  // Auto-trigger App First-Launch Disclaimer on initialization
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      showAppFirstLaunchDisclaimer();
    }, 1200);
  });
})();

