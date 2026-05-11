// health-agent chat UI with cohort attribution panel + inline citations.
// Vanilla JS, no framework.

const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chatForm');
const inputEl = document.getElementById('chatInput');
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const uploadStatus = document.getElementById('uploadStatus');
const contribContent = document.getElementById('contribContent');
const demoBadge = document.getElementById('demoBadge');
const gatewayStatusEl = document.getElementById('gatewayStatus');
const receiptOverlay = document.getElementById('receiptOverlay');
const receiptJsonEl = document.getElementById('receiptJson');
const receiptCopyBtn = document.getElementById('receiptCopy');
const receiptCloseBtn = document.getElementById('receiptClose');

const IS_DEMO = new URLSearchParams(window.location.search).has('demo');
let cannedData = null;
let lastContributors = [];
let activeReceiptJson = null; // raw JSON string for clipboard copy

// --- Demo mode setup ---
if (IS_DEMO) {
  demoBadge.hidden = false;
  fetch('/demo-canned.json')
    .then((r) => r.json())
    .then((data) => {
      cannedData = data;
      setStatus('Demo data loaded (14 workouts, 30 days).', 'ok');
    })
    .catch(() => {
      setStatus('Demo mode: could not load canned data.', 'err');
    });
}

// --- File upload ---
dropzone.addEventListener('click', () => fileInput.click());
['dragover', 'dragenter'].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (ev) => {
  const file = ev.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (ev) => {
  const file = ev.target.files?.[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  setStatus('Reading ' + file.name + '...', '');
  let text;
  try {
    text = await file.text();
  } catch (err) {
    return setStatus('Could not read file: ' + err.message, 'err');
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    return setStatus('That file is not valid JSON.', 'err');
  }
  setStatus('Uploading & decrypting inside the TEE...', '');
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || 'HTTP ' + res.status);
    setStatus(
      'Imported ' + json.recordsImported + ' records (' +
        (json.windowFrom || '').slice(0, 10) + ' \u2192 ' +
        (json.windowTo || '').slice(0, 10) + ').',
      'ok',
    );
  } catch (err) {
    setStatus('Upload failed: ' + err.message, 'err');
  }
}

function setStatus(text, kind) {
  uploadStatus.textContent = text;
  uploadStatus.className = 'status ' + kind;
}

// --- Chat ---
formEl.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;
  inputEl.value = '';
  inputEl.disabled = true;
  formEl.querySelector('button').disabled = true;

  appendMsg('user', message);
  const placeholder = appendMsg('bot', '...');

  try {
    let data;
    if (IS_DEMO && cannedData) {
      await new Promise((r) => setTimeout(r, 1500));
      data = cannedData;
    } else {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    }

    lastContributors = data.contributors || [];
    renderContributors(data);
    renderBotMessage(placeholder, data.reply || '(no reply)', lastContributors, data.receipt || null);

    // Gateway status line
    if (typeof data.via_gateway === 'boolean') {
      gatewayStatusEl.hidden = data.via_gateway;
    }
  } catch (err) {
    placeholder.classList.remove('msg-bot');
    placeholder.classList.add('msg-err');
    placeholder.textContent = 'Error: ' + err.message;
  } finally {
    inputEl.disabled = false;
    formEl.querySelector('button').disabled = false;
    inputEl.focus();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
});

function appendMsg(who, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-' + who;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// --- Citation-aware bot message rendering ---
function renderBotMessage(el, text, contributors, receipt) {
  el.textContent = '';
  // Split on citation markers like [1], [2], etc.
  const parts = text.split(/(\[\d+\])/g);
  for (const part of parts) {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = parseInt(match[1], 10); // 1-based
      const idx = num - 1;
      if (idx >= 0 && idx < contributors.length) {
        const span = document.createElement('span');
        span.className = 'citation';
        span.setAttribute('data-cidx', String(idx));
        span.textContent = '[' + num + ']';
        span.title = 'Context contributor: ' + contributors[idx].label;
        el.appendChild(span);
      } else {
        // Unknown citation number — render as plain text
        el.appendChild(document.createTextNode(part));
      }
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }

  // Receipt button
  if (receipt) {
    const btn = document.createElement('button');
    btn.className = 'receipt-trigger';
    btn.textContent = 'Receipt';
    const jsonStr = JSON.stringify(receipt, null, 2);
    btn.addEventListener('click', () => openReceiptModal(jsonStr));
    el.appendChild(btn);
  }

  // Payout summary line
  if (contributors.length > 0) {
    const price = receipt && receipt.query_price_mock_usd ? receipt.query_price_mock_usd : 0.50;
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'payout-summary';
    const amountSpan = document.createElement('span');
    amountSpan.className = 'payout-summary-amount';
    amountSpan.textContent = '$' + price.toFixed(2) + ' USDC';
    summaryDiv.appendChild(document.createTextNode('Paid '));
    summaryDiv.appendChild(amountSpan);
    summaryDiv.appendChild(document.createTextNode(' across ' + contributors.length + ' contributors'));
    var sep = document.createTextNode(' \u00B7 ');
    summaryDiv.appendChild(sep);
    var link = document.createElement('a');
    link.href = '/payouts.html';
    link.textContent = 'View payouts \u2192';
    summaryDiv.appendChild(link);
    el.appendChild(summaryDiv);
  }
}

// --- Citation click handler (delegated) ---
messagesEl.addEventListener('click', (ev) => {
  const citation = ev.target.closest('.citation');
  if (!citation) return;
  const idx = citation.getAttribute('data-cidx');
  if (idx === null) return;
  const card = contribContent.querySelector('.contrib-card[data-cidx="' + idx + '"]');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.add('contrib-highlight');
  setTimeout(() => card.classList.remove('contrib-highlight'), 1700);
});

// --- Contributors panel ---
function renderContributors(data) {
  const contributors = data.contributors || [];
  const refs = data.references_used || {};
  const price = data.query_price_mock_usd || 0;

  if (!contributors.length) {
    contribContent.className = 'contrib-empty';
    contribContent.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Upload health data and ask a question to see cohort comparisons.';
    contribContent.appendChild(p);
    return;
  }

  contribContent.className = 'contrib-filled';
  contribContent.innerHTML = '';

  // Query price header
  const priceEl = document.createElement('div');
  priceEl.className = 'contrib-price';
  priceEl.textContent = 'Query price (mock): $' + price.toFixed(2);
  contribContent.appendChild(priceEl);

  // Payouts page link
  const payoutsLink = document.createElement('div');
  payoutsLink.className = 'contrib-payouts-link';
  var a = document.createElement('a');
  a.href = '/payouts.html';
  a.textContent = 'Full payout ledger \u2192';
  payoutsLink.appendChild(a);
  contribContent.appendChild(payoutsLink);

  // Contributor cards
  for (let i = 0; i < contributors.length; i++) {
    const c = contributors[i];
    const card = document.createElement('div');
    card.className = 'contrib-card';
    card.setAttribute('data-cidx', String(i));

    // Number + Label
    const label = document.createElement('div');
    label.className = 'contrib-label';
    const numBadge = document.createElement('span');
    numBadge.className = 'contrib-num';
    numBadge.textContent = '[' + (i + 1) + ']';
    label.appendChild(numBadge);
    label.appendChild(document.createTextNode(' ' + c.label));
    card.appendChild(label);

    // Narrative
    const narr = document.createElement('div');
    narr.className = 'contrib-narrative';
    narr.textContent = c.narrative_summary;
    card.appendChild(narr);

    // Weight bar
    const barWrap = document.createElement('div');
    barWrap.className = 'contrib-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'contrib-bar';
    bar.style.width = Math.round(c.context_weight * 100) + '%';
    barWrap.appendChild(bar);
    const barLabel = document.createElement('span');
    barLabel.className = 'contrib-bar-label';
    barLabel.textContent = Math.round(c.context_weight * 100) + '%';
    barWrap.appendChild(barLabel);
    card.appendChild(barWrap);

    // Payout
    const payout = document.createElement('div');
    payout.className = 'contrib-payout';
    payout.textContent = '$' + c.mock_payout_usd.toFixed(3) + ' USDC';
    card.appendChild(payout);

    // Address (on its own line below payout)
    if (c.address) {
      const addrEl = document.createElement('div');
      addrEl.className = 'contrib-address';
      var short = c.address.length > 14
        ? c.address.slice(0, 6) + '...' + c.address.slice(-4)
        : c.address;
      addrEl.textContent = '\u2192 ' + short;
      addrEl.title = c.address;
      card.appendChild(addrEl);
    }

    // Sources toggle
    if (c.source_notes && Object.keys(c.source_notes).length) {
      const toggle = document.createElement('button');
      toggle.className = 'contrib-sources-toggle';
      toggle.textContent = 'Sources \u25B8';
      const sourcesDiv = document.createElement('div');
      sourcesDiv.className = 'contrib-sources';
      sourcesDiv.hidden = true;

      for (const [feat, note] of Object.entries(c.source_notes)) {
        const row = document.createElement('div');
        row.className = 'contrib-source-row';
        const featLabel = document.createElement('span');
        featLabel.className = 'contrib-source-feat';
        featLabel.textContent = feat.replace(/_/g, ' ');
        row.appendChild(featLabel);
        const noteEl = document.createElement('span');
        noteEl.className = 'contrib-source-note';
        noteEl.textContent = note;
        row.appendChild(noteEl);
        sourcesDiv.appendChild(row);
      }

      toggle.addEventListener('click', () => {
        const open = sourcesDiv.hidden;
        sourcesDiv.hidden = !open;
        toggle.textContent = open ? 'Sources \u25BE' : 'Sources \u25B8';
      });

      card.appendChild(toggle);
      card.appendChild(sourcesDiv);
    }

    contribContent.appendChild(card);
  }

  // Bottom badge
  const badge = document.createElement('div');
  badge.className = 'contrib-badge';
  badge.textContent =
    'Personas constructed from US population distributions in NHANES, NHIS, BRFSS, ' +
    'and peer-reviewed reference data (see Sources per contributor). Context weight = ' +
    'similarity-based selection share, NOT causal attribution of output tokens. ' +
    'Mock settlement, not on-chain.';
  contribContent.appendChild(badge);
}

// --- Receipt modal ---
function openReceiptModal(jsonStr) {
  console.log('[receipt] jsonStr type:', typeof jsonStr, 'length:', jsonStr?.length);
  console.log('[receipt] jsonStr preview:', String(jsonStr).slice(0, 200));
  activeReceiptJson = jsonStr;
  try {
    var html = highlightJson(jsonStr);
    console.log('[receipt] highlightJson output length:', html.length);
    receiptJsonEl.innerHTML = html;
  } catch (e) {
    console.error('[receipt] highlightJson threw:', e);
    receiptJsonEl.textContent = jsonStr;
  }
  receiptOverlay.hidden = false;
  receiptCopyBtn.textContent = 'Copy JSON';
  requestAnimationFrame(function () {
    var r = receiptJsonEl.getBoundingClientRect();
    console.log('[receipt] pre rect:', r.width, 'x', r.height,
      '| innerHTML.length:', receiptJsonEl.innerHTML.length,
      '| computed color:', getComputedStyle(receiptJsonEl).color,
      '| computed background:', getComputedStyle(receiptJsonEl).background);
  });
}

function closeReceiptModal() {
  receiptOverlay.hidden = true;
  activeReceiptJson = null;
}

receiptCloseBtn.addEventListener('click', closeReceiptModal);
receiptOverlay.addEventListener('click', (ev) => {
  if (ev.target === receiptOverlay) closeReceiptModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !receiptOverlay.hidden) closeReceiptModal();
});
receiptCopyBtn.addEventListener('click', () => {
  if (!activeReceiptJson) return;
  // clipboard API requires secure context (HTTPS); fall back to execCommand on plain HTTP
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(activeReceiptJson).then(
      () => showCopied(),
      () => fallbackCopy(activeReceiptJson)
    );
  } else {
    fallbackCopy(activeReceiptJson);
  }
});

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (document.execCommand('copy')) {
      showCopied();
    } else {
      showCopyFailed();
    }
  } catch (_) {
    showCopyFailed();
  }
  document.body.removeChild(ta);
}

function showCopied() {
  receiptCopyBtn.textContent = 'Copied';
  setTimeout(() => { receiptCopyBtn.textContent = 'Copy JSON'; }, 1500);
}

function showCopyFailed() {
  receiptCopyBtn.textContent = 'Copy failed — select and copy manually';
  // Select the JSON text so the user can Ctrl+C / Cmd+C
  const range = document.createRange();
  range.selectNodeContents(receiptJsonEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  setTimeout(() => { receiptCopyBtn.textContent = 'Copy JSON'; }, 3000);
}

// Minimal JSON syntax highlighting — no library, ~20 lines.
function highlightJson(json) {
  return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(?:\\.|[^"\\])*")\s*:/g,
      '<span class="rj-key">$1</span>:'
    )
    .replace(
      /:\s*("(?:\\.|[^"\\])*")/g,
      function (m, val) { return ': <span class="rj-str">' + val + '</span>'; }
    )
    .replace(
      /:\s*(-?\d+(?:\.\d+)?)/g,
      ': <span class="rj-num">$1</span>'
    )
    .replace(
      /:\s*(true|false)/g,
      ': <span class="rj-bool">$1</span>'
    )
    .replace(
      /:\s*(null)/g,
      ': <span class="rj-null">$1</span>'
    );
}

// --- TEE status pill ---
(async () => {
  try {
    const res = await fetch('/api/attestation');
    const info = await res.json();
    const pill = document.getElementById('teePill');
    if (!pill) return;
    if (info.insideTEE) {
      const appId = info.appId || '';
      const short = appId.length > 10
        ? appId.slice(0, 8) + '\u2026' + appId.slice(-4)
        : appId || 'unknown';
      pill.textContent = '\uD83D\uDD12 Inside TDX \u00B7 ' + short;
      pill.title = appId;
      pill.classList.add('tee-pill-active');
    } else {
      pill.textContent = 'Dev preview \u00B7 no TEE';
      pill.classList.add('tee-pill-dev');
    }
    pill.hidden = false;
  } catch (_) {}
})();
