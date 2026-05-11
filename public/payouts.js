// Payouts ledger page — fetches /api/payouts/recent and renders table.
// Vanilla JS, no framework.

const payoutsBody = document.getElementById('payoutsBody');
const statTotalUsdc = document.getElementById('statTotalUsdc');
const statTotalQueries = document.getElementById('statTotalQueries');
const statUniqueContribs = document.getElementById('statUniqueContribs');
const filterBar = document.getElementById('filterBar');
const filterAddress = document.getElementById('filterAddress');
const filterClear = document.getElementById('filterClear');

let allPayouts = [];
let activeFilter = null;

// Check URL for address filter
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('address')) {
  activeFilter = urlParams.get('address');
}

// --- Fetch and render ---
(async () => {
  try {
    const res = await fetch('/api/payouts/recent?limit=200');
    const data = await res.json();
    allPayouts = data.payouts || [];

    // Stats
    const stats = data.stats || {};
    statTotalUsdc.textContent = '$' + (stats.total_usdc || 0).toFixed(2);
    statTotalQueries.textContent = String(stats.total_queries || 0);
    statUniqueContribs.textContent = String(stats.unique_contributors || 0);

    renderTable();
  } catch (err) {
    payoutsBody.innerHTML =
      '<tr><td colspan="5" class="payouts-loading" style="color:var(--danger)">Failed to load payouts: ' +
      err.message + '</td></tr>';
  }
})();

function renderTable() {
  const filtered = activeFilter
    ? allPayouts.filter(function (p) { return p.address === activeFilter; })
    : allPayouts;

  if (activeFilter) {
    filterBar.hidden = false;
    filterAddress.textContent = truncAddr(activeFilter);
  } else {
    filterBar.hidden = true;
  }

  if (!filtered.length) {
    payoutsBody.innerHTML =
      '<tr><td colspan="5" class="payouts-loading">No payouts found.</td></tr>';
    return;
  }

  payoutsBody.innerHTML = '';
  for (var i = 0; i < filtered.length; i++) {
    var p = filtered[i];
    var tr = document.createElement('tr');

    // Time
    var tdTime = document.createElement('td');
    tdTime.className = 'col-time';
    tdTime.textContent = relativeTime(p.ts);
    tdTime.title = p.ts;
    tr.appendChild(tdTime);

    // Query (truncated from query_id — we don't store full query text in ledger)
    var tdQuery = document.createElement('td');
    tdQuery.className = 'col-query';
    tdQuery.textContent = p.query_id;
    tr.appendChild(tdQuery);

    // Contributor
    var tdContrib = document.createElement('td');
    tdContrib.className = 'col-contrib';
    tdContrib.textContent = p.label || p.contributor_id;
    tr.appendChild(tdContrib);

    // Address
    var tdAddr = document.createElement('td');
    tdAddr.className = 'col-addr';
    var addrLink = document.createElement('a');
    addrLink.href = '#';
    addrLink.className = 'addr-link';
    addrLink.textContent = truncAddr(p.address);
    addrLink.title = p.address;
    addrLink.setAttribute('data-addr', p.address);
    tdAddr.appendChild(addrLink);
    tr.appendChild(tdAddr);

    // Amount
    var tdAmt = document.createElement('td');
    tdAmt.className = 'col-right col-amount';
    tdAmt.textContent = '$' + p.amount_usdc.toFixed(6);
    tr.appendChild(tdAmt);

    payoutsBody.appendChild(tr);
  }
}

// --- Address filter ---
payoutsBody.addEventListener('click', function (ev) {
  var link = ev.target.closest('.addr-link');
  if (!link) return;
  ev.preventDefault();
  activeFilter = link.getAttribute('data-addr');
  history.replaceState(null, '', '?address=' + encodeURIComponent(activeFilter));
  renderTable();
});

filterClear.addEventListener('click', function () {
  activeFilter = null;
  history.replaceState(null, '', window.location.pathname);
  renderTable();
});

// --- Helpers ---
function truncAddr(addr) {
  if (!addr || addr.length < 14) return addr || '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function relativeTime(isoStr) {
  var now = Date.now();
  var then = new Date(isoStr).getTime();
  var diff = now - then;
  if (diff < 0) return 'just now';
  var seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  return days + 'd ago';
}

// --- TEE status pill (shared with other pages) ---
(async () => {
  try {
    var res = await fetch('/api/attestation');
    var info = await res.json();
    var pill = document.getElementById('teePill');
    if (!pill) return;
    if (info.insideTEE) {
      var appId = info.appId || '';
      var short = appId.length > 10
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
