/* ==========================================================================
   Vino — Welcome Landing Page Script (welcome.js)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // ---- Auth guard: redirect to login if no session ----
  const session = getUserSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  // ---- Personalize greeting ----
  (function initGreeting() {
    try {
      const greetingEl = document.getElementById('welcomeGreeting');
      if (session && session.firstName && greetingEl) {
        const hour = new Date().getHours();
        let timeGreeting = 'Good evening';
        if (hour < 12) timeGreeting = 'Good morning';
        else if (hour < 17) timeGreeting = 'Good afternoon';

        greetingEl.innerHTML = `${timeGreeting}, <span class="user-name">${escapeHtml(session.firstName)}</span>. Here's your cellar at a glance.`;
      }
    } catch (e) {
      console.warn('Greeting initialization error', e);
    }
  })();

  // ---- Load cellar data and compute stats ----
  const cellar = loadCellar();
  const stats = calculateCellarStats(cellar);

  // ---- Smooth Animated Counter ----
  function animateCounter(elementId, targetValue, prefix = '', suffix = '') {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (targetValue === 0) {
      el.textContent = `${prefix}0${suffix}`;
      return;
    }

    const duration = 1200;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(eased * targetValue);

      el.textContent = `${prefix}${current.toLocaleString()}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = `${prefix}${targetValue.toLocaleString()}${suffix}`;
      }
    }

    requestAnimationFrame(update);
  }

  // ---- Animate counters after entrance animations ----
  setTimeout(() => {
    animateCounter('totalBottles', stats.totalBottles, '', '');
    animateCounter('totalValue', stats.totalValue, '$', '');

    const winesEl = document.getElementById('distinctWines');
    if (winesEl) {
      winesEl.innerHTML = `${stats.distinctCount}<span class="unit"> wines</span>`;
    }
  }, 450);
});
