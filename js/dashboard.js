/* ==========================================================================
   Vino — Cellar Dashboard Logic (dashboard.js)
   ========================================================================== */

// ---- STATE MANAGEMENT ----
let cellar = [];
let activeWineId = null;
let activeTypeFilter = 'All';
let activePairFilter = 'All';
let activeRegionFilter = 'All';
let searchQuery = '';
let viewMode = 'grid'; // 'grid' or 'region'
let currentUser = null;      // from GET /auth/me
let collectionId = null;     // the user's first collection
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
// SINGLE BOTTLE CARD HTML BUILDER
// ----------------------------------------------------
function buildBottleCardHtml(w) {
  const typeClass = (w.type || 'red').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ageStr = getWineAge(w.vintage);
  const pairingsMini = (w.pairings || []).slice(0, 3).map(p => `<span class="pair-pill-mini">${escapeHtml(p)}</span>`).join('');
  const worthFormatted = formatPrice(w.price);
  const qty = Number(w.quantity) || 0;

  return `
  <div class="bottle-card" onclick="openOverview(${Number(w.id)})" title="Click to view full sommelier overview">
    <div class="bottle-image">
      <span class="bottle-tag ${typeClass}">${escapeHtml(w.type)}</span>
      <span class="bottle-qty-badge">${qty} ${qty === 1 ? 'bottle' : 'bottles'}</span>
      <div class="bottle-bg-art">
        ${getWineSvg(w.type)}
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
// RENDER MAIN VIEW (STANDARD GRID OR REGION CATEGORIZED)
// ----------------------------------------------------
function renderMain() {
  const gridContainer = document.getElementById('bottleGrid');
  const regionContainer = document.getElementById('regionContainer');
  const countDisplay = document.getElementById('gridCountDisplay');
  const modeIndicator = document.getElementById('viewModeIndicator');

  const filtered = getFilteredWines();

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
      const winesInRegion = regionsMap[regName];
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

  // Bottles enjoyed, from the cellar journal
  const uncorkedEl = document.getElementById('profileBottlesUncorked');
  uncorkedEl.textContent = '…';
  listConsumptions(collectionId)
    .then(data => {
      const total = data.consumptions.reduce((sum, c) => sum + c.consumeQuantity, 0);
      uncorkedEl.textContent = `${total} ${total === 1 ? 'bottle' : 'bottles'} enjoyed`;
    })
    .catch(() => { uncorkedEl.textContent = '—'; });

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
// −1 and "Uncork" record a bottle drunk in the cellar journal; +1 adds a bottle.
async function adjustWineQty(delta) {
  if (!activeWineId || qtyRequestInFlight) return;
  const wine = cellar.find(w => w.id === activeWineId);
  if (!wine) return;

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

  const body = {
    itemQuantity: isNaN(quantity) ? null : quantity,
    wine: {
      wineName: name,
      wineType: type,
      wineRegion: region || null,
      wineVint: vintageText === '' ? null : Number(vintageText),
      wineValue: priceText === '' ? null : priceText,
      wineDescription: notes || null,
      blendID,
      pairings: selectedPairings
    }
  };
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
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  if (isOpenedAsFile()) return;

  setupFilters();
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

  // Wire Add Wine Button
  const openAddWineBtnHero = document.getElementById('openAddWineBtnHero');
  if (openAddWineBtnHero) openAddWineBtnHero.addEventListener('click', openAddWineModal);

  const closeAddWineBtn = document.getElementById('closeAddWineBtn');
  if (closeAddWineBtn) closeAddWineBtn.addEventListener('click', closeAddWineModal);

  const cancelAddWineBtn = document.getElementById('cancelAddWineBtn');
  if (cancelAddWineBtn) cancelAddWineBtn.addEventListener('click', closeAddWineModal);

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

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOverview();
      closeAddWineModal();
      closeProfileModal();
    }
  });
});
