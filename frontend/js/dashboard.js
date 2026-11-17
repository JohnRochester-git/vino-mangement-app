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
let currentUser = null;      // from GET /auth/me
let collectionId = null;     // the user's first collection
let currentMemberRole = 'owner'; // 'owner' or 'member'
let currentScannedWineId = null; // if scanned wine is already in catalog
let currentScannedWineName = null;
let serverValueCents = null; // collection total from GET /collections/{id}/value
let blendOptions = [];       // [{blendID, blendStyle}] from GET /blends
let qtyRequestInFlight = false;

// Drinking-window choices in the Add Wine form, as years from today.
// "Estimate" sends no dates, so the server estimates from type and vintage.
const DRINK_WINDOW_OFFSETS = {
  'Ready to Enjoy': { fromYears: 0, byYears: 3 },
  'Peak Maturity': { fromYears: 0, byYears: 1 },
  'Aging Gracefully': { fromYears: 0, byYears: 8 },
  'Cellar Candidate': { fromYears: 3, byYears: 15 }
};

// Which Add Wine input shows each API field's error.
const FIELD_INPUTS = {
  'wine.wineName': 'inputName',
  'wine.wineType': 'inputType',
  'wine.blendID': 'inputVarietal',
  'wine.wineRegion': 'inputRegion',
  'wine.wineVint': 'inputVintage',
  'wine.wineValue': 'inputPrice',
  'wine.wineBarcode': 'inputBarcode',
  'wineBarcode': 'inputBarcode',
  'itemQuantity': 'inputQty',
  'wine.wineDescription': 'inputNotes',
  'itemDrinkFrom': 'inputMaturity',
  'itemDrinkBy': 'inputMaturity'
};

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
  // The server's total is authoritative; fall back to the local sum until it arrives.
  const totalValue = serverValueCents !== null ? serverValueCents / 100 : stats.totalValue;
  if (valueEl) valueEl.textContent = `$${totalValue.toLocaleString()}`;
  if (oldestEl) oldestEl.textContent = stats.oldestVintage;
}

// Fetches the collection total from the server, then redraws the stats bar.
async function refreshServerValue() {
  try {
    const value = await getValue(collectionId);
    serverValueCents = value.totalValueCents;
  } catch (err) {
    serverValueCents = null;
  }
  updateStats();
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

  // Labels from the server's drinkStatus (see MATURITY_LABELS in storage.js)
  if (lower.includes('past peak')) {
    return {
      cssClass: 'maturity-peak',
      label: 'Past Peak',
      title: 'Past Peak — Past its drinking window; open it soon',
      iconHtml: '<span class="maturity-pulse-dot"></span>'
    };
  }
  if (lower.includes('drink soon')) {
    return {
      cssClass: 'maturity-peak',
      label: 'Drink Soon',
      title: 'Drink Soon — Near the end of its drinking window',
      iconHtml: '<span class="maturity-pulse-dot"></span>'
    };
  }
  if (lower.includes('no drinking window')) {
    return {
      cssClass: 'maturity-aging',
      label: 'No Window Set',
      title: 'No drinking window saved for this wine',
      iconHtml: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };
  }

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
  changeWineQty(wineId, delta);
}
window.quickAdjustWineQty = quickAdjustWineQty;

// ----------------------------------------------------
// SINGLE BOTTLE CARD HTML BUILDER
// ----------------------------------------------------
function buildBottleCardHtml(w) {
  const typeClass = (w.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ageStr = getWineAge(w.vintage);
  const pairingsMini = (w.pairings || []).slice(0, 3).map(p => `<span class="pair-pill-mini">${escapeHtml(p)}</span>`).join('');
  const worthFormatted = formatPrice(w.price);
  const qty = Number(w.quantity) || 0;
  const mat = getMaturityBadgeInfo(w.maturity);

  return `
  <div class="bottle-card" onclick="openOverview(${Number(w.id)})" title="Click to view full sommelier overview">
    <div class="bottle-image">
      <span class="bottle-tag ${typeClass}">${escapeHtml(w.type)}</span>
      
      <!-- Quick Quantity Stepper (Feature 3) -->
      <div class="card-qty-stepper" onclick="event.stopPropagation();" title="Quick adjust bottle quantity">
        <button type="button" class="card-qty-btn dec" onclick="quickAdjustWineQty(event, ${Number(w.id)}, -1)" aria-label="Uncork 1 bottle" title="Uncork 1 bottle" ${qty <= 0 ? 'disabled' : ''}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <span class="card-qty-num">${qty} ${qty === 1 ? 'bottle' : 'bottles'}</span>
        <button type="button" class="card-qty-btn inc" onclick="quickAdjustWineQty(event, ${Number(w.id)}, 1)" aria-label="Add 1 bottle" title="Add 1 bottle">
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
        <div class="bottle-worth">${worthFormatted}</div>
        <div class="bottle-age">${w.vintage ? `${w.vintage} • ${ageStr}` : 'NV'}</div>
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
        'past peak': 0,
        'drink soon': 1,
        'peak maturity': 1,
        'drink tonight': 1,
        'ready to enjoy': 2,
        'aging gracefully': 3,
        'cellar candidate': 4,
        'keep aging': 4,
        'no drinking window': 5
      };
      // "(est.)" marks a server-estimated window; it sorts the same.
      const key = w => (w.maturity || '').toLowerCase().replace('(est.)', '').trim();
      return sorted.sort((a, b) => {
        const rankA = rank[key(a)] ?? 99;
        const rankB = rank[key(b)] ?? 99;
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
      const regValue = winesInRegion.reduce((sum, w) => w.price === null ? sum : sum + ((Number(w.quantity) || 0) * (Number(w.price) || 0)), 0);

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
// Turns a server journal entry into what the journal card shows.
// Region and grape come from the cellar list, which includes finished bottles.
function toUncorkEntry(c) {
  const wine = cellar.find(w => w.id === c.itemID) || {};
  const when = new Date(c.consumeTime);
  const dateStr = isNaN(when.getTime()) ? '' :
    `${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return {
    name: c.wineName,
    vintage: c.wineVint,
    type: c.wineType,
    region: wine.region || '',
    varietal: wine.varietal || '',
    quantity: c.consumeQuantity,
    note: c.consumeNotes || '',
    dateStr
  };
}

async function renderUncorkHistory() {
  const container = document.getElementById('profileUncorkList');
  const countBadge = document.getElementById('uncorkLogCountBadge');
  const profileBottlesUncorked = document.getElementById('profileBottlesUncorked');
  if (!container) return;

  const profileUncorkBtnBadge = document.getElementById('profileUncorkBtnBadge');
  if (countBadge) countBadge.textContent = '…';
  if (profileBottlesUncorked) profileBottlesUncorked.textContent = '…';
  if (profileUncorkBtnBadge) profileUncorkBtnBadge.textContent = '…';

  let log;
  try {
    const data = await listConsumptions(collectionId);
    log = data.consumptions.map(toUncorkEntry);
  } catch (err) {
    if (countBadge) countBadge.textContent = '—';
    if (profileBottlesUncorked) profileBottlesUncorked.textContent = '—';
    if (profileUncorkBtnBadge) profileUncorkBtnBadge.textContent = '—';
    container.innerHTML = `<div class="uncork-empty-state"><p>The tasting journal couldn't be loaded.</p><span>${escapeHtml(firstErrorMessage(err))}</span></div>`;
    return;
  }
  // An entry can record more than one bottle, so count bottles, not entries.
  const count = log.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

  if (countBadge) countBadge.textContent = `${count} ${count === 1 ? 'bottle enjoyed' : 'bottles enjoyed'}`;
  if (profileBottlesUncorked) profileBottlesUncorked.textContent = `${count} ${count === 1 ? 'bottle enjoyed' : 'bottles enjoyed'}`;
  if (profileUncorkBtnBadge) profileUncorkBtnBadge.textContent = `${count} enjoyed`;

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
              ${entry.quantity > 1 ? `<span class="uncork-vintage">${entry.quantity} bottles</span>` : ''}
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
  const user = currentUser || {};

  document.getElementById('profileModalAvatar').textContent = getInitials(user.userFullname);
  document.getElementById('profileModalName').textContent = user.userFullname || '';
  document.getElementById('profileModalEmail').textContent = user.userEmail || '';

  const stats = calculateCellarStats(cellar);
  const totalValue = serverValueCents !== null ? serverValueCents / 100 : stats.totalValue;
  document.getElementById('profileTotalBottles').textContent = `${stats.totalBottles} ${stats.totalBottles === 1 ? 'Bottle' : 'Bottles'}`;
  document.getElementById('profileDistinctLabels').textContent = `${stats.distinctCount} ${stats.distinctCount === 1 ? 'Wine' : 'Wines'}`;
  document.getElementById('profileCollectionWorth').textContent = `$${totalValue.toLocaleString()}`;

  // App Tenure
  const tenure = getAppTenureDetails(user.userCreatedAt);
  document.getElementById('profileTenureYears').textContent = tenure.tenureString;
  document.getElementById('profileMemberSinceSub').textContent = tenure.memberSinceString;

  // Top Region Calculation
  const regionCounts = {};
  cellar.forEach(w => {
    const r = w.region || 'Other';
    regionCounts[r] = (regionCounts[r] || 0) + (Number(w.quantity) || 0);
  });
  let topRegionName = null;
  let maxCount = 0;
  for (const [r, count] of Object.entries(regionCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topRegionName = r;
    }
  }
  document.getElementById('profileTopRegion').textContent = topRegionName ? `${topRegionName} (${maxCount} bottles)` : '—';

  // Crown Jewel (highest valued bottle; wines without a value are skipped)
  let crownJewel = null;
  let maxPrice = -1;
  cellar.forEach(w => {
    if (w.price !== null && Number(w.price) > maxPrice) {
      maxPrice = Number(w.price);
      crownJewel = w;
    }
  });
  if (crownJewel) {
    document.getElementById('profileCrownJewel').textContent = `${crownJewel.name} (${formatPrice(crownJewel.price)})`;
  } else {
    document.getElementById('profileCrownJewel').textContent = '—';
  }

  // Oldest vintage
  if (stats.oldestVintage !== '—') {
    const age = new Date().getFullYear() - stats.oldestVintage;
    document.getElementById('profileOldestVintage').textContent = `${stats.oldestVintage} Vintage (${age} Years Old)`;
  } else {
    document.getElementById('profileOldestVintage').textContent = '—';
  }

  // Bottles enjoyed and the tasting journal, from the server
  renderUncorkHistory();
  renderHouseholdMembers();

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

// ----------------------------------------------------
// RECENTLY UNCORKED JOURNAL MODAL
// ----------------------------------------------------
function openUncorkJournalModal() {
  const modal = document.getElementById('uncorkJournalModal');
  if (!modal) return;
  renderUncorkHistory();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeUncorkJournalModal() {
  const modal = document.getElementById('uncorkJournalModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ----------------------------------------------------
// HOUSEHOLD & CELLAR SHARING MODAL
// ----------------------------------------------------
function openHouseholdModal() {
  const modal = document.getElementById('householdModal');
  if (!modal) return;
  renderHouseholdMembers();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeHouseholdModal() {
  const modal = document.getElementById('householdModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
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
  const qtyNum = Number(wine.quantity) || 0;
  const isValued = wine.price !== null;
  const totalWorth = isValued ? Number(wine.price) * qtyNum : null;

  // Header tags
  const tagEl = document.getElementById('modalWineTypeTag');
  tagEl.className = 'bottle-tag ' + typeClass;
  tagEl.textContent = wine.type;

  document.getElementById('modalAgeBadge').textContent = age;
  document.getElementById('modalMaturityBadge').textContent = wine.maturity;

  // Hero title & region
  document.getElementById('modalWineTitle').textContent = wine.name;
  document.getElementById('modalRegionText').textContent = wine.region;
  document.getElementById('modalVarietalPill').textContent = wine.varietal || (wine.type + ' Wine');

  // 4 Key Stats
  document.getElementById('modalTypeVal').textContent = `${wine.type} Wine`;
  document.getElementById('modalVarietalSub').textContent = wine.varietal || 'Single Varietal / Blend';

  if (isValued) {
    document.getElementById('modalWorthVal').innerHTML = `${escapeHtml(formatPrice(wine.price))} <span style="font-size: 13px; font-family:'Inter'; color:var(--text-muted);">/ bottle</span>`;
    document.getElementById('modalTotalWorthSub').textContent = `Collection Lot: ${formatPrice(totalWorth)} total`;
  } else {
    document.getElementById('modalWorthVal').textContent = 'Not valued';
    document.getElementById('modalTotalWorthSub').textContent = 'No value recorded yet';
  }

  if (wine.vintage) {
    document.getElementById('modalVintageVal').textContent = `${wine.vintage} Vintage`;
    document.getElementById('modalAgeSub').textContent = `${age} (${currentYear - wine.vintage} yrs of cellaring)`;
  } else {
    document.getElementById('modalVintageVal').textContent = 'NV';
    document.getElementById('modalAgeSub').textContent = 'Non-vintage blend';
  }

  document.getElementById('modalQtyVal').textContent = qtyNum;
  document.getElementById('modalStockStatus').textContent = qtyNum > 0 ? `${qtyNum} In Cellar` : 'Depleted';
  document.getElementById('modalQtySub').textContent = qtyNum === 1 ? '1 bottle remaining' : `${qtyNum} bottles in collection`;

  // Food Pairings
  const pairContainer = document.getElementById('modalPairChips');
  if (wine.pairings && wine.pairings.length > 0) {
    pairContainer.innerHTML = wine.pairings.map(p => `<span class="pair-badge">${escapeHtml(p)}</span>`).join('');
  } else {
    pairContainer.innerHTML = '<span class="pair-badge">No pairings saved</span>';
  }

  const pairGuide = wine.pairingGuide || (wine.pairings.length > 0
    ? `Pairs wonderfully with dishes harmonizing with ${wine.type.toLowerCase()} wine profiles, particularly ${wine.pairings.join(', ')}.`
    : 'No pairing guide saved yet.');
  document.getElementById('modalPairGuide').textContent = pairGuide;

  // Tasting Notes
  document.getElementById('modalNotesQuote').textContent = wine.notes ? `"${wine.notes}"` : 'No tasting notes yet.';

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

// Replaces one wine in the local list with the server's updated item.
function replaceWineFromItem(item) {
  const updated = toCellarWine(item);
  const index = cellar.findIndex(w => w.id === updated.id);
  if (index >= 0) cellar[index] = updated;
  return updated;
}

function setQtyButtonsDisabled(disabled) {
  ['modalIncBtn', 'modalDecBtn', 'uncorkBottleBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// Adjust quantity from inside overview.
function adjustWineQty(delta) {
  if (!activeWineId) return;
  return changeWineQty(activeWineId, delta);
}

// Changes a wine's bottle count on the server.
// −1 records a bottle drunk in the cellar journal; +1 adds a bottle.
async function changeWineQty(wineId, delta) {
  if (qtyRequestInFlight) return;
  const wine = cellar.find(w => w.id === wineId);
  if (!wine) return;
  if (delta < 0 && (Number(wine.quantity) || 0) <= 0) {
    showToast(`"${wine.name}" is already depleted`);
    return;
  }

  qtyRequestInFlight = true;
  setQtyButtonsDisabled(true);
  try {
    let updated;
    if (delta < 0) {
      const result = await consumeItem(wine.id, 1);
      updated = replaceWineFromItem(result.item);
    } else {
      updated = replaceWineFromItem(await updateItem(wine.id, { itemQuantity: (Number(wine.quantity) || 0) + 1 }));
    }

    updateStats();
    renderMain();
    if (activeWineId === updated.id) openOverview(updated.id);
    refreshServerValue();

    if (delta < 0 && updated.quantity === 0) {
      showToast(`Finished last bottle of ${updated.name}`);
    } else if (delta < 0) {
      showToast(`Enjoy the bottle! ${updated.quantity} bottle(s) remaining.`);
    } else {
      showToast(`Added 1 bottle of ${updated.name} (Now ${updated.quantity})`);
    }
  } catch (err) {
    showToast(firstErrorMessage(err));
  } finally {
    qtyRequestInFlight = false;
    setQtyButtonsDisabled(false);
  }
}

async function deleteActiveWine() {
  if (!activeWineId) return;
  const wine = cellar.find(w => w.id === activeWineId);
  if (!wine) return;

  if (confirm(`Are you sure you want to remove "${wine.name}" from your cellar collection?`)) {
    try {
      await deleteItem(wine.id);
    } catch (err) {
      showToast(firstErrorMessage(err));
      return;
    }
    cellar = cellar.filter(w => w.id !== wine.id);
    updateStats();
    updateRegionFilterChips();
    renderMain();
    closeOverview();
    refreshServerValue();
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
  const promptEl = document.getElementById('scannerFallbackPrompt');

  if (typeof Html5Qrcode === 'undefined') {
    if (statusLabel) statusLabel.textContent = 'Scanner library loading or unavailable.';
    if (fallbackBox) fallbackBox.style.display = 'block';
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // iPhone Safari completely forbids WebRTC getUserMedia on insecure HTTP (e.g. 192.168.x.x)
  if (!isSecure && isIOS) {
    if (statusLabel) statusLabel.textContent = 'iPhone requires HTTPS for live video streaming.';
    if (fallbackBox) {
      fallbackBox.style.display = 'block';
      if (promptEl) {
        promptEl.innerHTML = '<strong>Live video stream requires HTTPS on iPhone.</strong><br>Tap below to take a photo directly with your iPhone camera:';
      }
    }
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
    if (fallbackBox) fallbackBox.style.display = 'none';
  } catch (err) {
    console.warn("Camera start failed:", err);
    isScannerRunning = false;
    if (statusLabel) {
      statusLabel.textContent = 'Camera access denied or unavailable.';
    }
    if (fallbackBox) {
      fallbackBox.style.display = 'block';
      if (promptEl) {
        if (!isSecure) {
          promptEl.innerHTML = '<strong>Live video requires HTTPS on iPhone.</strong><br>Tap below to snap a photo with your iPhone camera:';
        } else if (isIOS) {
          promptEl.innerHTML = '<strong>Camera permission denied in Safari.</strong><br>To allow: tap <em>"aA"</em> in the address bar → <em>Website Settings</em> → <em>Camera</em> → <em>Allow</em>.<br>Or tap below to snap a photo:';
        } else {
          promptEl.textContent = 'Camera permission was denied. You can snap a photo directly using the button below:';
        }
      }
    }
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
  currentScannedWineId = null;
  currentScannedWineName = null;

  const barcodeInput = document.getElementById('inputBarcode');
  if (barcodeInput) barcodeInput.value = cleanBarcode;

  try {
    const res = await lookupBarcode(cleanBarcode);
    if (res && res.found && res.wine) {
      const w = res.wine;
      const nameInput = document.getElementById('inputName');
      const typeSelect = document.getElementById('inputType');
      const regionInput = document.getElementById('inputRegion');
      const varietalInput = document.getElementById('inputVarietal');
      const vintageInput = document.getElementById('inputVintage');
      const priceInput = document.getElementById('inputPrice');
      const notesInput = document.getElementById('inputNotes');

      if (nameInput && w.wineName) nameInput.value = w.wineName;
      if (typeSelect && w.wineType) typeSelect.value = w.wineType;
      if (regionInput && w.wineRegion) regionInput.value = w.wineRegion;
      if (varietalInput && (w.blendStyle || w.varietal)) varietalInput.value = w.blendStyle || w.varietal;
      if (vintageInput && w.wineVint) vintageInput.value = w.wineVint;
      if (priceInput && (w.wineValueCents !== undefined || w.wineValue !== undefined)) {
        if (w.wineValueCents !== null && w.wineValueCents !== undefined) {
          priceInput.value = (w.wineValueCents / 100).toFixed(2);
        } else if (w.wineValue) {
          priceInput.value = w.wineValue;
        }
      }
      if (notesInput && (w.wineDescription || w.wineProfile)) {
        notesInput.value = w.wineDescription || w.wineProfile;
      }

      // Select pairings chips if returned from catalog
      if (Array.isArray(w.pairings) && w.pairings.length > 0) {
        document.querySelectorAll('#formPairChips .select-chip').forEach(chip => {
          const val = chip.getAttribute('data-val');
          if (w.pairings.some(p => p.toLowerCase() === val.toLowerCase())) {
            chip.classList.add('selected');
          }
        });
      }

      if (res.source === 'catalog') {
        currentScannedWineId = w.wineID;
        currentScannedWineName = w.wineName;
        showToast(`✓ Found "${w.wineName}" in Vino catalog!`);
      } else {
        showToast(`✓ Found in wine database! Please confirm details.`);
      }

      if (priceInput && !priceInput.value) priceInput.focus();
    } else {
      showToast(`No product found for barcode (${cleanBarcode}). Please enter details manually.`);
      const nameInput = document.getElementById('inputName');
      if (nameInput) nameInput.focus();
    }
  } catch (err) {
    console.error("Barcode lookup failed:", err);
    showToast(`Barcode lookup: ${firstErrorMessage(err)}. Please enter wine details manually.`);
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
  currentScannedWineId = null;
  currentScannedWineName = null;
  clearAddWineFieldErrors();
  document.querySelectorAll('#formPairChips .select-chip').forEach(c => c.classList.remove('selected'));
}

function clearAddWineFieldErrors() {
  document.querySelectorAll('#addWineForm input, #addWineForm select, #addWineForm textarea')
    .forEach(el => el.setCustomValidity(''));
}

// Shows a message on an Add Wine input using the browser's own validation bubble.
function showFieldError(inputId, message) {
  const el = document.getElementById(inputId);
  if (!el) return false;
  el.setCustomValidity(message);
  el.reportValidity();
  return true;
}

function isoDateYearsFromToday(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function handleAddWineSubmit(e) {
  e.preventDefault();
  clearAddWineFieldErrors();

  const name = document.getElementById('inputName').value.trim();
  const type = document.getElementById('inputType').value;
  const varietal = document.getElementById('inputVarietal').value.trim();
  const region = document.getElementById('inputRegion').value.trim();
  const vintageText = document.getElementById('inputVintage').value.trim();
  const priceText = document.getElementById('inputPrice').value.trim();
  const quantity = parseInt(document.getElementById('inputQty').value, 10);
  const maturity = document.getElementById('inputMaturity').value;
  const notes = document.getElementById('inputNotes').value.trim();
  const barcodeVal = document.getElementById('inputBarcode') ? document.getElementById('inputBarcode').value.trim() : '';

  // Grape must be one of the server's blends (or left blank)
  let blendID = null;
  if (varietal) {
    const match = blendOptions.find(b => b.blendStyle.toLowerCase() === varietal.toLowerCase());
    if (!match) {
      showFieldError('inputVarietal', 'Please pick a grape from the list, or leave it blank.');
      return;
    }
    blendID = match.blendID;
  }

  // Selected pairing chips (exact server names)
  const selectedPairings = Array.from(document.querySelectorAll('#formPairChips .select-chip.selected'))
    .map(chip => chip.getAttribute('data-val'));

  let body;
  // If the scanned wine is already in the catalog and user kept the catalog name:
  if (currentScannedWineId && name.toLowerCase() === (currentScannedWineName || '').toLowerCase()) {
    body = {
      wineId: currentScannedWineId,
      itemQuantity: isNaN(quantity) ? null : quantity
    };
  } else {
    body = {
      itemQuantity: isNaN(quantity) ? null : quantity,
      wine: {
        wineName: name,
        wineType: type,
        wineRegion: region || null,
        wineVint: vintageText === '' ? null : Number(vintageText),
        wineValue: priceText === '' ? null : priceText,
        wineDescription: notes || null,
        wineBarcode: barcodeVal || null,
        blendID,
        pairings: selectedPairings
      }
    };
  }

  const offsets = DRINK_WINDOW_OFFSETS[maturity];
  if (offsets) {
    body.itemDrinkFrom = isoDateYearsFromToday(offsets.fromYears);
    body.itemDrinkBy = isoDateYearsFromToday(offsets.byYears);
  }

  const submitBtn = document.querySelector('#addWineForm button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const item = await addItem(collectionId, body);
    const newWine = toCellarWine(item);
    cellar.unshift(newWine);
    updateStats();
    updateRegionFilterChips();
    renderMain();
    closeAddWineModal();
    refreshServerValue();
    showToast(`✓ Added "${newWine.name}" to your cellar!`);
  } catch (err) {
    // Keep the modal open with the user's input; point at the first bad field.
    let shown = false;
    if (err.fields) {
      for (const [field, message] of Object.entries(err.fields)) {
        if (FIELD_INPUTS[field] && showFieldError(FIELD_INPUTS[field], message)) {
          shown = true;
          break;
        }
      }
    }
    showToast(firstErrorMessage(err));
    if (!shown) document.getElementById('inputName').focus();
  } finally {
    submitBtn.disabled = false;
  }
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

  document.querySelectorAll('#recTypeChips .select-chip').forEach(c => {
    if (c.getAttribute('data-val') === 'Any') {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  document.querySelectorAll('#recTierChips .select-chip').forEach(c => {
    if (c.getAttribute('data-val') === 'Any') {
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

// True when the server says this wine should be drunk now or soon.
function isDrinkNow(w) {
  const status = w._item ? w._item.drinkStatus : null;
  return status === 'ready' || status === 'drinkSoon' || status === 'pastPeak';
}

// Serving & Decanting Advice (Update 3: Virtual Sommelier)
function getServingAndDecantAdvice(wine) {
  if (!wine) {
    return {
      temp: '60–65°F (Room Temp)',
      decant: 'Pop & Pour',
      glass: 'Standard Wine Glass',
      tip: 'Serve at comfortable cellar room temperature.'
    };
  }

  const type = (wine.type || '').toLowerCase();
  const varietal = (wine.varietal || '').toLowerCase();
  const currentYear = new Date().getFullYear();
  const vintage = Number(wine.vintage) || currentYear;
  const age = Math.max(0, currentYear - vintage);

  if (type.includes('sparkling') || type.includes('champagne') || varietal.includes('prosecco') || varietal.includes('cava')) {
    return {
      temp: '42–46°F (Well Chilled)',
      decant: 'No Decanting',
      glass: 'Flute or Tulip / White Stem',
      tip: 'Chill thoroughly; pop gently at a 45° angle to preserve the delicate mousse and effervescence.'
    };
  }

  if (type.includes('rosé') || type.includes('rose')) {
    return {
      temp: '46–50°F (Chilled)',
      decant: 'Pop & Pour',
      glass: 'White or Rosé Stem',
      tip: 'Serve fresh and cool to accentuate bright red berry fruit and crisp acidity.'
    };
  }

  if (type.includes('white')) {
    const isRichWhite = varietal.includes('chardonnay') || varietal.includes('viognier') || varietal.includes('roussanne') || varietal.includes('semillon');
    if (isRichWhite) {
      return {
        temp: '50–54°F (Lightly Chilled)',
        decant: '15 Mins (Optional)',
        glass: 'Wide-Bowl Montrachet',
        tip: 'Allow slight cellar warmth so toasted oak, stone fruit, and buttery aromatics can fully express.'
      };
    }
    return {
      temp: '45–49°F (Chilled)',
      decant: 'Pop & Pour',
      glass: 'Standard White Stem',
      tip: 'Serve chilled to maintain vibrant citrus clarity and crisp mineral backbone.'
    };
  }

  if (type.includes('dessert') || type.includes('port') || type.includes('sherry') || varietal.includes('ice wine') || varietal.includes('sauternes')) {
    return {
      temp: type.includes('port') ? '60–64°F (Cellar Temp)' : '48–52°F (Chilled)',
      decant: 'Pop & Pour',
      glass: 'Dessert / Port Stem',
      tip: 'Serve in tapered dessert stems to concentrate rich honeyed and dried fruit nuances.'
    };
  }

  // Red Wines
  if (age >= 10 || vintage <= 2016) {
    return {
      temp: '62–66°F (Cellar Ambient)',
      decant: '30–45 Mins (Gentle)',
      glass: 'Grand Cru / Bordeaux',
      tip: 'Decant gently against a light source to leave sediment behind while letting delicate tertiary notes awaken.'
    };
  }

  const isBoldRed = varietal.includes('cabernet') || varietal.includes('syrah') || varietal.includes('shiraz') ||
                    varietal.includes('nebbiolo') || varietal.includes('barolo') || varietal.includes('malbec') ||
                    varietal.includes('bordeaux') || varietal.includes('zinfandel') || varietal.includes('tempranillo');

  if (isBoldRed) {
    return {
      temp: '60–65°F (Cool Cellar)',
      decant: '45–60 Mins',
      glass: 'Bordeaux Stem',
      tip: 'A vigorous decant softens firm young tannins and allows opulent cassis and dark fruit layers to unfold.'
    };
  }

  const isLightRed = varietal.includes('pinot') || varietal.includes('gamay') || varietal.includes('grenache') || varietal.includes('beaujolais');
  if (isLightRed) {
    return {
      temp: '56–60°F (Slight Cellar Chill)',
      decant: '15–20 Mins',
      glass: 'Burgundy Balloon Stem',
      tip: 'Serve with a gentle cellar chill in a wide balloon bowl to highlight delicate floral and red cherry perfumes.'
    };
  }

  // Standard / Medium Red (Merlot, blends)
  return {
    temp: '60–64°F (Cellar Room Temp)',
    decant: '20–30 Mins',
    glass: 'Standard Red Stem',
    tip: 'A 20-minute decant rounds out the alcohol and releases rounded plum, herbal, and vanilla notes.'
  };
}

function calculateWineRecommendation(mealText, foodCategories, occasion, typePref = 'Any', tierPref = 'Any') {
  // Only recommend bottles still in the cellar (the list includes finished ones).
  const available = (cellar || []).filter(w => (Number(w.quantity) || 0) > 0);
  if (available.length === 0) return null;

  const lowerMeal = (mealText || '').toLowerCase();

  const scored = available.map(w => {
    let score = 25; // baseline
    const winePairings = (w.pairings || []).map(p => p.toLowerCase());
    const wineType = (w.type || '').toLowerCase();

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
      if (w.price !== null && w.price >= 150) score += 25;
      if (w.vintage && w.vintage <= 2015) score += 15;
    } else if (occasion.includes('Romantic')) {
      if (w.type === 'Red' || w.type === 'Sparkling') score += 20;
      if (isDrinkNow(w)) score += 15;
    } else if (occasion.includes('Casual')) {
      if (w.price !== null && w.price <= 50) score += 25;
      if (isDrinkNow(w)) score += 15;
    } else if (occasion.includes('Dinner Party')) {
      if (w.quantity >= 2) score += 20;
    }

    // 4. Wine Style Preference (Update 4)
    if (typePref && typePref !== 'Any') {
      const cleanPref = typePref.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const cleanType = wineType.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (cleanType.includes(cleanPref) || cleanPref.includes(cleanType)) {
        score += 80;
      } else {
        score -= 50;
      }
    }

    // 5. Cellar Tier Preference (Update 4)
    const currentPrice = Number(w.price) || 0;
    const currentYear = new Date().getFullYear();
    const wineAge = w.vintage ? currentYear - Number(w.vintage) : 0;
    if (tierPref === 'Casual') {
      if (currentPrice > 0 && currentPrice <= 65) score += 50;
      else if (currentPrice > 120) score -= 35;
    } else if (tierPref === 'Reserve') {
      if (currentPrice >= 95 || wineAge >= 8) score += 50;
      else if (currentPrice > 0 && currentPrice <= 40) score -= 30;
    }

    // 6. Stock availability bonus
    if (w.quantity > 0) score += 15;

    // 7. Maturity suitability bonus
    if (isDrinkNow(w)) {
      score += 12;
    }

    return { wine: w, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // BUILD THE MATCH TRIO (Update 5)
  // 1. Sommelier Top Pick: highest scoring wine
  const topCandidate = scored[0];
  const topWine = topCandidate.wine;
  const confidence = Math.min(99, Math.max(82, 75 + Math.round(topCandidate.score / 3.2)));

  const trio = [];
  trio.push({
    badge: '🥇 Sommelier Pick',
    roleTitle: 'Sommelier Choice',
    tagline: 'Best pairing chemistry & occasion harmony',
    wine: topWine,
    confidence: confidence
  });

  // Secondary candidates (must be distinct wines)
  const remainingScored = scored.slice(1);

  if (remainingScored.length > 0) {
    // 2. Pick 2: Drink Tonight or Everyday Value Pick
    const drinkNowCandidate = remainingScored.find(s => isDrinkNow(s.wine));
    let secondCandidate = null;
    let secondBadge = '⏳ Drink Tonight';
    let secondTagline = 'Optimal maturity window — uncap tonight';

    if (drinkNowCandidate) {
      secondCandidate = drinkNowCandidate;
    } else {
      const sortedByPrice = [...remainingScored].sort((a, b) => (Number(a.wine.price) || 0) - (Number(b.wine.price) || 0));
      secondCandidate = sortedByPrice[0];
      secondBadge = '💰 Value Pick';
      secondTagline = 'Approachable, food-friendly cellar favorite';
    }

    if (secondCandidate) {
      const secConf = Math.min(96, Math.max(76, 70 + Math.round(secondCandidate.score / 3.5)));
      trio.push({
        badge: secondBadge,
        roleTitle: secondBadge.includes('Drink') ? 'Peak Drink Window' : 'Everyday Value',
        tagline: secondTagline,
        wine: secondCandidate.wine,
        confidence: secConf
      });
    }

    // 3. Pick 3: Cellar Reserve Pick (distinct from pick 1 & pick 2)
    const usedIds = new Set(trio.map(t => t.wine.id));
    const poolForThird = remainingScored.filter(s => !usedIds.has(s.wine.id));

    if (poolForThird.length > 0) {
      const reserveSorted = [...poolForThird].sort((a, b) => {
        const pDiff = (Number(b.wine.price) || 0) - (Number(a.wine.price) || 0);
        if (pDiff !== 0) return pDiff;
        return (Number(a.wine.vintage) || 9999) - (Number(b.wine.vintage) || 9999);
      });

      const thirdCandidate = reserveSorted[0];
      const thirdConf = Math.min(97, Math.max(78, 72 + Math.round(thirdCandidate.score / 3.5)));
      trio.push({
        badge: '🌟 Cellar Reserve',
        roleTitle: 'Cellar Reserve',
        tagline: 'Premium vintage with exceptional depth',
        wine: thirdCandidate.wine,
        confidence: thirdConf
      });
    }
  }

  return {
    trio,
    activeIndex: 0,
    topWine,
    foodCategories,
    occasion,
    mealText,
    typePref,
    tierPref
  };
}

function renderRecommendationResult(data, activeIndex = 0) {
  const container = document.getElementById('recommendResultContent');
  if (!container) return;

  if (!data || !data.trio || data.trio.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px;">
        <h3>No Matching Wines Found</h3>
        <p>Your cellar doesn't have an available bottle right now matching this criteria. Try adjusting your preferences or adding more bottles!</p>
      </div>
    `;
    return;
  }

  data.activeIndex = Math.max(0, Math.min(activeIndex, data.trio.length - 1));
  const activeMatch = data.trio[data.activeIndex];
  const wine = activeMatch.wine;
  currentRecommendedWineId = wine.id;

  const typeClass = (wine.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const qty = Number(wine.quantity) || 0;
  const qtyStr = qty === 1 ? '1 bottle in cellar' : `${qty} bottles in cellar`;
  const rationale = getSommelierRationale(wine, data.foodCategories, data.occasion, data.mealText);
  const service = getServingAndDecantAdvice(wine);

  // Render Trio Nav Tabs (Update 5)
  let trioNavHtml = '';
  if (data.trio.length > 1) {
    trioNavHtml = `
      <div class="rec-trio-nav" role="tablist" aria-label="Sommelier Recommendation Trio">
        ${data.trio.map((item, idx) => {
          const isActive = idx === data.activeIndex;
          const w = item.wine;
          return `
            <button type="button" class="rec-trio-btn ${isActive ? 'active' : ''}" onclick="switchRecommendedTrio(${idx})" role="tab" aria-selected="${isActive}">
              <div class="rec-trio-badge">${item.badge}</div>
              <div class="rec-trio-title">${escapeHtml(w.name)}</div>
              <div class="rec-trio-sub">${formatVintage(w.vintage)} • $${Number(w.price).toLocaleString()}</div>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  container.innerHTML = `
    ${trioNavHtml}

    <div class="rec-match-badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
      </svg>
      ${escapeHtml(activeMatch.roleTitle)} • ${activeMatch.confidence}% Pairing Match
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

    <!-- UPDATE 3: VIRTUAL SOMMELIER SERVICE GUIDE -->
    <div class="rec-service-box">
      <div class="rec-service-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        Virtual Sommelier Service & Decanting Guide
      </div>
      <div class="rec-service-grid">
        <div class="rec-service-item">
          <span class="rec-service-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>
            Serving Temp
          </span>
          <span class="rec-service-val">${escapeHtml(service.temp)}</span>
        </div>
        <div class="rec-service-item">
          <span class="rec-service-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Decanting
          </span>
          <span class="rec-service-val">${escapeHtml(service.decant)}</span>
        </div>
        <div class="rec-service-item">
          <span class="rec-service-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 3h10l-1 8a4 4 0 01-8 0z"/>
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
              <path d="M7 4h10l-2 9a3 3 0 01-6 0z" />
            </svg>
            Glassware
          </span>
          <span class="rec-service-val">${escapeHtml(service.glass)}</span>
        </div>
      </div>
      <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 10px; font-style: italic; line-height: 1.4;">
        💡 ${escapeHtml(service.tip)}
      </div>
    </div>

    <!-- PAIRING RATIONALE -->
    <div class="rec-rationale-box">
      <div class="rec-rationale-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 21h8M12 17v4M7 3h10l-1 8a4 4 0 01-8 0z"/>
        </svg>
        Sommelier Pairing Notes
      </div>
      <p class="rec-rationale-text">${escapeHtml(rationale)}</p>
    </div>
  `;
}

window.switchRecommendedTrio = function(idx) {
  if (!lastRecommendationData || !lastRecommendationData.trio) return;
  renderRecommendationResult(lastRecommendationData, idx);
};

window.switchRecommendedWine = function(wineId) {
  if (!lastRecommendationData || !lastRecommendationData.trio) return;
  const matchIdx = lastRecommendationData.trio.findIndex(t => t.wine.id === wineId);
  if (matchIdx !== -1) {
    renderRecommendationResult(lastRecommendationData, matchIdx);
  }
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

  const typeChip = document.querySelector('#recTypeChips .select-chip.selected');
  const typePref = typeChip ? typeChip.getAttribute('data-val') : 'Any';

  const tierChip = document.querySelector('#recTierChips .select-chip.selected');
  const tierPref = tierChip ? tierChip.getAttribute('data-val') : 'Any';

  if (!mealText && combinedFoods.length === 0) {
    showToast('Please describe your dish or choose a food category.');
    if (mealInput) mealInput.focus();
    return;
  }

  const result = calculateWineRecommendation(mealText, combinedFoods, occasion, typePref, tierPref);
  lastRecommendationData = result;

  renderRecommendationResult(result, 0);

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

  // Add Wine inputs: clear a server error message as soon as the user edits
  document.querySelectorAll('#addWineForm input, #addWineForm select, #addWineForm textarea').forEach(el => {
    el.addEventListener('input', () => el.setCustomValidity(''));
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
// PAIRING CHIPS & GRAPE SUGGESTIONS FROM THE SERVER
// ----------------------------------------------------
// "SpicyFood" or "Spicy Food" -> "Spicy Food"
function friendlyPairingLabel(name) {
  return String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function buildPairingChips(pairings) {
  const names = pairings.map(p => p.pairingName);

  // Filter bar: keep the "All" chip, add one per server pairing
  const filterRow = document.getElementById('pairChipRow');
  if (filterRow) {
    filterRow.innerHTML = `<button type="button" class="chip gold-active" data-pair="All">All</button>` +
      names.map(n => `<button type="button" class="chip" data-pair="${escapeHtml(n)}">${escapeHtml(friendlyPairingLabel(n))}</button>`).join('');
    filterRow.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        filterRow.querySelectorAll('.chip').forEach(c => c.classList.remove('gold-active', 'active'));
        activePairFilter = chip.getAttribute('data-pair');
        chip.classList.add('gold-active');
        updateFilterButtonState();
        renderMain();
      });
    });
  }

  // Add Wine form: toggle chips, sending the exact server name
  const formChips = document.getElementById('formPairChips');
  if (formChips) {
    formChips.innerHTML = names.map(n => `<span class="select-chip" data-val="${escapeHtml(n)}">${escapeHtml(friendlyPairingLabel(n))}</span>`).join('');
    formChips.querySelectorAll('.select-chip').forEach(chip => {
      chip.addEventListener('click', () => chip.classList.toggle('selected'));
    });
  }
}

function buildBlendSuggestions(blends) {
  blendOptions = blends;
  const list = document.getElementById('blendOptions');
  if (list) list.innerHTML = blends.map(b => `<option value="${escapeHtml(b.blendStyle)}"></option>`).join('');
}

// Shows a friendly message in the grid when the cellar can't load.
function showLoadError(message) {
  document.getElementById('gridCountDisplay').textContent = 'Your cellar could not be loaded';
  document.getElementById('bottleGrid').innerHTML = `
    <div class="empty-state">
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message)}</p>
      <button class="btn-ghost" onclick="window.location.reload()">Try Again</button>
    </div>
  `;
}

// Loads the user, their cellar, and reference data from the server.
async function loadDashboardData() {
  try {
    const me = await getMe();
    currentUser = me.user;
    const collection = (me.collections || [])[0];
    if (!collection) {
      showLoadError("You don't have a cellar yet.");
      return;
    }
    collectionId = collection.collectionId;
    currentMemberRole = collection.memberRole || 'owner';
    initUserCard();

    const [itemsData, pairingsData, blendsData] = await Promise.all([
      listItems(collectionId, true),
      getPairings(),
      getBlends()
    ]);
    cellar = itemsData.items.map(toCellarWine);
    buildPairingChips(pairingsData.pairings);
    buildBlendSuggestions(blendsData.blends);

    updateStats();
    updateRegionFilterChips();
    renderMain();
    refreshServerValue();
  } catch (err) {
    showLoadError(err.message || "Can't reach the Vino server. Is the backend running?");
  }
}

// Hero card: name, email, initials
function initUserCard() {
  const nameEl = document.getElementById('heroUserName');
  const emailEl = document.getElementById('heroUserEmail');
  const avatarEl = document.getElementById('heroAvatar');
  if (nameEl) nameEl.textContent = currentUser.userFullname;
  if (emailEl) emailEl.textContent = currentUser.userEmail;
  if (avatarEl) avatarEl.textContent = getInitials(currentUser.userFullname);
}

// Logs out on the server, then goes to the login page even if that failed.
async function signOut(e) {
  e.preventDefault();
  try {
    await logout();
  } catch (err) {
    // Going to the login page anyway; the session expires on its own.
  }
  window.location.href = 'login.html';
}

// ----------------------------------------------------
// HOUSEHOLD MEMBERS (UPDATE 4)
// ----------------------------------------------------
async function renderHouseholdMembers() {
  const container = document.getElementById('householdMembersList');
  const countBadge = document.getElementById('householdCountBadge');
  const inviteForm = document.getElementById('inviteMemberForm');
  if (!container) return;

  const isOwner = currentMemberRole === 'owner';
  if (inviteForm) inviteForm.style.display = isOwner ? 'flex' : 'none';

  try {
    const data = await listMembers(collectionId);
    const members = data.members || [];
    if (countBadge) {
      countBadge.textContent = `${members.length} ${members.length === 1 ? 'Member' : 'Members'}`;
    }
    const profileHouseholdBtnBadge = document.getElementById('profileHouseholdBtnBadge');
    if (profileHouseholdBtnBadge) {
      profileHouseholdBtnBadge.textContent = `${members.length} ${members.length === 1 ? 'Member' : 'Members'}`;
    }

    if (members.length === 0) {
      container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">No members found.</div>`;
      return;
    }

    container.innerHTML = members.map(m => {
      const isThisOwner = m.memberRole === 'owner';
      const initials = getInitials(m.userFullname);
      return `
        <div class="household-member-card">
          <div class="household-member-info">
            <div class="household-member-avatar">${escapeHtml(initials)}</div>
            <div>
              <div class="household-member-name">${escapeHtml(m.userFullname || m.userEmail)}</div>
              <div class="household-member-email">${escapeHtml(m.userEmail)}</div>
            </div>
          </div>
          <div class="household-member-right">
            <span class="household-role-badge ${isThisOwner ? 'owner' : 'member'}">${isThisOwner ? 'Owner' : 'Member'}</span>
            ${isOwner && !isThisOwner ? `
              <button type="button" class="household-remove-btn" onclick="removeHouseholdMember(event, ${Number(m.userID)})" title="Remove member from cellar" aria-label="Remove member">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load members:', err);
    container.innerHTML = `<div style="font-size:12px; color:#ff9999; padding:8px;">Failed to load members: ${escapeHtml(firstErrorMessage(err))}</div>`;
  }
}

async function removeHouseholdMember(event, userId) {
  event.stopPropagation();
  if (!confirm('Are you sure you want to remove this member from the cellar?')) return;
  try {
    await deleteMember(collectionId, userId);
    showToast('Member removed from cellar.');
    await renderHouseholdMembers();
  } catch (err) {
    showToast(`Could not remove member: ${firstErrorMessage(err)}`);
  }
}

async function handleInviteMemberSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('inviteMemberEmail');
  const submitBtn = document.getElementById('inviteMemberBtn');
  if (!emailInput) return;

  const email = emailInput.value.trim().toLowerCase();
  if (!email) return;

  submitBtn.disabled = true;
  try {
    await addMember(collectionId, email);
    showToast(`✓ Added ${email} to cellar!`);
    emailInput.value = '';
    await renderHouseholdMembers();
  } catch (err) {
    if (err.code === 'user_not_found') {
      showToast('No Vino account with that email. Please ask them to sign up first.');
    } else if (err.code === 'already_member') {
      showToast('That user is already a member of this cellar.');
    } else {
      showToast(firstErrorMessage(err));
    }
  } finally {
    submitBtn.disabled = false;
  }
}

// ----------------------------------------------------
// CELLAR WISHLIST (UPDATE 5)
// ----------------------------------------------------
function openWishlistModal() {
  const modal = document.getElementById('wishlistModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  renderWishlist();
}

function closeWishlistModal() {
  const modal = document.getElementById('wishlistModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

async function renderWishlist() {
  const container = document.getElementById('wishlistItemsContainer');
  const countBadge = document.getElementById('wishlistCountBadge');
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">Loading wishlist…</div>`;

  try {
    const data = await listWishlist(collectionId);
    const wishlist = data.wishlist || [];

    if (countBadge) {
      countBadge.textContent = `${wishlist.length} ${wishlist.length === 1 ? 'bottle' : 'bottles'} saved`;
    }

    if (wishlist.length === 0) {
      container.innerHTML = `
        <div class="uncork-empty-state" style="padding:28px 16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dim)" stroke-width="1.5">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <p>Your cellar wishlist is empty</p>
          <span>Track wines you'd love to hunt for, buy, or uncork for future milestones.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = wishlist.map(w => {
      const addedDate = w.wishAddedAt ? new Date(w.wishAddedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return `
        <div class="wishlist-card">
          <div class="wishlist-card-main">
            <div class="wishlist-card-title">
              <span>${escapeHtml(w.wishName)}</span>
              ${w.wishVint ? `<span class="wishlist-vintage-tag">${escapeHtml(w.wishVint)}</span>` : ''}
            </div>
            ${w.wishProducer ? `<div class="wishlist-card-producer">${escapeHtml(w.wishProducer)}</div>` : ''}
            ${w.wishNotes ? `<div class="wishlist-card-notes">${escapeHtml(w.wishNotes)}</div>` : ''}
            <div class="wishlist-card-meta">
              Added ${addedDate ? `on ${addedDate}` : ''} ${w.wishAddedByName ? `by ${escapeHtml(w.wishAddedByName)}` : ''}
            </div>
          </div>
          <button type="button" class="wishlist-delete-btn" onclick="handleDeleteWishlist(event, ${Number(w.wishID)})" title="Remove from wishlist" aria-label="Remove">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load wishlist:', err);
    container.innerHTML = `<div style="color:#ff9999; font-size:12px; padding:12px;">Failed to load wishlist: ${escapeHtml(firstErrorMessage(err))}</div>`;
  }
}

async function handleAddWishlistSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('wishNameInput');
  const vintInput = document.getElementById('wishVintInput');
  const prodInput = document.getElementById('wishProducerInput');
  const notesInput = document.getElementById('wishNotesInput');
  const submitBtn = document.getElementById('submitWishBtn');

  if (!nameInput || !nameInput.value.trim()) return;

  const wishName = nameInput.value.trim();
  const wishVint = vintInput && vintInput.value.trim() ? Number(vintInput.value.trim()) : null;
  const wishProducer = prodInput ? prodInput.value.trim() : null;
  const wishNotes = notesInput ? notesInput.value.trim() : null;

  submitBtn.disabled = true;
  try {
    await addWishlist(collectionId, {
      wishName,
      wishVint,
      wishProducer: wishProducer || null,
      wishNotes: wishNotes || null
    });
    showToast(`✓ Added "${wishName}" to your wishlist!`);
    document.getElementById('addWishlistForm').reset();
    await renderWishlist();
  } catch (err) {
    showToast(`Could not add to wishlist: ${firstErrorMessage(err)}`);
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleDeleteWishlist(event, wishId) {
  event.stopPropagation();
  try {
    await deleteWishlist(wishId);
    showToast('Removed wine from wishlist.');
    await renderWishlist();
  } catch (err) {
    showToast(`Could not remove wish: ${firstErrorMessage(err)}`);
  }
}

// ----------------------------------------------------
// CSV IMPORT & EXPORT (UPDATE 3)
// ----------------------------------------------------
let selectedCsvFile = null;

function openCsvModal() {
  const modal = document.getElementById('csvModal');
  if (!modal) return;

  const downloadBtn = document.getElementById('downloadCsvBtn');
  if (downloadBtn && collectionId) {
    downloadBtn.href = getExportCsvUrl(collectionId);
  }

  // Reset file selection
  selectedCsvFile = null;
  const fileInput = document.getElementById('csvFileInput');
  if (fileInput) fileInput.value = '';
  const fileNameDisplay = document.getElementById('csvSelectedFileName');
  if (fileNameDisplay) fileNameDisplay.textContent = 'Click to select a CSV file';
  const submitBtn = document.getElementById('submitCsvImportBtn');
  if (submitBtn) submitBtn.disabled = true;
  const errorBox = document.getElementById('csvImportErrors');
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.innerHTML = '';
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCsvModal() {
  const modal = document.getElementById('csvModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function handleCsvFileSelect(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please select a valid .csv file.');
    return;
  }
  selectedCsvFile = file;
  const fileNameDisplay = document.getElementById('csvSelectedFileName');
  if (fileNameDisplay) {
    fileNameDisplay.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
  const submitBtn = document.getElementById('submitCsvImportBtn');
  if (submitBtn) submitBtn.disabled = false;

  const errorBox = document.getElementById('csvImportErrors');
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.innerHTML = '';
  }
}

async function handleCsvImportSubmit(e) {
  e.preventDefault();
  if (!selectedCsvFile || !collectionId) return;

  const submitBtn = document.getElementById('submitCsvImportBtn');
  const errorBox = document.getElementById('csvImportErrors');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing...';
  }
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.innerHTML = '';
  }

  try {
    const result = await importCsv(collectionId, selectedCsvFile);
    showToast(`✓ Imported ${result.imported} wine(s) (${result.bottles} total bottles)!`);
    closeCsvModal();
    // Reload cellar items
    const itemsData = await listItems(collectionId, true);
    cellar = itemsData.items.map(toCellarWine);
    updateStats();
    updateRegionFilterChips();
    renderMain();
    refreshServerValue();
  } catch (err) {
    console.error('CSV import error:', err);
    if (errorBox) {
      errorBox.style.display = 'block';
      if (err.rows && err.rows.length > 0) {
        errorBox.innerHTML = `<strong>${escapeHtml(err.message || 'Row validation failed:')}</strong><ul style="margin:6px 0 0; padding-left:18px;">` +
          err.rows.map(r => {
            const rowIssues = Object.values(r.fields || {}).join('; ');
            return `<li><strong>Row ${r.row}:</strong> ${escapeHtml(rowIssues)}</li>`;
          }).join('') + `</ul>`;
      } else {
        errorBox.textContent = firstErrorMessage(err);
      }
    }
    showToast(`CSV Import failed: ${firstErrorMessage(err)}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & Import Bottles';
    }
  }
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  if (isOpenedAsFile()) return;

  setupFilters();
  setupSortControls();
  loadDashboardData();

  // Sign out: end the session on the server first
  ['signOutBtn', 'profileSignOutBtn'].forEach(id => {
    const link = document.getElementById(id);
    if (link) link.addEventListener('click', signOut);
  });

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

  document.querySelectorAll('#recTypeChips .select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#recTypeChips .select-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.querySelectorAll('#recTierChips .select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#recTierChips .select-chip').forEach(c => c.classList.remove('selected'));
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
  const barcodeCameraInput = document.getElementById('barcodeCameraInput');
  const barcodeFileInput = document.getElementById('barcodeFileInput');
  const barcodeSnapBtn = document.getElementById('barcodeSnapBtn');
  const barcodeUploadBtn = document.getElementById('barcodeUploadBtn');

  if (barcodeSnapBtn && barcodeCameraInput) {
    barcodeSnapBtn.addEventListener('click', () => barcodeCameraInput.click());
  }

  if (triggerUploadFallbackBtn && barcodeCameraInput) {
    triggerUploadFallbackBtn.addEventListener('click', () => barcodeCameraInput.click());
  }

  if (barcodeUploadBtn && barcodeFileInput) {
    barcodeUploadBtn.addEventListener('click', () => barcodeFileInput.click());
  }

  async function handleBarcodeFileSelection(file) {
    if (!file) return;
    showToast("Analyzing barcode photo...");
    try {
      if (!html5QrCodeScanner) {
        html5QrCodeScanner = new Html5Qrcode("barcodeReader", { verbose: false });
      }
      const decodedText = await html5QrCodeScanner.scanFile(file, true);
      await onBarcodeScanSuccess(decodedText);
    } catch (scanErr) {
      console.warn("Barcode decode failed:", scanErr);
      showToast("Could not detect a clear barcode in this photo. Please try a closer, well-lit shot.");
    }
  }

  if (barcodeCameraInput) {
    barcodeCameraInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await handleBarcodeFileSelection(e.target.files[0]);
      }
    });
  }

  if (barcodeFileInput) {
    barcodeFileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await handleBarcodeFileSelection(e.target.files[0]);
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

  // Wire Mobile Sticky Action Bar (Feature 3)
  const mobileAddWineBtn = document.getElementById('mobileAddWineBtn');
  if (mobileAddWineBtn) mobileAddWineBtn.addEventListener('click', openAddWineModal);

  const mobileScanBarcodeBtn = document.getElementById('mobileScanBarcodeBtn');
  if (mobileScanBarcodeBtn) mobileScanBarcodeBtn.addEventListener('click', openScannerModal);

  const mobileRecommendBtn = document.getElementById('mobileRecommendBtn');
  if (mobileRecommendBtn) mobileRecommendBtn.addEventListener('click', openRecommendModal);

  const mobileWishlistBtn = document.getElementById('mobileWishlistBtn');
  if (mobileWishlistBtn) mobileWishlistBtn.addEventListener('click', openWishlistModal);

  // Wire Wishlist controls (Update 5)
  const openWishlistBtn = document.getElementById('openWishlistBtn');
  if (openWishlistBtn) {
    openWishlistBtn.addEventListener('click', () => {
      closeActionDropdown();
      openWishlistModal();
    });
  }

  const closeWishlistBtn = document.getElementById('closeWishlistBtn');
  if (closeWishlistBtn) closeWishlistBtn.addEventListener('click', closeWishlistModal);

  const cancelWishlistBtn = document.getElementById('cancelWishlistBtn');
  if (cancelWishlistBtn) cancelWishlistBtn.addEventListener('click', closeWishlistModal);

  const addWishlistForm = document.getElementById('addWishlistForm');
  if (addWishlistForm) addWishlistForm.addEventListener('submit', handleAddWishlistSubmit);

  const wishlistModal = document.getElementById('wishlistModal');
  if (wishlistModal) {
    wishlistModal.addEventListener('click', (e) => {
      if (e.target.id === 'wishlistModal') closeWishlistModal();
    });
  }

  // Wire CSV Import/Export controls (Update 3)
  const openCsvModalBtn = document.getElementById('openCsvModalBtn');
  if (openCsvModalBtn) {
    openCsvModalBtn.addEventListener('click', () => {
      closeActionDropdown();
      openCsvModal();
    });
  }

  const closeCsvModalBtn = document.getElementById('closeCsvModalBtn');
  if (closeCsvModalBtn) closeCsvModalBtn.addEventListener('click', closeCsvModal);

  const cancelCsvModalBtn = document.getElementById('cancelCsvModalBtn');
  if (cancelCsvModalBtn) cancelCsvModalBtn.addEventListener('click', closeCsvModal);

  const csvDropzone = document.getElementById('csvDropzone');
  const csvFileInput = document.getElementById('csvFileInput');
  if (csvDropzone && csvFileInput) {
    csvDropzone.addEventListener('click', () => csvFileInput.click());

    csvDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      csvDropzone.style.borderColor = 'var(--gold)';
    });

    csvDropzone.addEventListener('dragleave', () => {
      csvDropzone.style.borderColor = '';
    });

    csvDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      csvDropzone.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleCsvFileSelect(e.dataTransfer.files[0]);
      }
    });

    csvFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleCsvFileSelect(e.target.files[0]);
      }
    });
  }

  const csvImportForm = document.getElementById('csvImportForm');
  if (csvImportForm) csvImportForm.addEventListener('submit', handleCsvImportSubmit);

  const csvModal = document.getElementById('csvModal');
  if (csvModal) {
    csvModal.addEventListener('click', (e) => {
      if (e.target.id === 'csvModal') closeCsvModal();
    });
  }

  // Wire Recently Uncorked Journal modal controls
  const openUncorkJournalBtn = document.getElementById('openUncorkJournalBtn');
  if (openUncorkJournalBtn) {
    openUncorkJournalBtn.addEventListener('click', () => {
      closeActionDropdown();
      openUncorkJournalModal();
    });
  }

  const profileOpenUncorkBtn = document.getElementById('profileOpenUncorkBtn');
  if (profileOpenUncorkBtn) {
    profileOpenUncorkBtn.addEventListener('click', () => {
      closeProfileModal();
      openUncorkJournalModal();
    });
  }

  const closeUncorkJournalBtn = document.getElementById('closeUncorkJournalBtn');
  if (closeUncorkJournalBtn) closeUncorkJournalBtn.addEventListener('click', closeUncorkJournalModal);

  const closeUncorkJournalDoneBtn = document.getElementById('closeUncorkJournalDoneBtn');
  if (closeUncorkJournalDoneBtn) closeUncorkJournalDoneBtn.addEventListener('click', closeUncorkJournalModal);

  const uncorkJournalModal = document.getElementById('uncorkJournalModal');
  if (uncorkJournalModal) {
    uncorkJournalModal.addEventListener('click', (e) => {
      if (e.target.id === 'uncorkJournalModal') closeUncorkJournalModal();
    });
  }

  // Wire Household & Cellar Sharing modal controls
  const openHouseholdBtn = document.getElementById('openHouseholdBtn');
  if (openHouseholdBtn) {
    openHouseholdBtn.addEventListener('click', () => {
      closeActionDropdown();
      openHouseholdModal();
    });
  }

  const profileOpenHouseholdBtn = document.getElementById('profileOpenHouseholdBtn');
  if (profileOpenHouseholdBtn) {
    profileOpenHouseholdBtn.addEventListener('click', () => {
      closeProfileModal();
      openHouseholdModal();
    });
  }

  const closeHouseholdBtn = document.getElementById('closeHouseholdBtn');
  if (closeHouseholdBtn) closeHouseholdBtn.addEventListener('click', closeHouseholdModal);

  const closeHouseholdDoneBtn = document.getElementById('closeHouseholdDoneBtn');
  if (closeHouseholdDoneBtn) closeHouseholdDoneBtn.addEventListener('click', closeHouseholdModal);

  const householdModal = document.getElementById('householdModal');
  if (householdModal) {
    householdModal.addEventListener('click', (e) => {
      if (e.target.id === 'householdModal') closeHouseholdModal();
    });
  }

  // Wire Household Member Invitation Form (Update 4)
  const inviteMemberForm = document.getElementById('inviteMemberForm');
  if (inviteMemberForm) inviteMemberForm.addEventListener('submit', handleInviteMemberSubmit);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOverview();
      closeAddWineModal();
      closeProfileModal();
      closeRecommendModal();
      closeScannerModal();
      closeWishlistModal();
      closeCsvModal();
      closeUncorkJournalModal();
      closeHouseholdModal();
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
});
