(() => {
  if (window.__alistShareSidecarLoaded) return;
  window.__alistShareSidecarLoaded = true;

  const API_BASE = '/share-app/api.php';
  const SHARE_BASE = '/s';
  const MODAL_ID = 'alist-share-modal';
  const ROW_BUTTON_CLASS = 'alist-share-row-button';
  const ROW_MARKER_ATTR = 'data-alist-share-bound';
  const ROW_PROFILES = [
    {
      name: 'table-links',
      rowSelectors: ['a[href]:has(img)', 'a[href]'],
      ignoreHrefPrefixes: ['/@', 'http://', 'https://', 'javascript:'],
      ignoreText: /^(home|manage|powered by alist|name|size|modified|per page)$/i,
      buttonOffsetLeft: 16,
      buttonOffsetTop: 6,
    },
  ];

  let currentTarget = null;
  let currentDays = 7;
  let modal = null;
  let observer = null;
  let rafId = 0;

  if (!shouldBootOnCurrentPage()) return;

  injectStyles();
  buildModal();
  scheduleRefresh();
  bindGlobalListeners();

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${ROW_BUTTON_CLASS}{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:4px 10px;
        border:0;
        border-radius:999px;
        background:#12a56d;
        color:#fff;
        font-weight:700;
        font-size:12px;
        line-height:1;
        cursor:pointer;
        box-shadow:0 10px 24px rgba(18,165,109,.18);
        margin-left:16px;
        vertical-align:middle;
      }
      .${ROW_BUTTON_CLASS}[hidden]{display:none!important}
      #${MODAL_ID}{
        position:fixed;
        inset:0;
        background:rgba(8,8,17,.62);
        display:none;
        align-items:center;
        justify-content:center;
        z-index:9999;
      }
      #${MODAL_ID}.open{display:flex}
      #${MODAL_ID} .panel{
        width:min(92vw,560px);
        background:#1f1d3f;
        color:#fff;
        border-radius:20px;
        padding:24px;
        box-shadow:0 30px 60px rgba(0,0,0,.35);
      }
      #${MODAL_ID} h3{margin:0 0 18px;font-size:28px}
      #${MODAL_ID} label{display:block;margin:12px 0 6px;color:#d4d7ff;font-size:14px}
      #${MODAL_ID} input{
        width:100%;
        box-sizing:border-box;
        padding:12px 14px;
        border-radius:12px;
        border:1px solid #4e5ed0;
        background:#2d2b58;
        color:#fff;
      }
      #${MODAL_ID} .row{display:flex;gap:10px;margin:12px 0;flex-wrap:wrap}
      #${MODAL_ID} .day-btn{
        padding:10px 14px;
        border-radius:12px;
        border:1px solid #45466a;
        background:#2a2947;
        color:#d7dafd;
        cursor:pointer;
      }
      #${MODAL_ID} .day-btn.active{background:#4f65ff;border-color:#6f80ff;color:#fff}
      #${MODAL_ID} .actions{display:flex;gap:10px;margin-top:18px}
      #${MODAL_ID} .primary,#${MODAL_ID} .secondary{
        border:0;
        border-radius:14px;
        padding:12px 18px;
        cursor:pointer;
        font-weight:700;
      }
      #${MODAL_ID} .primary{background:linear-gradient(90deg,#6b7bf7,#9159d7);color:#fff;flex:1}
      #${MODAL_ID} .secondary{background:#302f54;color:#dfe2ff}
      #${MODAL_ID} .result{margin-top:16px;padding:14px;border-radius:14px;background:#152a31;display:none;word-break:break-all}
      #${MODAL_ID} .error{margin-top:16px;padding:14px;border-radius:14px;background:#42252c;color:#ffb7b7;display:none}
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="panel">
        <h3>Share Link</h3>
        <label>File</label>
        <input id="alist-share-file" type="text" readonly>
        <label>Expires after</label>
        <div class="row">
          <button class="day-btn active" data-days="7" type="button">7 days</button>
          <button class="day-btn" data-days="14" type="button">14 days</button>
          <button class="day-btn" data-days="30" type="button">30 days</button>
          <button class="day-btn" data-days="custom" type="button">Custom</button>
        </div>
        <input id="alist-share-custom-days" type="number" min="1" max="365" placeholder="Custom days" style="display:none">
        <label>Password (optional)</label>
        <input id="alist-share-password" type="text" placeholder="Leave blank if not needed">
        <label>Max downloads (0 = unlimited)</label>
        <input id="alist-share-max-downloads" type="number" min="0" value="0">
        <div class="actions">
          <button class="secondary" id="alist-share-cancel" type="button">Close</button>
          <button class="primary" id="alist-share-submit" type="button">Create Share Link</button>
        </div>
        <div class="result" id="alist-share-result"></div>
        <div class="error" id="alist-share-error"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    document.getElementById('alist-share-cancel').onclick = closeModal;
    document.getElementById('alist-share-submit').onclick = () => {
      createShare().catch((error) => showError(error?.message || 'Unexpected error'));
    };

    modal.querySelectorAll('.day-btn').forEach((item) => {
      item.addEventListener('click', () => {
        currentDays = item.dataset.days;
        modal.querySelectorAll('.day-btn').forEach((buttonItem) => buttonItem.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('alist-share-custom-days').style.display = currentDays === 'custom' ? 'block' : 'none';
      });
    });
  }

  function bindGlobalListeners() {
    window.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    window.addEventListener('popstate', scheduleRefresh);
    document.addEventListener('click', () => setTimeout(scheduleRefresh, 30), true);
    document.addEventListener('contextmenu', () => setTimeout(scheduleRefresh, 30), true);

    observer = new MutationObserver(() => scheduleRefresh());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'href'],
    });
  }

  function shouldBootOnCurrentPage() {
    const path = window.location.pathname || '/';
    const title = (document.title || '').toLowerCase();

    if (/^\/@/.test(path)) return false;
    if (path.includes('/@manage')) return false;
    if (path.includes('/@login')) return false;
    if (title.includes('alist manage')) return false;
    if (title.includes('manage')) return false;

    return true;
  }

  function getToken() {
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        const value = store.getItem(key);
        if (!value) continue;

        if (key && /token/i.test(key) && value.length > 20) {
          return normalizeToken(value);
        }

        try {
          const parsed = JSON.parse(value);
          const candidates = [parsed?.token, parsed?.Authorization, parsed?.data?.token, parsed?.auth?.token];
          const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 20);
          if (match) return normalizeToken(match);
        } catch (_) {}
      }
    }

    return null;
  }

  function normalizeToken(value) {
    return String(value).replace(/^Bearer\s+/i, '').trim();
  }

  function currentPathPrefix() {
    return decodeURIComponent(window.location.pathname || '/').replace(/\/+$/, '') || '/';
  }

  function visibleElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
  }

  function resolveRows(profile) {
    const rows = [];
    for (const selector of profile.rowSelectors) {
      for (const link of visibleElements(selector)) {
        if (!isShareableLink(link, profile)) continue;
        const row = resolveRowContainer(link);
        if (!(row instanceof HTMLElement)) continue;
        if (rows.includes(row)) continue;
        rows.push(row);
      }
    }
    return rows;
  }

  function resolveRowContainer(link) {
    let node = link.parentElement;
    while (node && node !== document.body) {
      const text = (node.textContent || '').trim();
      const childLinks = node.querySelectorAll('a[href]').length;
      const childParagraphs = node.querySelectorAll('p, div, span').length;
      if (text && childLinks >= 1 && childParagraphs >= 2) {
        return node;
      }
      node = node.parentElement;
    }
    return link.parentElement;
  }

  function isShareableLink(link, profile) {
    const href = link.getAttribute('href') || '';
    const text = (link.textContent || link.getAttribute('title') || '').trim();

    if (!href || href === '/' || href === '#') return false;
    if (profile.ignoreHrefPrefixes.some((prefix) => href.startsWith(prefix))) return false;
    if (!text || profile.ignoreText.test(text)) return false;
    if (text.length < 2) return false;
    if (link.closest('nav, [role="navigation"], [aria-label="breadcrumb"], footer')) return false;

    return true;
  }

  function resolvePrimaryLink(row, profile) {
    const links = Array.from(row.querySelectorAll('a[href]'))
      .filter((link) => link instanceof HTMLElement && link.offsetParent !== null);

    return links.find((link) => isShareableLink(link, profile)) || null;
  }

  function resolveRowPath(row, profile) {
    const link = resolvePrimaryLink(row, profile);
    if (!link) return null;

    const title = link.getAttribute('title');
    const text = (title || link.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text || profile.ignoreText.test(text)) return null;

    return `${currentPathPrefix()}/${text}`.replace(/\/{2,}/g, '/');
  }

  function attachButton(row, profile) {
    if (!(row instanceof HTMLElement)) return;

    const link = resolvePrimaryLink(row, profile);
    const filePath = resolveRowPath(row, profile);
    if (!link || !filePath) return;

    let button = row.querySelector(`.${ROW_BUTTON_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = ROW_BUTTON_CLASS;
      button.textContent = 'Share';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openModal(filePath);
      });
      link.insertAdjacentElement('afterend', button);
    }

    button.dataset.filePath = filePath;
    button.hidden = modal.classList.contains('open');
    row.setAttribute(ROW_MARKER_ATTR, '1');
  }

  function cleanupStaleButtons() {
    document.querySelectorAll(`.${ROW_BUTTON_CLASS}`).forEach((button) => {
      if (!document.body.contains(button)) {
        button.remove();
      }
    });
  }

  function refreshButtons() {
    cleanupStaleButtons();
    if (modal.classList.contains('open')) return;

    for (const profile of ROW_PROFILES) {
      for (const row of resolveRows(profile)) {
        attachButton(row, profile);
      }
    }
  }

  function scheduleRefresh() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(refreshButtons);
  }

  function openModal(filePath) {
    currentTarget = filePath;
    document.getElementById('alist-share-file').value = filePath;
    document.getElementById('alist-share-result').style.display = 'none';
    document.getElementById('alist-share-error').style.display = 'none';
    modal.classList.add('open');
    document.querySelectorAll(`.${ROW_BUTTON_CLASS}`).forEach((button) => {
      button.hidden = true;
    });
  }

  function closeModal() {
    modal.classList.remove('open');
    scheduleRefresh();
  }

  async function createShare() {
    const token = getToken();
    if (!token) {
      showError('Could not find an AList viewer token in browser storage.');
      return;
    }

    const customInput = document.getElementById('alist-share-custom-days');
    const expiresDays = currentDays === 'custom' ? Number(customInput.value || 0) : Number(currentDays);
    const payload = {
      file_path: currentTarget,
      expires_days: expiresDays,
      password: document.getElementById('alist-share-password').value.trim(),
      max_downloads: Number(document.getElementById('alist-share-max-downloads').value || 0),
    };

    const response = await fetch(`${API_BASE}?action=create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      showError(result.message || 'Failed to create share link.');
      return;
    }

    const shareUrl = result.share_url || `${SHARE_BASE}/${result.share_id}`;
    const box = document.getElementById('alist-share-result');
    box.innerHTML = `
      <strong>Share created</strong>
      <div style="margin-top:8px">${shareUrl}</div>
      <div style="margin-top:12px">
        <button type="button" class="secondary" id="alist-share-copy-button">Copy URL</button>
      </div>
    `;
    box.style.display = 'block';
    document.getElementById('alist-share-error').style.display = 'none';

    const copyButton = document.getElementById('alist-share-copy-button');
    copyButton?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyButton.textContent = 'Copied';
      } catch (_) {
        copyButton.textContent = 'Copy failed';
      }
    });
  }

  function showError(message) {
    const box = document.getElementById('alist-share-error');
    box.textContent = message;
    box.style.display = 'block';
    document.getElementById('alist-share-result').style.display = 'none';
  }
})();
