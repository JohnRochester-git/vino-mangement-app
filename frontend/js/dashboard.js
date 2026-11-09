/* ==========================================================================
   Vino — Cellar Dashboard Logic (dashboard.js)
   ========================================================================== */

// ---- STATE MANAGEMENT ----
let cellar = [];
let activeWineId = null;
let activeTypeFilter = 'All';
let activePairFilter = 'All';
let activeRegionFilter = 'All';
let activeSort = 'default';
let searchQuery = '';
let viewMode = 'grid'; // 'grid' or 'region'
let bottlesConsumedCount = 5;

// ----------------------------------------------------
// STATS CALCULATION & DOM UPDATE
// ----------------------------------------------------
function updateStats() {
  const stats = calculateCellarStats(cellar);

  const distinctEl = document.getElementById('statDistinct');
  const bottlesEl = document.getElementById('statBottles');
  const valueEl = document.getElementById('statValue');
  const oldestEl = document.getElementById('statOldest');

  if (distinctEl) distinctEl.textContent = stats.distinctCount;
  if (bottlesEl) bottlesEl.textContent = stats.totalBottles;
  if (valueEl) valueEl.textContent = `$${stats.totalValue.toLocaleString()}`;
  if (oldestEl) oldestEl.textContent = stats.oldestVintage;
}

// ----------------------------------------------------
// BOTTLE SVG ARTWORK BY TYPE
// ----------------------------------------------------
function getWineSvg(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('dessert')) {
    return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#C9A15B" stroke-width="1.3"><path d="M8 2h8v5a4 4 0 01-4 4 4 4 0 01-4-4V2zM12 11v9M8 20h8"/></svg>`;
  }
  if (t.includes('sparkling')) {
    return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#C9A15B" stroke-width="1.3"><path d="M9 3h6l-1 9a3 3 0 01-4 0L9 3zM12 12v8M9 20h6"/><circle cx="12" cy="7" r="0.75" fill="#C9A15B"/><circle cx="11" cy="5" r="0.75" fill="#C9A15B"/><circle cx="13" cy="9" r="0.75" fill="#C9A15B"/></svg>`;
  }
  if (t.includes('white') || t.includes('rose') || t.includes('rosé')) {
    return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#C9A15B" stroke-width="1.3"><path d="M8 3h8l-1 7a3 3 0 01-6 0L8 3zM12 10v9M8 20h8"/></svg>`;
  }
  return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#C9A15B" stroke-width="1.3"><path d="M8 3h8l-1 6a3 3 0 01-6 0z"/><path d="M12 9v9M8 21h8"/></svg>`;
}

// ----------------------------------------------------
// MATURITY BADGE HELPER (FEATURE 2)
// ----------------------------------------------------
function getMaturityBadgeInfo(maturityRaw) {
  const m = (maturityRaw || 'Ready to Enjoy').trim();
  const lower = m.toLowerCase();

  if (lower.includes('peak')) {
    return {
      cssClass: 'maturity-peak',
      label: 'Drink Tonight',
      title: 'Peak Maturity — Ideal drinking window right now',
      iconHtml: '<span class="maturity-pulse-dot"></span>'
    };
  }
  if (lower.includes('ready')) {
    return {
      cssClass: 'maturity-ready',
      label: 'Ready to Enjoy',
      title: 'Ready to Enjoy — In prime drinking window',
      iconHtml: '<span class="maturity-ready-dot"></span>'
    };
  }
  if (lower.includes('grace')) {
    return {
      cssClass: 'maturity-aging',
      label: 'Aging Gracefully',
      title: 'Aging Gracefully — Developing secondary complexity in cellar',
      iconHtml: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };
  }
  return {
    cssClass: 'maturity-hold',
    label: 'Keep Aging',
    title: 'Cellar Candidate — Hold for further cellar maturation',
    iconHtml: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
  };
}

// ----------------------------------------------------
// QUICK IN-CARD QUANTITY STEPPER (FEATURE 3)
// ----------------------------------------------------
function quickAdjustWineQty(event, wineId, delta) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const wine = cellar.find(w => w.id === wineId);
  if (!wine) return;

  const currentQty = Number(wine.quantity) || 0;
  let newQty = currentQty + delta;
  if (newQty < 0) newQty = 0;

  if (delta < 0) {
    if (currentQty <= 0) {
      showToast(`"${wine.name}" is already depleted`);
      return;
    }
    bottlesConsumedCount++;
    logUncorkEvent(wine);
    if (newQty === 0) {
      showToast(`Uncorked last bottle of "${wine.name}"`);
    } else {
      showToast(`Uncorked 1 bottle of "${wine.name}" (${newQty} remaining)`);
    }
  } else if (delta > 0) {
    showToast(`Added 1 bottle of "${wine.name}" (Now ${newQty})`);
  }

  wine.quantity = newQty;
  saveCellar(cellar);
  updateStats();
  renderMain();

  // If this wine is open in overview modal, refresh it
  if (activeWineId === wineId) {
    openOverview(wineId);
  }
}
window.quickAdjustWineQty = quickAdjustWineQty;

// ----------------------------------------------------
// SINGLE BOTTLE CARD HTML BUILDER
// ----------------------------------------------------
function buildBottleCardHtml(w) {
  const typeClass = (w.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ageStr = getWineAge(w.vintage);
  const pairingsMini = (w.pairings || []).slice(0, 3).map(p => `<span class="pair-pill-mini">${escapeHtml(p)}</span>`).join('');
  const worthFormatted = Number(w.price).toLocaleString();
  const qty = Number(w.quantity) || 0;
  const mat = getMaturityBadgeInfo(w.maturity);

  return `
  <div class="bottle-card" onclick="openOverview('${w.id}')" title="Click to view full sommelier overview">
    <div class="bottle-image">
      <span class="bottle-tag ${typeClass}">${escapeHtml(w.type)}</span>
      
      <!-- Quick Quantity Stepper (Feature 3) -->
      <div class="card-qty-stepper" onclick="event.stopPropagation();" title="Quick adjust bottle quantity">
        <button type="button" class="card-qty-btn dec" onclick="quickAdjustWineQty(event, '${w.id}', -1)" aria-label="Uncork 1 bottle" title="Uncork 1 bottle" ${qty <= 0 ? 'disabled' : ''}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <span class="card-qty-num">${qty} ${qty === 1 ? 'bottle' : 'bottles'}</span>
        <button type="button" class="card-qty-btn inc" onclick="quickAdjustWineQty(event, '${w.id}', 1)" aria-label="Add 1 bottle" title="Add 1 bottle">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <div class="bottle-bg-art">
        ${getWineSvg(w.type)}
      </div>

      <!-- Drink Tonight / Maturity Status Badge (Feature 2) -->
      <div class="card-maturity-badge ${mat.cssClass}" title="${escapeHtml(mat.title)}">
        ${mat.iconHtml}
        <span>${escapeHtml(mat.label)}</span>
      </div>
    </div>
    <div class="bottle-body">
      <div class="bottle-header-row">
        <h3>${escapeHtml(w.name)}</h3>
      </div>
      <div class="bottle-region">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        ${escapeHtml(w.region)}
      </div>
      <div class="bottle-varietal">${escapeHtml(w.varietal || w.type + ' Wine')}</div>

      <div class="bottle-pair-preview">
        ${pairingsMini}
      </div>

      <div class="bottle-meta-row">
        <div class="bottle-worth">$${worthFormatted}</div>
        <div class="bottle-age">${w.vintage} • ${ageStr}</div>
      </div>

      <div class="bottle-click-hint">
        <span>View overview</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </div>
    </div>
  </div>
  `;
}

// ----------------------------------------------------
// FILTERING HELPER
// ----------------------------------------------------
function getFilteredWines() {
  return cellar.filter(w => {
    // Type filter
    if (activeTypeFilter !== 'All' && w.type.toLowerCase() !== activeTypeFilter.toLowerCase()) {
      return false;
    }
    // Region filter
    if (activeRegionFilter !== 'All') {
      const normRegion = (w.region || '').toLowerCase();
      if (!normRegion.includes(activeRegionFilter.toLowerCase())) return false;
    }
    // Pairing filter
    if (activePairFilter !== 'All') {
      const matchesPair = (w.pairings || []).some(p => p.toLowerCase() === activePairFilter.toLowerCase());
      if (!matchesPair) return false;
    }
    // Search query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const inName = (w.name || '').toLowerCase().includes(q);
      const inRegion = (w.region || '').toLowerCase().includes(q);
      const inVarietal = (w.varietal || '').toLowerCase().includes(q);
      const inNotes = (w.notes || '').toLowerCase().includes(q);
      if (!inName && !inRegion && !inVarietal && !inNotes) return false;
    }
    return true;
  });
}

// ----------------------------------------------------
// SORTING LOGIC (FEATURE 1)
// ----------------------------------------------------
function sortWinesList(list) {
  const sorted = [...list];
  switch (activeSort) {
    case 'vintage-desc':
      return sorted.sort((a, b) => (Number(b.vintage) || 0) - (Number(a.vintage) || 0));
    case 'vintage-asc':
      return sorted.sort((a, b) => (Number(a.vintage) || 0) - (Number(b.vintage) || 0));
    case 'price-desc':
      return sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    case 'price-asc':
      return sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    case 'quantity-desc':
      return sorted.sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
    case 'name-asc':
      return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'maturity': {
      const rank = {
        'peak maturity': 1,
        'drink tonight': 1,
        'ready to enjoy': 2,
        'aging gracefully': 3,
        'cellar candidate': 4,
        'keep aging': 4
      };
      return sorted.sort((a, b) => {
        const rankA = rank[(a.maturity || '').toLowerCase().trim()] || 99;
        const rankB = rank[(b.maturity || '').toLowerCase().trim()] || 99;
        if (rankA !== rankB) return rankA - rankB;
        return (Number(a.vintage) || 0) - (Number(b.vintage) || 0);
      });
    }
    default:
      return sorted;
  }
}

// ----------------------------------------------------
// RENDER MAIN VIEW (STANDARD GRID OR REGION CATEGORIZED)
// ----------------------------------------------------
function renderMain() {
  const gridContainer = document.getElementById('bottleGrid');
  const regionContainer = document.getElementById('regionContainer');
  const countDisplay = document.getElementById('gridCountDisplay');
  const modeIndicator = document.getElementById('viewModeIndicator');

  const filtered = sortWinesList(getFilteredWines());

  if (viewMode === 'grid') {
    gridContainer.style.display = 'grid';
    regionContainer.style.display = 'none';
    modeIndicator.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>Standard Grid View</span>
    `;
    countDisplay.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${cellar.length}</strong> wines`;

    if (filtered.length === 0) {
      gridContainer.innerHTML = `
        <div class="empty-state">
          <h3>No wines match your criteria</h3>
          <p>Try clearing your search, type, or food pairing filters.</p>
          <button class="btn-ghost" onclick="clearAllFilters()">Clear All Filters</button>
        </div>
      `;
      return;
    }

    gridContainer.innerHTML = filtered.map(w => buildBottleCardHtml(w)).join('');
  } else {
    // REGION CATEGORIZED VIEW
    gridContainer.style.display = 'none';
    regionContainer.style.display = 'flex';
    modeIndicator.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
      <span>Categorized by Region</span>
    `;

    if (filtered.length === 0) {
      regionContainer.innerHTML = `
        <div class="empty-state">
          <h3>No wines in this region view</h3>
          <p>Try clearing filters to see your full regional collection.</p>
          <button class="btn-ghost" onclick="clearAllFilters()">Clear All Filters</button>
        </div>
      `;
      countDisplay.innerHTML = `Showing <strong>0</strong> wines`;
      return;
    }

    // Group wines by region
    const regionsMap = {};
    filtered.forEach(w => {
      const regionKey = w.region || 'Unspecified Region';
      if (!regionsMap[regionKey]) {
        regionsMap[regionKey] = [];
      }
      regionsMap[regionKey].push(w);
    });

    const regionKeys = Object.keys(regionsMap).sort();
    countDisplay.innerHTML = `Showing <strong>${filtered.length}</strong> wines across <strong>${regionKeys.length}</strong> regions`;

    regionContainer.innerHTML = regionKeys.map(regName => {
      const winesInRegion = sortWinesList(regionsMap[regName]);
      const regBottles = winesInRegion.reduce((sum, w) => sum + (Number(w.quantity) || 0), 0);
      const regValue = winesInRegion.reduce((sum, w) => sum + ((Number(w.quantity) || 0) * (Number(w.price) || 0)), 0);

      return `
        <div class="region-group-card">
          <div class="region-header-banner">
            <div class="region-title-info">
              <div class="region-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
              </div>
              <div>
                <h2>${escapeHtml(regName)}</h2>
                <div class="region-meta-sub">${winesInRegion.length} distinct ${winesInRegion.length === 1 ? 'wine' : 'wines'} • ${regBottles} ${regBottles === 1 ? 'bottle' : 'bottles'} total</div>
              </div>
            </div>
            <div class="region-val-pill">
              $${regValue.toLocaleString()} Regional Value
            </div>
          </div>

          <div class="region-bottles-subgrid">
            ${winesInRegion.map(w => buildBottleCardHtml(w)).join('')}
          </div>
        </div>
      `;
    }).join('');
  }
}

// ----------------------------------------------------
// POPULATE DYNAMIC REGION FILTER CHIPS
// ----------------------------------------------------
function updateRegionFilterChips() {
  const chipContainer = document.getElementById('dynamicRegionChips');
  if (!chipContainer) return;

  const uniqueRegions = Array.from(new Set(cellar.map(w => w.region).filter(Boolean))).sort();

  let html = `<button type="button" class="chip ${activeRegionFilter === 'All' ? 'gold-active' : ''}" data-region="All">All Regions</button>`;
  uniqueRegions.forEach(r => {
    const isSelected = activeRegionFilter.toLowerCase() === r.toLowerCase();
    html += `<button type="button" class="chip ${isSelected ? 'gold-active' : ''}" data-region="${escapeHtml(r)}">${escapeHtml(r)}</button>`;
  });

  chipContainer.innerHTML = html;

  chipContainer.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      chipContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('gold-active', 'active'));
      const region = btn.getAttribute('data-region');
      activeRegionFilter = region;
      btn.classList.add('gold-active');
      updateFilterButtonState();
      renderMain();
    });
  });
}

// ----------------------------------------------------
// TOGGLE REGION CATEGORIZATION VIEW
// ----------------------------------------------------
function toggleRegionView() {
  const btn = document.getElementById('toggleRegionViewBtn');
  const textSpan = document.getElementById('regionToggleBtnText');

  if (viewMode === 'grid') {
    viewMode = 'region';
    if (btn) btn.classList.add('active');
    if (textSpan) textSpan.textContent = 'Categorized by Region ✓';
    showToast('Categorized cellar by wine regions');
  } else {
    viewMode = 'grid';
    if (btn) btn.classList.remove('active');
    if (textSpan) textSpan.textContent = 'Categorize by Region';
    activeRegionFilter = 'All';
    showToast('Switched back to standard grid view');
  }

  updateRegionFilterChips();
  renderMain();
}

// ----------------------------------------------------
// CELLAR JOURNAL & CONSUMPTION HISTORY (FEATURE 6)
// ----------------------------------------------------
function renderUncorkHistory() {
  const container = document.getElementById('profileUncorkList');
  const countBadge = document.getElementById('uncorkLogCountBadge');
  const profileBottlesUncorked = document.getElementById('profileBottlesUncorked');
  if (!container) return;

  const log = getUncorkLog();
  const count = log.length;

  if (countBadge) countBadge.textContent = `${count} ${count === 1 ? 'bottle enjoyed' : 'bottles enjoyed'}`;
  if (profileBottlesUncorked) profileBottlesUncorked.textContent = `${count} ${count === 1 ? 'bottle enjoyed' : 'bottles enjoyed'}`;

  if (count === 0) {
    container.innerHTML = `
      <div class="uncork-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dim)" stroke-width="1.5">
          <path d="M8 3h8l-1 6a3 3 0 01-6 0z" />
          <path d="M12 9v9M8 21h8" />
        </svg>
        <p>No bottles uncorked yet.</p>
        <span>Use the <strong>&minus;</strong> button on any wine card or click <strong>Uncork 1 Bottle</strong> in the bottle overview to start your cellar tasting log.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = log.map(entry => {
    const typeClass = (entry.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return `
      <div class="uncork-card">
        <div class="uncork-left">
          <div class="uncork-type-icon ${typeClass}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3h8l-1 6a3 3 0 01-6 0z" />
              <path d="M12 9v9M8 21h8" />
            </svg>
          </div>
          <div class="uncork-meta">
            <div class="uncork-header-line">
              <h4 class="uncork-wine-name">${escapeHtml(entry.name)}</h4>
              ${entry.vintage ? `<span class="uncork-vintage">${entry.vintage} Vintage</span>` : ''}
            </div>
            <div class="uncork-region-line">
              <span>${escapeHtml(entry.region || entry.varietal || '')}</span>
              <span class="uncork-bullet">&bull;</span>
              <span class="uncork-tag ${typeClass}">${escapeHtml(entry.type || 'Red')}</span>
            </div>
            ${entry.note ? `
              <div class="uncork-note">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>${escapeHtml(entry.note)}</span>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="uncork-date-pill">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>${escapeHtml(entry.dateStr)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// USER PROFILE MODAL
// ----------------------------------------------------
function openProfileModal() {
  const modal = document.getElementById('profileModal');
  let user = { username: 'Luke R', email: 'lukeroch38@example.com', memberSince: '2024-10-15' };

  const savedUser = getUserSession();
  if (savedUser) {
    user = Object.assign(user, savedUser);
  }

  // Initials
  const parts = (user.username || 'Luke R').trim().split(/\s+/);
  let initials = 'LR';
  if (parts.length >= 2) {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else if (parts.length === 1 && parts[0].length >= 1) {
    initials = parts[0].substring(0, 2).toUpperCase();
  }

  document.getElementById('profileModalAvatar').textContent = initials;
  document.getElementById('profileModalName').textContent = user.username || 'Luke R';
  document.getElementById('profileModalEmail').textContent = user.email || 'lukeroch38@example.com';

  const stats = calculateCellarStats(cellar);
  document.getElementById('profileTotalBottles').textContent = `${stats.totalBottles} ${stats.totalBottles === 1 ? 'Bottle' : 'Bottles'}`;
  document.getElementById('profileDistinctLabels').textContent = `${stats.distinctCount} ${stats.distinctCount === 1 ? 'Wine' : 'Wines'}`;
  document.getElementById('profileCollectionWorth').textContent = `$${stats.totalValue.toLocaleString()}`;

  // App Tenure
  const tenure = getAppTenureDetails(user.memberSince || '2024-10-15');
  document.getElementById('profileTenureYears').textContent = tenure.tenureString;
  document.getElementById('profileMemberSinceSub').textContent = tenure.memberSinceString;

  // Top Region Calculation
  const regionCounts = {};
  cellar.forEach(w => {
    const r = w.region || 'Other';
    regionCounts[r] = (regionCounts[r] || 0) + (Number(w.quantity) || 0);
  });
  let topRegionName = 'Bordeaux, France';
  let maxCount = 0;
  for (const [r, count] of Object.entries(regionCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topRegionName = r;
    }
  }
  document.getElementById('profileTopRegion').textContent = `${topRegionName} (${maxCount} bottles)`;

  // Crown Jewel (highest price bottle)
  let crownJewel = null;
  let maxPrice = -1;
  cellar.forEach(w => {
    if (Number(w.price) > maxPrice) {
      maxPrice = Number(w.price);
      crownJewel = w;
    }
  });
  if (crownJewel) {
    document.getElementById('profileCrownJewel').textContent = `${crownJewel.name} ($${Number(crownJewel.price).toLocaleString()})`;
  } else {
    document.getElementById('profileCrownJewel').textContent = '—';
  }

  // Oldest vintage
  if (stats.oldestVintage !== '—') {
    const age = new Date().getFullYear() - stats.oldestVintage;
    document.getElementById('profileOldestVintage').textContent = `${stats.oldestVintage} Vintage (${age} Years Old)`;
  }

  // Cellar Tasting Journal (Feature 6)
  renderUncorkHistory();

  // Populate edit form
  document.getElementById('editProfileName').value = user.username || 'Luke R';
  document.getElementById('editProfileEmail').value = user.email || 'lukeroch38@example.com';
  document.getElementById('profileEditBox').classList.remove('show');

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function saveProfileChanges() {
  const newName = document.getElementById('editProfileName').value.trim() || 'Luke R';
  const newEmail = document.getElementById('editProfileEmail').value.trim() || 'lukeroch38@example.com';

  let user = getUserSession() || { memberSince: '2024-10-15' };
  user.username = newName;
  user.email = newEmail;
  if (!user.memberSince) user.memberSince = '2024-10-15';

  saveUserSession(user);

  // Update hero card in real time
  document.getElementById('heroUserName').textContent = newName;
  document.getElementById('heroUserEmail').textContent = newEmail;

  const parts = newName.split(/\s+/);
  let initials = 'LR';
  if (parts.length >= 2) {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else if (parts.length === 1 && parts[0].length >= 1) {
    initials = parts[0].substring(0, 2).toUpperCase();
  }
  document.getElementById('heroAvatar').textContent = initials;
  document.getElementById('profileModalAvatar').textContent = initials;
  document.getElementById('profileModalName').textContent = newName;
  document.getElementById('profileModalEmail').textContent = newEmail;

  document.getElementById('profileEditBox').classList.remove('show');
  showToast('✓ Profile updated successfully');
}

// ----------------------------------------------------
// WINE OVERVIEW MODAL HANDLERS
// ----------------------------------------------------
function openOverview(wineId) {
  const wine = cellar.find(w => w.id === wineId);
  if (!wine) return;

  activeWineId = wineId;
  const currentYear = new Date().getFullYear();
  const age = getWineAge(wine.vintage);
  const typeClass = (wine.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const priceNum = Number(wine.price) || 0;
  const qtyNum = Number(wine.quantity) || 0;
  const totalWorth = priceNum * qtyNum;

  // Header tags
  const tagEl = document.getElementById('modalWineTypeTag');
  tagEl.className = 'bottle-tag ' + typeClass;
  tagEl.textContent = wine.type;

  document.getElementById('modalAgeBadge').textContent = age;
  document.getElementById('modalMaturityBadge').textContent = wine.maturity || 'Ready to Enjoy';

  // Hero title & region
  document.getElementById('modalWineTitle').textContent = wine.name;
  document.getElementById('modalRegionText').textContent = wine.region;
  document.getElementById('modalVarietalPill').textContent = wine.varietal || (wine.type + ' Wine');

  // 4 Key Stats
  document.getElementById('modalTypeVal').textContent = `${wine.type} Wine`;
  document.getElementById('modalVarietalSub').textContent = wine.varietal || 'Single Varietal / Blend';

  document.getElementById('modalWorthVal').innerHTML = `$${priceNum.toLocaleString()} <span style="font-size: 13px; font-family:'Inter'; color:var(--text-muted);">/ bottle</span>`;
  document.getElementById('modalTotalWorthSub').textContent = `Collection Lot: $${totalWorth.toLocaleString()} total`;

  document.getElementById('modalVintageVal').textContent = `${wine.vintage} Vintage`;
  document.getElementById('modalAgeSub').textContent = `${age} (${currentYear - wine.vintage} yrs of cellaring)`;

  document.getElementById('modalQtyVal').textContent = qtyNum;
  document.getElementById('modalStockStatus').textContent = qtyNum > 0 ? `${qtyNum} In Cellar` : 'Depleted';
  document.getElementById('modalQtySub').textContent = qtyNum === 1 ? '1 bottle remaining' : `${qtyNum} bottles in collection`;

  // Food Pairings
  const pairContainer = document.getElementById('modalPairChips');
  if (wine.pairings && wine.pairings.length > 0) {
    pairContainer.innerHTML = wine.pairings.map(p => `<span class="pair-badge">${escapeHtml(p)}</span>`).join('');
  } else {
    pairContainer.innerHTML = '<span class="pair-badge">Artisanal Cheeses</span><span class="pair-badge">Charcuterie</span>';
  }

  const pairGuide = wine.pairingGuide || `Pairs wonderfully with dishes harmonizing with ${wine.type.toLowerCase()} wine profiles, particularly ${(wine.pairings || ['rich mains']).join(', ')}.`;
  document.getElementById('modalPairGuide').textContent = pairGuide;

  // Tasting Notes
  const notes = wine.notes || 'Classic character with beautiful cellar evolution, balanced acidity, and generous aromatic finish.';
  document.getElementById('modalNotesQuote').textContent = `"${notes}"`;

  // Show modal
  const modal = document.getElementById('overviewModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeOverview() {
  const modal = document.getElementById('overviewModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  activeWineId = null;
}

// Adjust quantity from inside overview
function adjustWineQty(delta) {
  if (!activeWineId) return;
  const wine = cellar.find(w => w.id === activeWineId);
  if (!wine) return;

  const currentQty = Number(wine.quantity) || 0;
  let newQty = currentQty + delta;
  if (newQty < 0) newQty = 0;

  if (delta < 0) {
    if (currentQty <= 0) {
      showToast(`"${wine.name}" is already depleted`);
      return;
    }
    bottlesConsumedCount++;
    logUncorkEvent(wine);
  }

  wine.quantity = newQty;

  saveCellar(cellar);
  updateStats();
  renderMain();

  // Update modal in place
  openOverview(activeWineId);

  if (delta < 0 && newQty === 0) {
    showToast(`Finished last bottle of ${wine.name}`);
  } else if (delta < 0) {
    showToast(`Enjoy the bottle! ${newQty} bottle(s) remaining.`);
  } else {
    showToast(`Added 1 bottle of ${wine.name} (Now ${newQty})`);
  }
}

function deleteActiveWine() {
  if (!activeWineId) return;
  const wine = cellar.find(w => w.id === activeWineId);
  if (!wine) return;

  if (confirm(`Are you sure you want to remove "${wine.name}" from your cellar collection?`)) {
    cellar = cellar.filter(w => w.id !== activeWineId);
    saveCellar(cellar);
    updateStats();
    updateRegionFilterChips();
    renderMain();
    closeOverview();
    showToast(`Removed "${wine.name}" from cellar`);
  }
}

// ----------------------------------------------------
// BARCODE SCANNER & OPEN FOOD FACTS INTEGRATION
// ----------------------------------------------------
let html5QrCodeScanner = null;
let isScannerRunning = false;

async function openScannerModal() {
  const modal = document.getElementById('barcodeScannerModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const statusLabel = document.getElementById('scannerStatusLabel');
  const fallbackBox = document.getElementById('scannerFallbackBox');
  if (statusLabel) statusLabel.textContent = 'Requesting camera access...';
  if (fallbackBox) fallbackBox.style.display = 'none';

  await startScanner();
}

async function closeScannerModal() {
  const modal = document.getElementById('barcodeScannerModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  await stopScanner();

  // Restore body scrolling only if addWineModal is also closed
  const addModal = document.getElementById('addWineModal');
  if (!addModal || !addModal.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

async function startScanner() {
  const statusLabel = document.getElementById('scannerStatusLabel');
  const fallbackBox = document.getElementById('scannerFallbackBox');

  if (typeof Html5Qrcode === 'undefined') {
    if (statusLabel) statusLabel.textContent = 'Scanner library loading or unavailable.';
    if (fallbackBox) fallbackBox.style.display = 'block';
    return;
  }

  try {
    if (!html5QrCodeScanner) {
      html5QrCodeScanner = new Html5Qrcode("barcodeReader", { verbose: false });
    }

    if (isScannerRunning) return;

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.min(viewfinderWidth * 0.85, 300);
        const height = Math.min(viewfinderHeight * 0.55, 160);
        return { width: Math.round(width), height: Math.round(height) };
      },
      aspectRatio: 1.333333
    };

    await html5QrCodeScanner.start(
      { facingMode: "environment" },
      config,
      onBarcodeScanSuccess,
      () => { /* frame decode scan loop */ }
    );
    isScannerRunning = true;
    if (statusLabel) statusLabel.textContent = 'Camera active. Point at bottle barcode.';
  } catch (err) {
    console.warn("Camera start failed:", err);
    isScannerRunning = false;
    if (statusLabel) {
      statusLabel.textContent = 'Camera access denied or unavailable.';
    }
    if (fallbackBox) fallbackBox.style.display = 'block';
  }
}

async function stopScanner() {
  if (html5QrCodeScanner && isScannerRunning) {
    try {
      await html5QrCodeScanner.stop();
    } catch (e) {
      console.warn("Error stopping scanner:", e);
    } finally {
      isScannerRunning = false;
    }
  }
}

async function onBarcodeScanSuccess(decodedText) {
  await stopScanner();
  await closeScannerModal();

  showToast(`Barcode detected: ${decodedText}. Looking up wine...`);
  openAddWineModal();
  await lookupWineByBarcode(decodedText);
}

async function lookupWineByBarcode(barcode) {
  const cleanBarcode = String(barcode).trim();
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'VinoCellarApp/1.0 (StudentProject)'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.status === 1 && data.product) {
      populateAddWineFormFromOFF(data.product, cleanBarcode);
    } else {
      showToast(`Product not found in Open Food Facts (${cleanBarcode}). Please enter details manually.`);
      const nameInput = document.getElementById('inputName');
      if (nameInput) nameInput.focus();
    }
  } catch (err) {
    console.error("Open Food Facts lookup failed:", err);
    showToast(`Could not query Open Food Facts. Please enter wine details manually.`);
    const nameInput = document.getElementById('inputName');
    if (nameInput) nameInput.focus();
  }
}

function populateAddWineFormFromOFF(product, barcode) {
  const brand = (product.brands || product.brand_owner || '').trim();
  const rawName = (product.product_name || product.product_name_en || product.generic_name || '').trim();

  let finalName = '';
  if (brand && rawName) {
    if (rawName.toLowerCase().includes(brand.toLowerCase())) {
      finalName = rawName;
    } else {
      finalName = `${brand} - ${rawName}`;
    }
  } else {
    finalName = brand || rawName || `Wine (${barcode})`;
  }

  // Type inference from categories, labels, and product name
  const catSearch = ((product.categories_tags || []).join(' ') + ' ' + (product.categories || '') + ' ' + (product.labels_tags || []).join(' ') + ' ' + finalName).toLowerCase();
  let detectedType = 'Red';
  if (catSearch.includes('sparkling') || catSearch.includes('champagne') || catSearch.includes('prosecco') || catSearch.includes('cava')) {
    detectedType = 'Sparkling';
  } else if (catSearch.includes('rose') || catSearch.includes('rosé') || catSearch.includes('pink wine')) {
    detectedType = 'Rosé';
  } else if (catSearch.includes('white') || catSearch.includes('blanc') || catSearch.includes('chardonnay') || catSearch.includes('sauvignon blanc') || catSearch.includes('pinot grigio') || catSearch.includes('riesling')) {
    detectedType = 'White';
  } else if (catSearch.includes('dessert') || catSearch.includes('sauternes') || catSearch.includes('ice wine')) {
    detectedType = 'Dessert';
  } else if (catSearch.includes('port') || catSearch.includes('sherry') || catSearch.includes('fortified') || catSearch.includes('madeira')) {
    detectedType = 'Fortified';
  } else {
    detectedType = 'Red';
  }

  // Region / Origin
  let region = (product.origins || product.manufacturing_places || product.countries || '').trim();
  region = region.replace(/\ben:/g, '').replace(/_/g, ' ');

  // Varietal detection
  let detectedVarietal = '';
  const commonVarietals = [
    'Cabernet Sauvignon', 'Pinot Noir', 'Merlot', 'Chardonnay', 'Sauvignon Blanc',
    'Syrah', 'Shiraz', 'Zinfandel', 'Malbec', 'Nebbiolo', 'Sangiovese', 'Tempranillo',
    'Riesling', 'Pinot Grigio', 'Pinot Gris', 'Grenache', 'Bordeaux Blend'
  ];
  for (const v of commonVarietals) {
    if (catSearch.includes(v.toLowerCase())) {
      detectedVarietal = v;
      break;
    }
  }

  // Vintage detection from name (e.g. 2018, 2020)
  const vintageMatch = finalName.match(/\b(19\d{2}|20[0-2]\d)\b/);

  // Apply to form inputs
  const nameInput = document.getElementById('inputName');
  const typeSelect = document.getElementById('inputType');
  const regionInput = document.getElementById('inputRegion');
  const varietalInput = document.getElementById('inputVarietal');
  const vintageInput = document.getElementById('inputVintage');
  const notesInput = document.getElementById('inputNotes');

  if (nameInput) nameInput.value = finalName;
  if (typeSelect) typeSelect.value = detectedType;
  if (regionInput && region) regionInput.value = region;
  if (varietalInput && detectedVarietal) varietalInput.value = detectedVarietal;
  if (vintageInput && vintageMatch) vintageInput.value = parseInt(vintageMatch[0], 10);

  if (notesInput && !notesInput.value) {
    const alcohol = product.alcohol_100g || product.alcohol_value;
    let note = `Acquisition scanned via Open Food Facts (UPC/EAN: ${barcode}).`;
    if (alcohol) note += ` ABV: ${alcohol}%.`;
    notesInput.value = note;
  }

  showToast(`✓ Loaded "${finalName}"! Please verify price and vintage.`);
  const priceInput = document.getElementById('inputPrice');
  if (priceInput) priceInput.focus();
}

// ----------------------------------------------------
// ADD WINE MODAL HANDLERS
// ----------------------------------------------------
function openAddWineModal() {
  const modal = document.getElementById('addWineModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.getElementById('inputName').focus();
}

function closeAddWineModal() {
  const modal = document.getElementById('addWineModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  document.getElementById('addWineForm').reset();
  document.querySelectorAll('#formPairChips .select-chip').forEach(c => c.classList.remove('selected'));
}

function handleAddWineSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('inputName').value.trim();
  const type = document.getElementById('inputType').value;
  const varietal = document.getElementById('inputVarietal').value.trim();
  const region = document.getElementById('inputRegion').value.trim();
  const vintage = parseInt(document.getElementById('inputVintage').value, 10);
  const price = parseFloat(document.getElementById('inputPrice').value) || 0;
  const quantity = parseInt(document.getElementById('inputQty').value, 10) || 1;
  const maturity = document.getElementById('inputMaturity').value;
  const notes = document.getElementById('inputNotes').value.trim();

  // Selected pairing chips
  const selectedPairings = Array.from(document.querySelectorAll('#formPairChips .select-chip.selected'))
    .map(chip => chip.getAttribute('data-val'));

  const newWine = {
    id: 'wine_' + Date.now(),
    name,
    type,
    varietal: varietal || (type + ' Wine'),
    region,
    vintage: vintage || new Date().getFullYear(),
    price: Math.round(price),
    quantity: quantity > 0 ? quantity : 1,
    maturity,
    pairings: selectedPairings.length > 0 ? selectedPairings : ['Cheese', 'Charcuterie'],
    notes: notes || 'Recently added cellar acquisition with superb aging potential.',
    pairingGuide: `Pairs beautifully with dishes that elevate ${type.toLowerCase()} wine, such as ${(selectedPairings.length ? selectedPairings : ['fine meats and cheeses']).join(', ')}.`
  };

  cellar.unshift(newWine);
  saveCellar(cellar);
  updateStats();
  updateRegionFilterChips();
  renderMain();
  closeAddWineModal();

  showToast(`✓ Added "${newWine.name}" to your cellar!`);
}

// ----------------------------------------------------
// WINE RECOMMENDATION (SOMMELIER PAIRING ASSISTANT)
// ----------------------------------------------------
let currentRecommendedWineId = null;
let lastRecommendationData = null;

const FOOD_KEYWORDS_MAP = {
  Beef: ['beef', 'steak', 'ribeye', 'filet', 'strip', 'tenderloin', 'burger', 'brisket', 'roast beef', 'sirloin', 'wagyu', 'meat'],
  Poultry: ['chicken', 'poultry', 'turkey', 'duck', 'hen', 'fowl', 'quail', 'wings'],
  Seafood: ['seafood', 'fish', 'salmon', 'trout', 'halibut', 'seabass', 'sea bass', 'cod', 'tuna', 'lobster', 'crab', 'shrimp', 'prawn', 'oyster', 'scallop', 'mussel', 'clams', 'sushi'],
  Pasta: ['pasta', 'spaghetti', 'lasagna', 'fettuccine', 'carbonara', 'ragu', 'bolognese', 'ravioli', 'penne', 'risotto', 'gnocchi', 'italian'],
  Lamb: ['lamb', 'chop', 'mutton', 'shank', 'rack of lamb'],
  Cheese: ['cheese', 'brie', 'cheddar', 'parmesan', 'parmigiano', 'comte', 'gouda', 'roquefort', 'mozzarella', 'fondue'],
  Charcuterie: ['charcuterie', 'prosciutto', 'salami', 'jamon', 'chorizo', 'pate', 'cured meat', 'iberico'],
  Salad: ['salad', 'greens', 'kale', 'caesar', 'arugula', 'spinach', 'vegetables', 'vegetarian'],
  Dessert: ['dessert', 'cake', 'tart', 'pastry', 'pie', 'creme brulee', 'sweet', 'ice cream', 'fruit'],
  Chocolate: ['chocolate', 'cacao', 'fudge', 'truffle', 'brownie', 'cocoa'],
  Spicy: ['spicy', 'curry', 'thai', 'chili', 'hot', 'szechuan', 'jalapeno', 'tacos', 'mexican', 'cajun']
};

function openRecommendModal() {
  const modal = document.getElementById('recommendWineModal');
  if (!modal) return;

  const mealInput = document.getElementById('recMealInput');
  if (mealInput) mealInput.value = '';

  document.querySelectorAll('#recFoodChips .select-chip').forEach(c => c.classList.remove('selected'));

  document.querySelectorAll('#recOccasionChips .select-chip').forEach(c => {
    if (c.getAttribute('data-val') === 'Casual Dinner') {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  const formView = document.getElementById('recommendFormView');
  const resultView = document.getElementById('recommendResultView');
  if (formView) formView.style.display = 'block';
  if (resultView) resultView.style.display = 'none';

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  if (mealInput) setTimeout(() => mealInput.focus(), 100);
}

function closeRecommendModal() {
  const modal = document.getElementById('recommendWineModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function autoDetectFoodCategories(text) {
  const t = (text || '').toLowerCase();
  const detected = [];
  for (const [category, keywords] of Object.entries(FOOD_KEYWORDS_MAP)) {
    if (keywords.some(k => t.includes(k))) {
      detected.push(category);
    }
  }
  return detected;
}

function getSommelierRationale(wine, foodCategories, occasion, mealText) {
  const foodStr = foodCategories.length ? foodCategories.join(', ') : (mealText || 'your meal');
  let pairingLogic = '';
  const matchCategory = foodCategories.find(c => (wine.pairings || []).map(p => p.toLowerCase()).includes(c.toLowerCase()));

  if (matchCategory) {
    if (matchCategory === 'Beef' || matchCategory === 'Lamb') {
      pairingLogic = `${wine.name}'s structured tannins, dark fruit depth, and cellar aging harmonize brilliantly with the savory richness of ${foodStr}.`;
    } else if (matchCategory === 'Seafood') {
      pairingLogic = `The crisp, minerally profile and bright acidity of this ${wine.varietal} elevate the delicate flavors of ${foodStr} without overwhelming them.`;
    } else if (matchCategory === 'Poultry') {
      pairingLogic = `The balanced body and nuanced aromatics of ${wine.name} complement roasted and savory notes in ${foodStr} delightfully.`;
    } else if (matchCategory === 'Pasta') {
      pairingLogic = `Classic pairing chemistry: the vibrant acidity and fruit profile of this ${wine.varietal} cut through the richness of ${foodStr}.`;
    } else if (matchCategory === 'Cheese' || matchCategory === 'Charcuterie') {
      pairingLogic = `An artisanal match—the depth and aromatics of ${wine.name} accentuate the salty and rich characteristics of ${foodStr}.`;
    } else if (matchCategory === 'Dessert' || matchCategory === 'Chocolate') {
      pairingLogic = `The luscious bouquet and sweetness balance in ${wine.name} provide a luxurious accompaniment to ${foodStr}.`;
    } else if (matchCategory === 'Salad') {
      pairingLogic = `Crisp and refreshing, ${wine.name} preserves the brightness of greens and vinaigrette without clashing.`;
    } else {
      pairingLogic = `${wine.name} is specifically recognized in your cellar notes to pair exquisitely with ${matchCategory}.`;
    }
  } else {
    pairingLogic = `${wine.name} is one of your cellar's most versatile, balanced bottles to accompany ${foodStr}.`;
  }

  let occasionLogic = '';
  if (occasion.includes('Celebration')) {
    occasionLogic = `For a special celebration, this ${wine.vintage} vintage brings prestige, distinction, and memorable cellar character to your table.`;
  } else if (occasion.includes('Romantic')) {
    occasionLogic = `For an intimate romantic evening, its refined palate and seductive finish set an elegant, unforgettable ambiance.`;
  } else if (occasion.includes('Dinner Party')) {
    occasionLogic = `At a dinner party, its crowd-pleasing balance and distinction (${wine.quantity} bottles in cellar) make it a generous bottle to share.`;
  } else if (occasion.includes('Quiet Evening')) {
    occasionLogic = `For a quiet relaxing evening, this bottle allows you to unwind and appreciate fine craftsmanship.`;
  } else {
    occasionLogic = `For dinner, it offers delicious drinkability that elevates your meal seamlessly.`;
  }

  let guideSnippet = '';
  if (wine.pairingGuide) {
    guideSnippet = ` Sommelier note: "${wine.pairingGuide}"`;
  }

  return `${pairingLogic} ${occasionLogic}${guideSnippet}`;
}

function calculateWineRecommendation(mealText, foodCategories, occasion) {
  if (!cellar || cellar.length === 0) return null;

  const lowerMeal = (mealText || '').toLowerCase();

  const scored = cellar.map(w => {
    let score = 20; // baseline
    const winePairings = (w.pairings || []).map(p => p.toLowerCase());

    // 1. Food category matching
    foodCategories.forEach(f => {
      if (winePairings.includes(f.toLowerCase())) {
        score += 45;
      }
    });

    // 2. Keyword overlap in wine attributes
    const wineSearchBlob = `${w.name} ${w.varietal} ${w.region} ${w.notes} ${w.pairingGuide}`.toLowerCase();
    const words = lowerMeal.split(/[\s,.-]+/).filter(wrd => wrd.length > 3);
    words.forEach(word => {
      if (wineSearchBlob.includes(word)) {
        score += 15;
      }
    });

    // 3. Occasion matching
    if (occasion.includes('Celebration')) {
      if (w.type === 'Sparkling') score += 35;
      if (w.price >= 150) score += 25;
      if (w.vintage && w.vintage <= 2015) score += 15;
    } else if (occasion.includes('Romantic')) {
      if (w.type === 'Red' || w.type === 'Sparkling') score += 20;
      if (w.maturity === 'Peak Maturity') score += 15;
    } else if (occasion.includes('Casual')) {
      if (w.price <= 50) score += 25;
      if (w.maturity === 'Ready to Enjoy') score += 15;
    } else if (occasion.includes('Dinner Party')) {
      if (w.quantity >= 2) score += 20;
    }

    // 4. Stock availability bonus
    if (w.quantity > 0) score += 15;

    // 5. Maturity suitability bonus
    if (w.maturity === 'Peak Maturity' || w.maturity === 'Ready to Enjoy') {
      score += 10;
    }

    return { wine: w, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topWine = scored[0].wine;
  const altWine = scored.length > 1 && scored[1].score > 25 ? scored[1].wine : null;
  const confidence = Math.min(98, Math.max(84, 78 + Math.round(scored[0].score / 3.5)));

  return {
    topWine,
    altWine,
    confidence,
    foodCategories,
    occasion,
    mealText
  };
}

function renderRecommendationResult(data) {
  const container = document.getElementById('recommendResultContent');
  if (!container) return;

  if (!data || !data.topWine) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px;">
        <h3>No Matching Wines Found</h3>
        <p>Your cellar doesn't have an available bottle right now. Add more wines to enable pairing recommendations!</p>
      </div>
    `;
    return;
  }

  currentRecommendedWineId = data.topWine.id;
  const wine = data.topWine;
  const typeClass = (wine.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const qty = Number(wine.quantity) || 0;
  const qtyStr = qty === 1 ? '1 bottle in cellar' : `${qty} bottles in cellar`;
  const rationale = getSommelierRationale(wine, data.foodCategories, data.occasion, data.mealText);

  let altHtml = '';
  if (data.altWine && data.altWine.id !== wine.id) {
    const alt = data.altWine;
    altHtml = `
      <div style="margin-top: 16px;">
        <div style="font-size: 11.5px; font-weight: 600; color: var(--gold); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">
          Alternative Cellar Option
        </div>
        <div class="rec-alternative-card">
          <div>
            <div style="color: #fff; font-size: 14px; font-weight: 500;">${escapeHtml(alt.name)} (${alt.vintage})</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              ${escapeHtml(alt.varietal)} • ${escapeHtml(alt.type)} • $${Number(alt.price).toLocaleString()}
            </div>
          </div>
          <button type="button" class="btn-ghost" style="padding: 6px 14px; font-size: 12px;" onclick="switchRecommendedWine('${alt.id}')">
            Switch to This
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="rec-match-badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
      </svg>
      Sommelier Choice • ${data.confidence}% Pairing Match
    </div>

    <div class="rec-wine-card">
      <div class="rec-wine-icon">
        ${getWineSvg(wine.type)}
      </div>
      <div class="rec-wine-info" style="flex:1;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <h3 style="margin:0; font-size:19px; color:#fff;">${escapeHtml(wine.name)}</h3>
            <div class="rec-wine-meta">
              <span class="bottle-tag ${typeClass}">${escapeHtml(wine.type)}</span>
              <span>${wine.vintage} Vintage</span>
              <span>•</span>
              <span>${escapeHtml(wine.varietal)}</span>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="rec-wine-price">$${Number(wine.price).toLocaleString()}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">${qtyStr}</div>
          </div>
        </div>
        <div style="font-size:12.5px; color:var(--text-muted); margin-top:8px; display:flex; align-items:center; gap:5px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
          ${escapeHtml(wine.region)}
        </div>
      </div>
    </div>

    <div class="rec-rationale-box">
      <div class="rec-rationale-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 21h8M12 17v4M7 3h10l-1 8a4 4 0 01-8 0z"/>
        </svg>
        Sommelier Pairing Notes
      </div>
      <p class="rec-rationale-text">${escapeHtml(rationale)}</p>
    </div>

    ${altHtml}
  `;
}

window.switchRecommendedWine = function(wineId) {
  const targetWine = cellar.find(w => w.id === wineId);
  if (!targetWine || !lastRecommendationData) return;

  const currentTop = lastRecommendationData.topWine;
  lastRecommendationData.topWine = targetWine;
  lastRecommendationData.altWine = currentTop;

  renderRecommendationResult(lastRecommendationData);
};

function handleRecommendSubmit() {
  const mealInput = document.getElementById('recMealInput');
  const mealText = mealInput ? mealInput.value.trim() : '';

  const selectedChips = Array.from(document.querySelectorAll('#recFoodChips .select-chip.selected'))
    .map(c => c.getAttribute('data-val'));

  // Auto-detect foods mentioned in text
  const detected = autoDetectFoodCategories(mealText);
  const combinedFoods = Array.from(new Set([...selectedChips, ...detected]));

  const occasionChip = document.querySelector('#recOccasionChips .select-chip.selected');
  const occasion = occasionChip ? occasionChip.getAttribute('data-val') : 'Casual Dinner';

  if (!mealText && combinedFoods.length === 0) {
    showToast('Please describe your dish or choose a food category.');
    if (mealInput) mealInput.focus();
    return;
  }

  const result = calculateWineRecommendation(mealText, combinedFoods, occasion);
  lastRecommendationData = result;

  renderRecommendationResult(result);

  const formView = document.getElementById('recommendFormView');
  const resultView = document.getElementById('recommendResultView');
  if (formView) formView.style.display = 'none';
  if (resultView) resultView.style.display = 'block';
}

// ----------------------------------------------------
// TOAST NOTIFICATIONS
// ----------------------------------------------------
function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-icon">★</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 20);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ----------------------------------------------------
// FILTER BUTTON STATE & DROPDOWN MANAGEMENT
// ----------------------------------------------------
function updateFilterButtonState() {
  const label = document.getElementById('filterByTypeLabel');
  const pill = document.getElementById('filterActivePill');
  const btn = document.getElementById('filterByTypeBtn');
  if (!label || !pill || !btn) return;

  let activeCount = 0;
  if (activeTypeFilter !== 'All') activeCount++;
  if (activeRegionFilter !== 'All') activeCount++;
  if (activePairFilter !== 'All') activeCount++;

  if (activeTypeFilter !== 'All') {
    label.textContent = `Type: ${activeTypeFilter}`;
    btn.classList.add('has-filter');
  } else if (activeRegionFilter !== 'All') {
    label.textContent = `Region: ${activeRegionFilter}`;
    btn.classList.add('has-filter');
  } else if (activePairFilter !== 'All') {
    label.textContent = `Pair: ${activePairFilter}`;
    btn.classList.add('has-filter');
  } else {
    label.textContent = 'Filter by Type';
    btn.classList.remove('has-filter');
  }

  if (activeCount > 1) {
    pill.style.display = 'inline-block';
    pill.textContent = `+${activeCount - 1}`;
  } else {
    pill.style.display = 'none';
  }
}

function clearAllFilters() {
  activeTypeFilter = 'All';
  activePairFilter = 'All';
  activeRegionFilter = 'All';
  searchQuery = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  document.querySelectorAll('#typeChipRow .chip').forEach(c => {
    c.classList.toggle('gold-active', c.getAttribute('data-type') === 'All');
    c.classList.remove('active');
  });

  document.querySelectorAll('#pairChipRow .chip').forEach(c => {
    c.classList.toggle('gold-active', c.getAttribute('data-pair') === 'All');
    c.classList.remove('active');
  });

  updateRegionFilterChips();
  updateFilterButtonState();
  renderMain();
}

function setupFilters() {
  // Search Input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderMain();
    });
  }

  // Filter by Type Dropdown open / close
  const filterBtn = document.getElementById('filterByTypeBtn');
  const filterMenu = document.getElementById('filterDropdownMenu');

  if (filterBtn && filterMenu) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = filterMenu.classList.toggle('show');
      filterBtn.setAttribute('aria-expanded', isOpen);
      filterBtn.classList.toggle('active', isOpen);
    });

    filterMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!filterMenu.contains(e.target) && e.target !== filterBtn) {
        filterMenu.classList.remove('show');
        filterBtn.setAttribute('aria-expanded', 'false');
        filterBtn.classList.remove('active');
      }
    });
  }

  // Clear Filters button inside dropdown
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      clearAllFilters();
    });
  }

  // Wine Type Chips
  document.querySelectorAll('#typeChipRow .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#typeChipRow .chip').forEach(c => c.classList.remove('gold-active', 'active'));
      const type = chip.getAttribute('data-type');
      activeTypeFilter = type;
      chip.classList.add(type === 'All' ? 'gold-active' : 'active');
      updateFilterButtonState();
      renderMain();
    });
  });

  // Food Pairing Chips
  document.querySelectorAll('#pairChipRow .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#pairChipRow .chip').forEach(c => c.classList.remove('gold-active', 'active'));
      const pair = chip.getAttribute('data-pair');
      activePairFilter = pair;
      chip.classList.add('gold-active');
      updateFilterButtonState();
      renderMain();
    });
  });

  // Form pairing chips toggle in Add Wine dialog
  document.querySelectorAll('#formPairChips .select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
    });
  });

  // Region View Toggle Button
  const toggleRegionViewBtn = document.getElementById('toggleRegionViewBtn');
  if (toggleRegionViewBtn) {
    toggleRegionViewBtn.addEventListener('click', toggleRegionView);
  }

  // Scroll to top on "My Cellar" click
  const topMyCellarBtn = document.getElementById('topMyCellarBtn');
  if (topMyCellarBtn) {
    topMyCellarBtn.addEventListener('click', () => {
      clearAllFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ----------------------------------------------------
// SORT CONTROLS SETUP (FEATURE 1)
// ----------------------------------------------------
function setupSortControls() {
  const sortBtn = document.getElementById('sortByBtn');
  const sortMenu = document.getElementById('sortDropdownMenu');
  const sortLabel = document.getElementById('sortByLabel');
  const resetBtn = document.getElementById('resetSortBtn');
  const sortOptions = document.querySelectorAll('#sortOptionsList .sort-option-btn');

  const SORT_LABELS = {
    'default': 'Sort: Default',
    'maturity': 'Sort: Drink Tonight',
    'vintage-desc': 'Sort: Youngest',
    'vintage-asc': 'Sort: Oldest',
    'price-desc': 'Sort: Price High',
    'price-asc': 'Sort: Price Low',
    'quantity-desc': 'Sort: Quantity',
    'name-asc': 'Sort: Name A-Z'
  };

  function updateSortUI() {
    if (sortLabel) {
      sortLabel.textContent = SORT_LABELS[activeSort] || 'Sort: Default';
    }
    if (sortBtn) {
      sortBtn.classList.toggle('has-filter', activeSort !== 'default');
    }
    sortOptions.forEach(opt => {
      const match = opt.getAttribute('data-sort') === activeSort;
      opt.classList.toggle('active', match);
    });
  }

  if (sortBtn && sortMenu) {
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = sortMenu.classList.toggle('show');
      sortBtn.setAttribute('aria-expanded', isOpen);
      sortBtn.classList.toggle('active', isOpen);

      // Close filter menu if open
      const filterMenu = document.getElementById('filterDropdownMenu');
      const filterBtn = document.getElementById('filterByTypeBtn');
      if (filterMenu) filterMenu.classList.remove('show');
      if (filterBtn) {
        filterBtn.setAttribute('aria-expanded', 'false');
        filterBtn.classList.remove('active');
      }
    });

    sortMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!sortMenu.contains(e.target) && e.target !== sortBtn) {
        sortMenu.classList.remove('show');
        sortBtn.setAttribute('aria-expanded', 'false');
        sortBtn.classList.remove('active');
      }
    });
  }

  // Also close sortMenu when filterBtn is opened
  const filterBtn = document.getElementById('filterByTypeBtn');
  if (filterBtn && sortMenu && sortBtn) {
    filterBtn.addEventListener('click', () => {
      sortMenu.classList.remove('show');
      sortBtn.setAttribute('aria-expanded', 'false');
      sortBtn.classList.remove('active');
    });
  }

  sortOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const sortKey = opt.getAttribute('data-sort') || 'default';
      activeSort = sortKey;
      updateSortUI();
      if (sortMenu) sortMenu.classList.remove('show');
      if (sortBtn) {
        sortBtn.setAttribute('aria-expanded', 'false');
        sortBtn.classList.remove('active');
      }
      renderMain();
      showToast(`Sorted by ${opt.querySelector('span').textContent.trim()}`);
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeSort = 'default';
      updateSortUI();
      if (sortMenu) sortMenu.classList.remove('show');
      if (sortBtn) {
        sortBtn.setAttribute('aria-expanded', 'false');
        sortBtn.classList.remove('active');
      }
      renderMain();
      showToast('Reset cellar sorting to default');
    });
  }
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  cellar = loadCellar();
  updateStats();
  setupFilters();
  setupSortControls();
  updateRegionFilterChips();
  renderMain();

  // Wire User Profile Button (Right-hand hero card)
  const userCardBtn = document.getElementById('userCardBtn');
  if (userCardBtn) userCardBtn.addEventListener('click', openProfileModal);

  const closeProfileBtn = document.getElementById('closeProfileBtn');
  if (closeProfileBtn) closeProfileBtn.addEventListener('click', closeProfileModal);

  const closeProfileDoneBtn = document.getElementById('closeProfileDoneBtn');
  if (closeProfileDoneBtn) closeProfileDoneBtn.addEventListener('click', closeProfileModal);

  const toggleEditProfileBtn = document.getElementById('toggleEditProfileBtn');
  if (toggleEditProfileBtn) {
    toggleEditProfileBtn.addEventListener('click', () => {
      document.getElementById('profileEditBox').classList.toggle('show');
    });
  }

  const cancelEditProfileBtn = document.getElementById('cancelEditProfileBtn');
  if (cancelEditProfileBtn) {
    cancelEditProfileBtn.addEventListener('click', () => {
      document.getElementById('profileEditBox').classList.remove('show');
    });
  }

  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfileChanges);

  // Wire Action Dropdown Menu (Add Wine, Recommend a Wine, Scan Barcode)
  const actionDropdownBtn = document.getElementById('actionDropdownBtn');
  const actionDropdownMenu = document.getElementById('actionDropdownMenu');

  function closeActionDropdown() {
    if (actionDropdownMenu) actionDropdownMenu.classList.remove('show');
    if (actionDropdownBtn) {
      actionDropdownBtn.setAttribute('aria-expanded', 'false');
      actionDropdownBtn.classList.remove('active');
    }
  }

  if (actionDropdownBtn && actionDropdownMenu) {
    actionDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = actionDropdownMenu.classList.toggle('show');
      actionDropdownBtn.setAttribute('aria-expanded', isOpen);
      actionDropdownBtn.classList.toggle('active', isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!actionDropdownMenu.contains(e.target) && !actionDropdownBtn.contains(e.target)) {
        closeActionDropdown();
      }
    });
  }

  // Wire Recommend Wine Modal controls
  const openRecommendWineBtn = document.getElementById('openRecommendWineBtn');
  if (openRecommendWineBtn) {
    openRecommendWineBtn.addEventListener('click', () => {
      closeActionDropdown();
      openRecommendModal();
    });
  }

  const closeRecommendWineBtn = document.getElementById('closeRecommendWineBtn');
  if (closeRecommendWineBtn) closeRecommendWineBtn.addEventListener('click', closeRecommendModal);

  const cancelRecommendBtn = document.getElementById('cancelRecommendBtn');
  if (cancelRecommendBtn) cancelRecommendBtn.addEventListener('click', closeRecommendModal);

  const submitRecommendBtn = document.getElementById('submitRecommendBtn');
  if (submitRecommendBtn) submitRecommendBtn.addEventListener('click', handleRecommendSubmit);

  const recTryAnotherBtn = document.getElementById('recTryAnotherBtn');
  if (recTryAnotherBtn) {
    recTryAnotherBtn.addEventListener('click', () => {
      const formView = document.getElementById('recommendFormView');
      const resultView = document.getElementById('recommendResultView');
      if (formView) formView.style.display = 'block';
      if (resultView) resultView.style.display = 'none';
    });
  }

  const recViewDetailsBtn = document.getElementById('recViewDetailsBtn');
  if (recViewDetailsBtn) {
    recViewDetailsBtn.addEventListener('click', () => {
      if (currentRecommendedWineId) {
        closeRecommendModal();
        openOverview(currentRecommendedWineId);
      }
    });
  }

  const recDoneBtn = document.getElementById('recDoneBtn');
  if (recDoneBtn) recDoneBtn.addEventListener('click', closeRecommendModal);

  // Chips in Recommend modal
  document.querySelectorAll('#recFoodChips .select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
    });
  });

  document.querySelectorAll('#recOccasionChips .select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#recOccasionChips .select-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  // Wire Add Wine Button
  const openAddWineBtnHero = document.getElementById('openAddWineBtnHero');
  if (openAddWineBtnHero) {
    openAddWineBtnHero.addEventListener('click', () => {
      closeActionDropdown();
      openAddWineModal();
    });
  }

  const closeAddWineBtn = document.getElementById('closeAddWineBtn');
  if (closeAddWineBtn) closeAddWineBtn.addEventListener('click', closeAddWineModal);

  const cancelAddWineBtn = document.getElementById('cancelAddWineBtn');
  if (cancelAddWineBtn) cancelAddWineBtn.addEventListener('click', closeAddWineModal);

  // Wire Barcode Scanner controls
  const scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
  if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', openScannerModal);

  const openScanBtnHero = document.getElementById('openScanBtnHero');
  if (openScanBtnHero) {
    openScanBtnHero.addEventListener('click', () => {
      closeActionDropdown();
      openScannerModal();
    });
  }

  const closeScannerModalBtn = document.getElementById('closeScannerModalBtn');
  if (closeScannerModalBtn) closeScannerModalBtn.addEventListener('click', closeScannerModal);

  const cancelScannerBtn = document.getElementById('cancelScannerBtn');
  if (cancelScannerBtn) cancelScannerBtn.addEventListener('click', closeScannerModal);

  const triggerUploadFallbackBtn = document.getElementById('triggerUploadFallbackBtn');
  const barcodeFileInput = document.getElementById('barcodeFileInput');
  if (triggerUploadFallbackBtn && barcodeFileInput) {
    triggerUploadFallbackBtn.addEventListener('click', () => barcodeFileInput.click());
  }

  const barcodeUploadBtn = document.getElementById('barcodeUploadBtn');
  if (barcodeUploadBtn && barcodeFileInput) {
    barcodeUploadBtn.addEventListener('click', () => barcodeFileInput.click());
  }

  if (barcodeFileInput) {
    barcodeFileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        try {
          if (!html5QrCodeScanner) {
            html5QrCodeScanner = new Html5Qrcode("barcodeReader", { verbose: false });
          }
          const decodedText = await html5QrCodeScanner.scanFile(file, true);
          await onBarcodeScanSuccess(decodedText);
        } catch (scanErr) {
          showToast("No readable barcode found in image. Please try another photo.");
        }
      }
    });
  }

  const barcodeScannerModal = document.getElementById('barcodeScannerModal');
  if (barcodeScannerModal) {
    barcodeScannerModal.addEventListener('click', (e) => {
      if (e.target.id === 'barcodeScannerModal') closeScannerModal();
    });
  }

  const addWineForm = document.getElementById('addWineForm');
  if (addWineForm) addWineForm.addEventListener('submit', handleAddWineSubmit);

  // Wire Overview Modal controls
  const closeOverviewBtn = document.getElementById('closeOverviewBtn');
  if (closeOverviewBtn) closeOverviewBtn.addEventListener('click', closeOverview);

  const doneOverviewBtn = document.getElementById('doneOverviewBtn');
  if (doneOverviewBtn) doneOverviewBtn.addEventListener('click', closeOverview);

  const modalIncBtn = document.getElementById('modalIncBtn');
  if (modalIncBtn) modalIncBtn.addEventListener('click', () => adjustWineQty(1));

  const modalDecBtn = document.getElementById('modalDecBtn');
  if (modalDecBtn) modalDecBtn.addEventListener('click', () => adjustWineQty(-1));

  const uncorkBottleBtn = document.getElementById('uncorkBottleBtn');
  if (uncorkBottleBtn) uncorkBottleBtn.addEventListener('click', () => adjustWineQty(-1));

  const deleteWineBtn = document.getElementById('deleteWineBtn');
  if (deleteWineBtn) deleteWineBtn.addEventListener('click', deleteActiveWine);

  // Close on backdrop click
  const overviewModal = document.getElementById('overviewModal');
  if (overviewModal) {
    overviewModal.addEventListener('click', (e) => {
      if (e.target.id === 'overviewModal') closeOverview();
    });
  }

  const addWineModal = document.getElementById('addWineModal');
  if (addWineModal) {
    addWineModal.addEventListener('click', (e) => {
      if (e.target.id === 'addWineModal') closeAddWineModal();
    });
  }

  const profileModal = document.getElementById('profileModal');
  if (profileModal) {
    profileModal.addEventListener('click', (e) => {
      if (e.target.id === 'profileModal') closeProfileModal();
    });
  }

  const recommendWineModal = document.getElementById('recommendWineModal');
  if (recommendWineModal) {
    recommendWineModal.addEventListener('click', (e) => {
      if (e.target.id === 'recommendWineModal') closeRecommendModal();
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOverview();
      closeAddWineModal();
      closeProfileModal();
      closeRecommendModal();
      closeScannerModal();
      closeActionDropdown();

      const sortMenu = document.getElementById('sortDropdownMenu');
      const sortBtn = document.getElementById('sortByBtn');
      if (sortMenu) sortMenu.classList.remove('show');
      if (sortBtn) {
        sortBtn.setAttribute('aria-expanded', 'false');
        sortBtn.classList.remove('active');
      }

      const filterMenu = document.getElementById('filterDropdownMenu');
      const filterBtn = document.getElementById('filterByTypeBtn');
      if (filterMenu) filterMenu.classList.remove('show');
      if (filterBtn) {
        filterBtn.setAttribute('aria-expanded', 'false');
        filterBtn.classList.remove('active');
      }
    }
  });

  // Load initial user session
  (function initUserSession() {
    try {
      const user = getUserSession();
      if (user) {
        const nameEl = document.getElementById('heroUserName');
        const emailEl = document.getElementById('heroUserEmail');
        const avatarEl = document.getElementById('heroAvatar');

        if (user.username && nameEl) {
          nameEl.textContent = user.username;
          const parts = user.username.trim().split(/\s+/);
          let initials = 'LR';
          if (parts.length >= 2) {
            initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
          } else if (parts.length === 1 && parts[0].length >= 1) {
            initials = parts[0].substring(0, 2).toUpperCase();
          }
          if (avatarEl) avatarEl.textContent = initials;
        }

        if (user.email && emailEl) {
          emailEl.textContent = user.email;
        }
      }
    } catch (err) {
      console.warn('Session load error:', err);
    }
  })();
});
