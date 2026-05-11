(async () => {
  // KMS collapsible toggle
  const toggle = document.getElementById('kmsToggle');
  const body = document.getElementById('kmsBody');
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.collapse-chevron').textContent = open ? '▾' : '▸';
  });

  try {
    const res = await fetch('/api/attestation');
    const info = await res.json();

    // Dev banner
    if (!info.insideTEE) {
      document.getElementById('devBanner').hidden = false;
    }

    // KV fields
    document.getElementById('kInsideTEE').textContent = info.insideTEE
      ? 'Active — Intel TDX'
      : 'Inactive (local dev)';
    document.getElementById('kInsideTEE').style.color = info.insideTEE
      ? 'var(--accent-2)'
      : 'var(--warn)';

    document.getElementById('kNetwork').textContent = info.network || '—';
    document.getElementById('kAppId').textContent = info.appId || '—';

    // Verify link
    const verifyLink = document.getElementById('verifyLink');
    if (info.verifyUrl) {
      verifyLink.href = info.verifyUrl;
    } else {
      verifyLink.removeAttribute('href');
      verifyLink.textContent = 'Attestation link unavailable (no App ID)';
      verifyLink.classList.add('disabled');
      verifyLink.setAttribute('aria-disabled', 'true');
      verifyLink.setAttribute('tabindex', '-1');
    }

    // KMS key
    if (info.kmsPublicKey) {
      document.getElementById('kmsPubKey').textContent = info.kmsPublicKey;
    }

    // TEE header pill
    const pill = document.getElementById('teePill');
    if (pill) {
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
    }
  } catch (err) {
    const banner = document.createElement('div');
    banner.className = 'fetch-error';
    banner.textContent = 'Failed to load attestation data: ' + err.message;
    document.body.insertBefore(banner, document.body.firstChild);
  }
})();
