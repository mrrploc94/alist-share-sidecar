(() => {
  const API_BASE = '/share-app/api.php';
  const SHARE_BASE = '/s';
  const BUTTON_ID = 'alist-share-inline-button';
  const MODAL_ID = 'alist-share-modal';

  const style = document.createElement('style');
  style.textContent = `
    #${BUTTON_ID}{position:absolute;z-index:50;padding:6px 12px;border:0;border-radius:999px;background:#12a56d;color:#fff;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 10px 24px rgba(18,165,109,.25)}
    #${MODAL_ID}{position:fixed;inset:0;background:rgba(8,8,17,.62);display:none;align-items:center;justify-content:center;z-index:9999}
    #${MODAL_ID}.open{display:flex}
    #${MODAL_ID} .panel{width:min(92vw,560px);background:#1f1d3f;color:#fff;border-radius:20px;padding:24px;box-shadow:0 30px 60px rgba(0,0,0,.35)}
    #${MODAL_ID} h3{margin:0 0 18px;font-size:28px}
    #${MODAL_ID} label{display:block;margin:12px 0 6px;color:#d4d7ff;font-size:14px}
    #${MODAL_ID} input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #4e5ed0;background:#2d2b58;color:#fff}
    #${MODAL_ID} .row{display:flex;gap:10px;margin:12px 0}
    #${MODAL_ID} .day-btn{padding:10px 14px;border-radius:12px;border:1px solid #45466a;background:#2a2947;color:#d7dafd;cursor:pointer}
    #${MODAL_ID} .day-btn.active{background:#4f65ff;border-color:#6f80ff;color:#fff}
    #${MODAL_ID} .actions{display:flex;gap:10px;margin-top:18px}
    #${MODAL_ID} .primary,#${MODAL_ID} .secondary{border:0;border-radius:14px;padding:12px 18px;cursor:pointer;font-weight:700}
    #${MODAL_ID} .primary{background:linear-gradient(90deg,#6b7bf7,#9159d7);color:#fff;flex:1}
    #${MODAL_ID} .secondary{background:#302f54;color:#dfe2ff}
    #${MODAL_ID} .result{margin-top:16px;padding:14px;border-radius:14px;background:#152a31;display:none}
    #${MODAL_ID} .error{margin-top:16px;padding:14px;border-radius:14px;background:#42252c;color:#ffb7b7;display:none}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
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

  let currentTarget = null;
  let currentDays = 7;

  function getToken() {
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        const value = store.getItem(key);
        if (!value) continue;
        if (key && /token/i.test(key) && value.length > 20) return value;
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.token === 'string' && parsed.token.length > 20) return parsed.token;
            if (typeof parsed.Authorization === 'string' && parsed.Authorization.length > 20) return parsed.Authorization;
          }
        } catch (_) {}
      }
    }
    return null;
  }

  function currentPathPrefix() {
    return decodeURIComponent(window.location.pathname || '/').replace(/\/+$/, '') || '/';
  }

  function selectedRow() {
    return document.querySelector('[aria-selected="true"], tr[class*="selected"], .is-selected, .selected');
  }

  function nameCellFromRow(row) {
    return row?.querySelector('a, [title], td, .name, .hope-text');
  }

  function extractFileName(row) {
    const node = nameCellFromRow(row);
    if (!node) return '';
    const title = node.getAttribute?.('title');
    const text = title || node.textContent || '';
    return text.trim().replace(/\s+/g, ' ');
  }

  function selectedFilePath() {
    const row = selectedRow();
    const name = extractFileName(row);
    if (!name) return null;
    return `${currentPathPrefix()}/${name}`.replace(/\/{2,}/g, '/');
  }

  function ensureButton() {
    const row = selectedRow();
    const existing = document.getElementById(BUTTON_ID);
    if (!row) {
      existing?.remove();
      return;
    }

    const rowRect = row.getBoundingClientRect();
    const left = Math.max(window.scrollX + rowRect.left + rowRect.width * 0.54, window.scrollX + rowRect.left + 240);
    const top = window.scrollY + rowRect.top + 10;

    const button = existing || Object.assign(document.createElement('button'), { id: BUTTON_ID, textContent: 'Share' });
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.onclick = () => openModal();

    if (!existing) document.body.appendChild(button);
  }

  function openModal() {
    const filePath = selectedFilePath();
    if (!filePath) return;
    currentTarget = filePath;
    document.getElementById('alist-share-file').value = filePath;
    document.getElementById('alist-share-result').style.display = 'none';
    document.getElementById('alist-share-error').style.display = 'none';
    document.getElementById(BUTTON_ID)?.style.setProperty('display', 'none');
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
    document.getElementById(BUTTON_ID)?.style.removeProperty('display');
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

    const box = document.getElementById('alist-share-result');
    const shareUrl = result.share_url || `${SHARE_BASE}/${result.share_id}`;
    box.innerHTML = `<strong>Share created</strong><div style="margin-top:8px;word-break:break-all">${shareUrl}</div>`;
    box.style.display = 'block';
    document.getElementById('alist-share-error').style.display = 'none';
  }

  function showError(message) {
    const box = document.getElementById('alist-share-error');
    box.textContent = message;
    box.style.display = 'block';
    document.getElementById('alist-share-result').style.display = 'none';
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  document.getElementById('alist-share-cancel').onclick = closeModal;
  document.getElementById('alist-share-submit').onclick = () => {
    createShare().catch((error) => showError(error?.message || 'Unexpected error'));
  };

  document.querySelectorAll('.day-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentDays = button.dataset.days;
      document.querySelectorAll('.day-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById('alist-share-custom-days').style.display = currentDays === 'custom' ? 'block' : 'none';
    });
  });

  window.addEventListener('scroll', ensureButton, { passive: true });
  window.addEventListener('resize', ensureButton, { passive: true });

  setInterval(ensureButton, 1200);
})();
