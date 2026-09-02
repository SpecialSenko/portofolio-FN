const CART_KEY = "fraxb_physical_cart_v1";
const CATEGORY_LABELS = {
  food: "Food",
  daily: "Daily needs",
  fashion: "Fashion",
  electronics: "Electronics",
  services: "Services",
  other: "Other",
};
const FULFILLMENT_LABELS = {
  pickup: "Pickup",
  local_delivery: "Local delivery",
  shipping: "Shipping",
};

let account = null;
let paymentsConfigured = false;
let googleClientId = "";
let googleLibraryPromise = null;
let emailAuthMode = "login";
let steamAccountState = window.fnSteamAccountState || { loggedIn: false, steamid: "" };
let steamLinkRequest = "";
let listings = [];
let listingsLoading = false;
let listingsReloadRequested = false;
let category = "all";
let searchQuery = "";
let storeScope = null;
let cart = readCart();
let currencyRates = {
  USD: 1, EUR: .92, GBP: .79, IDR: 15800, JPY: 157, AUD: 1.52, MYR: 4.2, TWD: 30.5,
  CNY: 7.2, SGD: 1.3, THB: 32.5, KRW: 1380, CAD: 1.36, NZD: 1.65, PHP: 57, HKD: 7.8,
};
let returnFocus = null;

function element(id) {
  return document.getElementById(id);
}

function searchMatches(query, ...values) {
  return window.FraxbSearch?.matches(query, ...values) ?? values.join(" ").toLowerCase().includes(String(query || "").trim().toLowerCase());
}

function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return (Array.isArray(value) ? value : [])
      .map((entry) => ({ id: String(entry?.id || ""), quantity: Number.parseInt(entry?.quantity || "0", 10) }))
      .filter((entry) => /^[a-f0-9-]{36}$/.test(entry.id) && entry.quantity > 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartCount();
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function formatIdr(value) {
  return new Intl.NumberFormat(document.documentElement.lang || "id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function selectedCurrency() {
  const value = element("currencySelect")?.value || "IDR";
  return currencyRates[value] ? value : "IDR";
}

function convertedPrice(priceIdr) {
  const currency = selectedCurrency();
  if (currency === "IDR" || !currencyRates.IDR || !currencyRates[currency]) return "";
  const amount = (priceIdr / currencyRates.IDR) * currencyRates[currency];
  return new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function badge(text, className = "") {
  const value = document.createElement("span");
  value.className = `physical-badge ${className}`.trim();
  value.textContent = text;
  return value;
}

function normalizeListing(value) {
  const id = String(value?.id || "");
  const sellerId = String(value?.seller?.id || "");
  const priceIdr = Number(value?.priceIdr);
  const stock = Number(value?.stock);
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(sellerId) || !Number.isSafeInteger(priceIdr)) return null;
  return {
    id,
    title: String(value?.title || "Local item").slice(0, 120),
    description: String(value?.description || "").slice(0, 600),
    category: CATEGORY_LABELS[value?.category] ? value.category : "other",
    priceIdr,
    stock: Number.isSafeInteger(stock) && stock >= 0 ? stock : 0,
    fulfillment: (Array.isArray(value?.fulfillment) ? value.fulfillment : []).filter((item) => FULFILLMENT_LABELS[item]),
    area: String(value?.area || "").slice(0, 100),
    imageUrl: safeHttpsUrl(value?.imageUrl),
    seller: {
      id: sellerId,
      displayName: String(value?.seller?.displayName || "Local seller").slice(0, 80),
      storeName: String(value?.seller?.storeName || "Local store").slice(0, 100),
      city: String(value?.seller?.city || "").slice(0, 80),
      contactUrl: safeHttpsUrl(value?.seller?.contactUrl),
      steamid: /^\d{17}$/.test(String(value?.seller?.steamid || "")) ? String(value.seller.steamid) : "",
      isSupporter: Boolean(value?.seller?.isSupporter),
      isVerified: Boolean(value?.seller?.isVerified),
    },
  };
}

function installDialogs() {
  const host = document.createElement("div");
  host.innerHTML = `
    <div class="bid-modal" id="physicalEmailAuthModal" role="dialog" aria-modal="true" aria-labelledby="physicalEmailAuthTitle" hidden>
      <section class="bid-dialog physical-modal">
        <header class="bid-dialog-header"><h2 class="bid-dialog-title" id="physicalEmailAuthTitle">Continue with email</h2><button class="icon-button bid-dialog-close" data-close-physical="physicalEmailAuthModal" type="button" title="Close" aria-label="Close email sign in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <form class="bid-dialog-body physical-form-grid" id="physicalEmailAuthForm">
          <div class="email-auth-tabs is-wide" role="tablist" aria-label="Email account action">
            <button class="email-auth-tab is-active" type="button" role="tab" aria-selected="true" data-email-auth-mode="login">Sign in</button>
            <button class="email-auth-tab" type="button" role="tab" aria-selected="false" data-email-auth-mode="register">Create account</button>
          </div>
          <label class="physical-field is-wide"><span>Email</span><input class="physical-input" id="physicalEmail" name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label class="physical-field is-wide"><span>Password</span><input class="physical-input" id="physicalPassword" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label>
          <div class="physical-form-grid is-wide" id="physicalEmailRegistration" hidden>
            <label class="physical-field"><span>Your name</span><input class="physical-input" id="physicalRegisterName" maxlength="80"></label>
            <label class="physical-field"><span>Store name</span><input class="physical-input" id="physicalRegisterStore" maxlength="100"></label>
            <label class="physical-field is-wide"><span>City</span><input class="physical-input" id="physicalRegisterCity" maxlength="80"></label>
          </div>
          <p class="account-dialog-note is-wide">This is a separate Fraxb email account. Google passwords are never accepted here.</p>
          <p class="bid-error is-wide" id="physicalEmailAuthError" role="alert" hidden></p>
          <div class="bid-dialog-actions is-wide"><button class="bid-cancel" data-close-physical="physicalEmailAuthModal" type="button">Cancel</button><button class="bid-submit" id="physicalEmailAuthSubmit" type="submit">Sign in</button></div>
        </form>
      </section>
    </div>
    <div class="bid-modal" id="physicalProfileModal" role="dialog" aria-modal="true" aria-labelledby="physicalProfileTitle" hidden>
      <section class="bid-dialog physical-modal">
        <header class="bid-dialog-header"><h2 class="bid-dialog-title" id="physicalProfileTitle">Store settings</h2><button class="icon-button bid-dialog-close" data-close-physical="physicalProfileModal" type="button" title="Close" aria-label="Close store settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <form class="bid-dialog-body physical-form-grid" id="physicalProfileForm">
          <label class="physical-field"><span>Your name</span><input class="physical-input" id="physicalProfileName" maxlength="80" required></label>
          <label class="physical-field"><span>Store name</span><input class="physical-input" id="physicalProfileStore" maxlength="100" required></label>
          <label class="physical-field is-wide"><span>City</span><input class="physical-input" id="physicalProfileCity" maxlength="80" required></label>
          <label class="physical-field is-wide"><span>Description</span><textarea class="physical-textarea" id="physicalProfileDescription" maxlength="300"></textarea></label>
          <label class="physical-field is-wide"><span>Order/contact link</span><input class="physical-input" id="physicalProfileContact" type="url" inputmode="url" maxlength="800" placeholder="https://..."></label>
          <section class="physical-danger-zone is-wide" aria-labelledby="physicalDeletionTitle">
            <div>
              <h3 id="physicalDeletionTitle">Delete store and account</h3>
              <p id="physicalDeletionStatus">Deletion starts after a 3-day waiting period and removes this local store and its physical listings.</p>
            </div>
            <button class="physical-danger-button" id="physicalDeleteStore" type="button">Schedule deletion</button>
            <button class="physical-secondary" id="physicalCancelDeletion" type="button" hidden>Cancel deletion</button>
          </section>
          <p class="bid-error is-wide" id="physicalProfileError" role="alert" hidden></p>
          <div class="bid-dialog-actions is-wide"><button class="bid-cancel" data-close-physical="physicalProfileModal" type="button">Cancel</button><button class="bid-submit" id="physicalProfileSubmit" type="submit">Save store</button></div>
        </form>
      </section>
    </div>
    <div class="bid-modal" id="physicalListingModal" role="dialog" aria-modal="true" aria-labelledby="physicalListingTitle" hidden>
      <section class="bid-dialog physical-modal">
        <header class="bid-dialog-header"><h2 class="bid-dialog-title" id="physicalListingTitle">List a physical item</h2><button class="icon-button bid-dialog-close" data-close-physical="physicalListingModal" type="button" title="Close" aria-label="Close physical listing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <form class="bid-dialog-body physical-form-grid" id="physicalListingForm">
          <label class="physical-field is-wide"><span>Item name</span><input class="physical-input" id="physicalListingName" maxlength="120" required></label>
          <label class="physical-field"><span>Category</span><select class="physical-select" id="physicalListingCategory"><option value="food">Food</option><option value="daily">Daily needs</option><option value="fashion">Fashion</option><option value="electronics">Electronics</option><option value="services">Services</option><option value="other">Other</option></select></label>
          <label class="physical-field"><span>Price (IDR)</span><input class="physical-input" id="physicalListingPrice" type="number" inputmode="numeric" min="1000" max="1000000000" step="1000" required></label>
          <label class="physical-field"><span>Stock</span><input class="physical-input" id="physicalListingStock" type="number" inputmode="numeric" min="0" max="100000" step="1" value="1" required></label>
          <label class="physical-field"><span>Area</span><input class="physical-input" id="physicalListingArea" maxlength="100"></label>
          <label class="physical-field is-wide"><span>Description</span><textarea class="physical-textarea" id="physicalListingDescription" maxlength="600"></textarea></label>
          <label class="physical-field is-wide"><span>Image URL</span><input class="physical-input" id="physicalListingImage" type="url" inputmode="url" maxlength="800" placeholder="https://..."></label>
          <fieldset class="physical-field is-wide" style="border:0;padding:0;margin:0"><span>Fulfillment</span><div class="physical-checks"><label class="physical-check"><input type="checkbox" name="physicalFulfillment" value="pickup" checked> Pickup</label><label class="physical-check"><input type="checkbox" name="physicalFulfillment" value="local_delivery"> Local delivery</label><label class="physical-check"><input type="checkbox" name="physicalFulfillment" value="shipping"> Shipping</label></div></fieldset>
          <p class="bid-error is-wide" id="physicalListingError" role="alert" hidden></p>
          <div class="bid-dialog-actions is-wide"><button class="bid-cancel" data-close-physical="physicalListingModal" type="button">Cancel</button><button class="bid-submit" id="physicalListingSubmit" type="submit">Publish item</button></div>
        </form>
      </section>
    </div>
    <div class="bid-modal" id="supporterModal" role="dialog" aria-modal="true" aria-labelledby="supporterTitle" hidden>
      <section class="bid-dialog physical-modal">
        <header class="bid-dialog-header"><h2 class="bid-dialog-title" id="supporterTitle">Supporter placement</h2><button class="icon-button bid-dialog-close" data-close-physical="supporterModal" type="button" title="Close" aria-label="Close supporter plans"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div class="bid-dialog-body"><div class="supporter-plans"><button class="supporter-plan" data-supporter-plan="week" type="button"><strong>1 week</strong><span>Supporter badge and placement</span><b>Rp10,000</b></button><button class="supporter-plan" data-supporter-plan="month" type="button"><strong>1 month</strong><span>Supporter badge and placement</span><b>Rp100,000</b></button><button class="supporter-plan" data-supporter-plan="year" type="button"><strong>1 year</strong><span>Supporter badge and placement</span><b>Rp1,000,000</b></button></div><p class="bid-error" id="supporterError" role="alert" hidden></p></div>
      </section>
    </div>
    <div class="bid-modal" id="physicalCartModal" role="dialog" aria-modal="true" aria-labelledby="physicalCartTitle" hidden>
      <section class="bid-dialog physical-cart-modal">
        <header class="bid-dialog-header"><h2 class="bid-dialog-title" id="physicalCartTitle">Cart</h2><button class="icon-button bid-dialog-close" data-close-physical="physicalCartModal" type="button" title="Close" aria-label="Close cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div class="bid-dialog-body" id="physicalCartBody"></div>
      </section>
    </div>`;
  document.body.append(...host.children);
}

function openModal(modal) {
  returnFocus = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector("input, button")?.focus();
}

function closeModal(modal) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (!document.querySelector(".bid-modal:not([hidden])")) document.body.style.overflow = "";
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  returnFocus = null;
}

function renderAccount() {
  const band = element("physicalAccountBand");
  const addButton = element("addPhysicalListing");
  const accountButton = element("physicalAccountButton");
  const accountGoogleButton = element("accountGoogleButton");
  band.hidden = !account || Boolean(storeScope);
  addButton.hidden = !account || Boolean(storeScope);
  accountButton.hidden = !account || Boolean(storeScope);
  accountButton.textContent = "Store settings";
  if (accountGoogleButton) accountGoogleButton.hidden = Boolean(account);
  window.dispatchEvent(new CustomEvent("fn-marketplace-account-change", {
    detail: {
      loggedIn: Boolean(account),
      account: account ? {
        id: account.id,
        displayName: account.displayName,
        storeName: account.storeName,
        email: account.email,
        signInMethod: account.signInMethod,
        steamid: account.steamid || "",
      } : null,
    },
  }));
  if (!account) return;
  element("physicalStoreName").textContent = account.storeName;
  element("physicalStoreMeta").textContent = [account.city, account.description].filter(Boolean).join(" - ") || account.email;
  const badges = element("physicalAccountBadges");
  badges.replaceChildren();
  if (account.isVerified) badges.appendChild(badge("Verified business", "is-verified"));
  if (account.isSupporter) badges.appendChild(badge("Supporter", "is-supporter"));
  if (account.signInMethod === "google") badges.appendChild(badge("Google account"));
}

function listingCard(listing) {
  const card = document.createElement("article");
  card.className = "physical-card is-image-only";
  card.tabIndex = 0;
  card.role = "button";
  card.setAttribute("aria-label", `${listing.title}. Open ${listing.seller.storeName} profile`);
  card.title = `${listing.title} - open ${listing.seller.storeName}`;
  const openSellerProfile = (event) => {
    if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
    window.dispatchEvent(new CustomEvent("fn-open-seller-choice", { detail: { sellerId: listing.seller.id } }));
  };
  card.addEventListener("click", openSellerProfile);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSellerProfile(event);
  });
  let image;
  if (listing.imageUrl) {
    image = document.createElement("img");
    image.src = listing.imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
  } else {
    image = document.createElement("div");
    image.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10h16v10H4V10Z"/><path d="M3 10 5 4h14l2 6M8 20v-6h4v6"/></svg>';
  }
  image.className = "physical-card-image";
  card.appendChild(image);
  return card;
}

function renderListings() {
  const grid = element("physicalGrid");
  const status = element("physicalMarketStatus");
  grid.replaceChildren();
  if (listingsLoading && listings.length === 0) {
    status.textContent = "Loading local listings...";
    return;
  }
  const filtered = listings.filter((listing) => {
    if (storeScope) {
      const sellerIdMatches = storeScope.sellerId && listing.seller.id === storeScope.sellerId;
      const scopedNames = [storeScope.name, storeScope.storeName, storeScope.displayName]
        .map((value) => window.FraxbSearch?.normalize(value) || String(value || "").trim().toLowerCase())
        .filter(Boolean);
      const listingNames = [listing.seller.storeName, listing.seller.displayName]
        .map((value) => window.FraxbSearch?.normalize(value) || String(value || "").trim().toLowerCase());
      if (!sellerIdMatches && !listingNames.some((value) => scopedNames.includes(value))) return false;
    }
    if (category !== "all" && listing.category !== category) return false;
    return searchMatches(
      searchQuery,
      listing.title,
      listing.description,
      listing.category,
      listing.area,
      listing.seller.storeName,
      listing.seller.displayName,
    );
  });
  status.textContent = storeScope
    ? `${filtered.length} listing${filtered.length === 1 ? "" : "s"} in ${storeScope.name}'s physical store.`
    : `${filtered.length} local listing${filtered.length === 1 ? "" : "s"}.`;
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = storeScope ? `No physical items from ${storeScope.name} match this view.` : "No local items match this view.";
    grid.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  filtered.forEach((listing) => fragment.appendChild(listingCard(listing)));
  grid.appendChild(fragment);
}

async function loadListings({ refreshAfterCurrent = false } = {}) {
  if (listingsLoading) {
    listingsReloadRequested ||= refreshAfterCurrent;
    return;
  }
  listingsLoading = true;
  renderListings();
  try {
    const data = await fetchJson("/api/physical/listings");
    listings = (Array.isArray(data.listings) ? data.listings : []).map(normalizeListing).filter(Boolean);
    reconcileCart();
  } catch (error) {
    element("physicalMarketStatus").textContent = error.message || "Local listings are unavailable";
  } finally {
    listingsLoading = false;
    renderListings();
    window.dispatchEvent(new CustomEvent("fn-physical-listings-change", { detail: { listings } }));
    if (listingsReloadRequested) {
      listingsReloadRequested = false;
      void loadListings();
    }
  }
}

async function maybeLinkSteamAccount() {
  const steamid = String(steamAccountState?.steamid || "");
  if (!account || !steamAccountState?.loggedIn || !/^\d{17}$/.test(steamid) || account.steamid === steamid) return;
  if (account.steamid || steamLinkRequest === `${account.id}:${steamid}`) return;
  steamLinkRequest = `${account.id}:${steamid}`;
  try {
    const data = await fetchJson("/api/physical/auth", {
      method: "POST",
      body: JSON.stringify({ action: "linkSteam" }),
    });
    account = data.account;
    renderAccount();
    await loadListings({ refreshAfterCurrent: true });
  } catch {
    // The account remains usable if another seller already owns the Steam link.
  }
}

async function loadAuth() {
  try {
    const data = await fetchJson("/api/physical/auth");
    account = data.loggedIn ? data.account : null;
    paymentsConfigured = Boolean(data.paymentsConfigured);
    googleClientId = String(data.googleClientId || "");
  } catch {
    account = null;
    paymentsConfigured = false;
    googleClientId = "";
  }
  renderAccount();
  renderListings();
  void renderGoogleButtons();
  void maybeLinkSteamAccount();
}

async function loadRates() {
  try {
    const data = await fetchJson("/api/currency");
    if (data?.base === "USD" && data.rates && Number(data.rates.IDR) > 0) currencyRates = { ...currencyRates, ...data.rates };
  } catch {}
  renderListings();
  if (!element("physicalCartModal").hidden) renderCart();
}

function addToCart(listing, button) {
  const entry = cart.find((item) => item.id === listing.id);
  if (entry) entry.quantity = Math.min(listing.stock, entry.quantity + 1);
  else cart.push({ id: listing.id, quantity: 1 });
  saveCart();
  button.textContent = "Added";
  setTimeout(() => { if (button.isConnected) button.textContent = "Add to cart"; }, 900);
}

function reconcileCart() {
  cart = cart.flatMap((entry) => {
    const listing = listings.find((item) => item.id === entry.id);
    return listing && listing.stock > 0 ? [{ ...entry, quantity: Math.min(listing.stock, entry.quantity) }] : [];
  });
  saveCart();
}

function renderCartCount() {
  const count = cart.reduce((sum, entry) => sum + entry.quantity, 0);
  const value = element("physicalCartCount");
  value.textContent = String(count);
  value.hidden = count === 0;
}

function updateCartQuantity(id, change) {
  const entry = cart.find((item) => item.id === id);
  const listing = listings.find((item) => item.id === id);
  if (!entry || !listing) return;
  entry.quantity = Math.max(0, Math.min(listing.stock, entry.quantity + change));
  if (entry.quantity === 0) cart = cart.filter((item) => item.id !== id);
  saveCart();
  renderCart();
}

function orderSummary(group) {
  const lines = group.map(({ listing, quantity }) => `${quantity} x ${listing.title} - ${formatIdr(listing.priceIdr * quantity)}`);
  const total = group.reduce((sum, item) => sum + item.listing.priceIdr * item.quantity, 0);
  return `${group[0].listing.seller.storeName}\n${lines.join("\n")}\nTotal: ${formatIdr(total)}`;
}

function cartLine(listing, quantity) {
  const line = document.createElement("div");
  line.className = "physical-cart-line";
  const copy = document.createElement("div");
  const name = document.createElement("p");
  name.className = "physical-cart-line-name";
  name.textContent = listing.title;
  const unit = document.createElement("span");
  unit.className = "physical-cart-line-price";
  unit.textContent = formatIdr(listing.priceIdr);
  copy.append(name, unit);
  const quantityControl = document.createElement("div");
  quantityControl.className = "physical-quantity";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "-";
  minus.title = "Decrease quantity";
  const number = document.createElement("span");
  number.textContent = String(quantity);
  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.title = "Increase quantity";
  plus.disabled = quantity >= listing.stock;
  minus.addEventListener("click", () => updateCartQuantity(listing.id, -1));
  plus.addEventListener("click", () => updateCartQuantity(listing.id, 1));
  quantityControl.append(minus, number, plus);
  const subtotal = document.createElement("span");
  subtotal.className = "physical-cart-subtotal";
  subtotal.textContent = formatIdr(listing.priceIdr * quantity);
  const remove = document.createElement("button");
  remove.className = "physical-cart-remove";
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => updateCartQuantity(listing.id, -quantity));
  line.append(copy, quantityControl, subtotal, remove);
  return line;
}

function renderCart() {
  const body = element("physicalCartBody");
  body.replaceChildren();
  const entries = cart.map((entry) => ({ ...entry, listing: listings.find((item) => item.id === entry.id) })).filter((entry) => entry.listing);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "physical-cart-empty";
    empty.textContent = "Your physical cart is empty.";
    body.appendChild(empty);
    return;
  }
  const groups = new Map();
  entries.forEach((entry) => {
    const current = groups.get(entry.listing.seller.id) || [];
    current.push(entry);
    groups.set(entry.listing.seller.id, current);
  });
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "physical-cart-group";
    const head = document.createElement("div");
    head.className = "physical-cart-store";
    const name = document.createElement("h3");
    name.textContent = group[0].listing.seller.storeName;
    const area = document.createElement("span");
    area.textContent = group[0].listing.seller.city || "Local seller";
    head.append(name, area);
    section.appendChild(head);
    group.forEach(({ listing, quantity }) => section.appendChild(cartLine(listing, quantity)));
    const footer = document.createElement("div");
    footer.className = "physical-cart-group-footer";
    const copy = document.createElement("button");
    copy.className = "physical-secondary";
    copy.type = "button";
    copy.textContent = "Copy order";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(orderSummary(group));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy unavailable";
      }
    });
    const contactUrl = group[0].listing.seller.contactUrl;
    const contact = document.createElement(contactUrl ? "a" : "button");
    contact.className = "physical-primary";
    contact.textContent = contactUrl ? "Order from store" : "Contact unavailable";
    if (contactUrl) {
      contact.href = contactUrl;
      contact.target = "_blank";
      contact.rel = "noopener";
    } else {
      contact.type = "button";
      contact.disabled = true;
    }
    footer.append(copy, contact);
    section.appendChild(footer);
    body.appendChild(section);
  });
  const total = entries.reduce((sum, entry) => sum + entry.listing.priceIdr * entry.quantity, 0);
  const totalRow = document.createElement("div");
  totalRow.className = "physical-cart-total";
  const label = document.createElement("span");
  label.textContent = "Cart total";
  const value = document.createElement("span");
  value.textContent = formatIdr(total);
  totalRow.append(label, value);
  const cardButton = document.createElement("button");
  cardButton.className = "physical-primary";
  cardButton.type = "button";
  cardButton.disabled = true;
  cardButton.textContent = "Secure checkout setup required";
  const note = document.createElement("p");
  note.className = "physical-payment-note";
  note.textContent = "Real-money checkout will activate only through a verified marketplace payment provider. Fraxb never stores card numbers or online-banking credentials.";
  body.append(totalRow, cardButton, note);
}

function openProfile() {
  if (!account) return;
  element("physicalProfileName").value = account.displayName || "";
  element("physicalProfileStore").value = account.storeName || "";
  element("physicalProfileCity").value = account.city || "";
  element("physicalProfileDescription").value = account.description || "";
  element("physicalProfileContact").value = account.contactUrl || "";
  element("physicalProfileError").hidden = true;
  renderDeletionControls();
  openModal(element("physicalProfileModal"));
}

function renderDeletionControls() {
  const status = element("physicalDeletionStatus");
  const scheduleButton = element("physicalDeleteStore");
  const cancelButton = element("physicalCancelDeletion");
  if (!status || !scheduleButton || !cancelButton) return;
  const scheduledFor = Number(account?.deletionScheduledFor);
  const pending = Number.isFinite(scheduledFor) && scheduledFor > Date.now();
  scheduleButton.hidden = pending;
  cancelButton.hidden = !pending;
  status.textContent = pending
    ? `Deletion is scheduled for ${new Date(scheduledFor).toLocaleString()}. You can cancel it before then.`
    : "Deletion starts after a 3-day waiting period and removes this local store and its physical listings. Your external Steam and Google accounts are not deleted.";
}

function loadGoogleLibrary() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (googleLibraryPromise) return googleLibraryPromise;
  googleLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google sign-in could not be loaded"));
    document.head.appendChild(script);
  });
  return googleLibraryPromise;
}

function googleButtonZones() {
  return [element("accountGoogleButton")].filter(Boolean);
}

function showGoogleStatus(message, isError = false) {
  googleButtonZones().forEach((zone) => {
    zone.replaceChildren();
    const status = document.createElement("span");
    status.className = "google-setup-status";
    status.textContent = message;
    if (isError) status.setAttribute("role", "alert");
    zone.appendChild(status);
  });
}

async function renderGoogleButtons() {
  const zones = googleButtonZones();
  zones.forEach((zone) => zone.replaceChildren());
  if (account) return;
  if (!googleClientId) {
    showGoogleStatus("Google Client ID required");
    return;
  }
  try {
    const google = await loadGoogleLibrary();
    google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredential });
    zones.forEach((zone) => {
      google.accounts.id.renderButton(zone, {
        type: "standard",
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "rectangular",
        locale: document.documentElement.lang || "en",
        width: Math.max(168, Math.min(300, zone.clientWidth || 200)),
      });
    });
  } catch (error) {
    showGoogleStatus(error.message || "Google sign-in could not be loaded", true);
  }
}

async function handleGoogleCredential(response) {
  try {
    const data = await fetchJson("/api/physical/auth", { method: "POST", body: JSON.stringify({ action: "google", credential: response?.credential }) });
    account = data.account;
    paymentsConfigured = Boolean(data.paymentsConfigured);
    renderAccount();
    renderListings();
    void maybeLinkSteamAccount();
  } catch (failure) {
    showGoogleStatus(failure.message || "Google sign-in failed", true);
  }
}

function setEmailAuthMode(mode) {
  emailAuthMode = mode === "register" ? "register" : "login";
  const registration = element("physicalEmailRegistration");
  const isRegistration = emailAuthMode === "register";
  registration.hidden = !isRegistration;
  ["physicalRegisterName", "physicalRegisterStore", "physicalRegisterCity"].forEach((id) => {
    element(id).required = isRegistration;
  });
  const passwordInput = element("physicalPassword");
  passwordInput.autocomplete = isRegistration ? "new-password" : "current-password";
  element("physicalEmailAuthTitle").textContent = isRegistration ? "Create email account" : "Sign in with email";
  element("physicalEmailAuthSubmit").textContent = isRegistration ? "Create account" : "Sign in";
  document.querySelectorAll("[data-email-auth-mode]").forEach((button) => {
    const active = button.dataset.emailAuthMode === emailAuthMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function openEmailAuth() {
  const form = element("physicalEmailAuthForm");
  form.reset();
  element("physicalEmailAuthError").hidden = true;
  setEmailAuthMode("login");
  openModal(element("physicalEmailAuthModal"));
}

async function submitEmailAuth(event) {
  event.preventDefault();
  const submit = element("physicalEmailAuthSubmit");
  const error = element("physicalEmailAuthError");
  submit.disabled = true;
  error.hidden = true;
  try {
    const body = {
      action: emailAuthMode,
      email: element("physicalEmail").value,
      password: element("physicalPassword").value,
    };
    if (emailAuthMode === "register") {
      body.displayName = element("physicalRegisterName").value;
      body.storeName = element("physicalRegisterStore").value;
      body.city = element("physicalRegisterCity").value;
    }
    const data = await fetchJson("/api/physical/auth", { method: "POST", body: JSON.stringify(body) });
    account = data.account;
    paymentsConfigured = Boolean(data.paymentsConfigured);
    closeModal(element("physicalEmailAuthModal"));
    renderAccount();
    renderListings();
    void maybeLinkSteamAccount();
  } catch (failure) {
    error.textContent = failure.message || "Email sign in failed";
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function bindEvents() {
  window.addEventListener("fn-open-email-auth", openEmailAuth);
  window.addEventListener("fn-physical-market-open", () => {
    searchQuery = document.querySelector(".search")?.value || "";
    if (!listings.length) void loadListings();
    else renderListings();
  });
  window.addEventListener("fn-physical-search", (event) => {
    searchQuery = String(event.detail?.query || "");
    renderListings();
  });
  window.addEventListener("fn-physical-store-scope", (event) => {
    storeScope = event.detail && typeof event.detail === "object" ? event.detail : null;
    renderAccount();
    renderListings();
  });
  window.addEventListener("fn-marketplace-logout-all", () => {
    account = null;
    renderAccount();
    renderListings();
    void renderGoogleButtons();
  });
  window.addEventListener("fn-steam-account-change", (event) => {
    steamAccountState = event.detail && typeof event.detail === "object"
      ? event.detail
      : { loggedIn: false, steamid: "" };
    if (!steamAccountState.loggedIn) steamLinkRequest = "";
    void maybeLinkSteamAccount();
  });
  document.querySelectorAll("[data-close-physical]").forEach((button) => button.addEventListener("click", () => closeModal(element(button.dataset.closePhysical))));
  document.querySelectorAll("[data-email-auth-mode]").forEach((button) => button.addEventListener("click", () => setEmailAuthMode(button.dataset.emailAuthMode)));
  element("physicalEmailAuthForm").addEventListener("submit", submitEmailAuth);
  document.querySelectorAll(".bid-modal").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(modal); }));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal(document.querySelector(".bid-modal:not([hidden])"));
  });
  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) { cart = readCart(); renderCartCount(); }
  });
  window.addEventListener("fn-language-change", () => {
    renderAccount();
    renderListings();
    void renderGoogleButtons();
    if (!element("physicalCartModal").hidden) renderCart();
  });
  element("currencySelect")?.addEventListener("change", () => { renderListings(); if (!element("physicalCartModal").hidden) renderCart(); });
  element("physicalCategories").addEventListener("click", (event) => {
    const button = event.target.closest("[data-physical-cat]");
    if (!button) return;
    category = button.dataset.physicalCat;
    document.querySelectorAll("[data-physical-cat]").forEach((item) => item.classList.toggle("active", item === button));
    renderListings();
  });
  function openMarketplaceAccount() {
    if (account) openProfile();
  }
  element("physicalAccountButton").addEventListener("click", openMarketplaceAccount);
  window.addEventListener("fn-open-physical-profile", openMarketplaceAccount);
  element("physicalCartButton").addEventListener("click", () => { renderCart(); openModal(element("physicalCartModal")); });
  element("addPhysicalListing").addEventListener("click", () => { element("physicalListingError").hidden = true; openModal(element("physicalListingModal")); });
  element("openSupporterPlans").addEventListener("click", () => {
    const error = element("supporterError");
    error.hidden = paymentsConfigured;
    error.textContent = paymentsConfigured ? "" : "Supporter payments are not configured yet.";
    document.querySelectorAll("[data-supporter-plan]").forEach((button) => { button.disabled = !paymentsConfigured; });
    openModal(element("supporterModal"));
  });

  element("physicalProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = element("physicalProfileError");
    const submit = element("physicalProfileSubmit");
    error.hidden = true;
    submit.disabled = true;
    try {
      const data = await fetchJson("/api/physical/auth", {
        method: "POST",
        body: JSON.stringify({ action: "profile", displayName: element("physicalProfileName").value, storeName: element("physicalProfileStore").value, city: element("physicalProfileCity").value, description: element("physicalProfileDescription").value, contactUrl: element("physicalProfileContact").value }),
      });
      account = data.account;
      closeModal(element("physicalProfileModal"));
      renderAccount();
      await loadListings();
    } catch (failure) {
      error.textContent = failure.message || "Store settings could not be saved";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  element("physicalDeleteStore").addEventListener("click", async () => {
    if (!window.confirm("Schedule permanent deletion of this local store and seller account in 3 days? You can cancel before the deadline.")) return;
    const button = element("physicalDeleteStore");
    const error = element("physicalProfileError");
    button.disabled = true;
    error.hidden = true;
    try {
      const data = await fetchJson("/api/physical/auth", {
        method: "POST",
        body: JSON.stringify({ action: "scheduleDeletion" }),
      });
      account = data.account;
      renderAccount();
      renderDeletionControls();
    } catch (failure) {
      error.textContent = failure.message || "Account deletion could not be scheduled";
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  element("physicalCancelDeletion").addEventListener("click", async () => {
    const button = element("physicalCancelDeletion");
    const error = element("physicalProfileError");
    button.disabled = true;
    error.hidden = true;
    try {
      const data = await fetchJson("/api/physical/auth", {
        method: "POST",
        body: JSON.stringify({ action: "cancelDeletion" }),
      });
      account = data.account;
      renderAccount();
      renderDeletionControls();
    } catch (failure) {
      error.textContent = failure.message || "Account deletion could not be cancelled";
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  element("physicalListingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = element("physicalListingError");
    const submit = element("physicalListingSubmit");
    error.hidden = true;
    submit.disabled = true;
    try {
      const fulfillment = [...document.querySelectorAll('input[name="physicalFulfillment"]:checked')].map((input) => input.value);
      const data = await fetchJson("/api/physical/listings", {
        method: "POST",
        body: JSON.stringify({ title: element("physicalListingName").value, category: element("physicalListingCategory").value, priceIdr: Number(element("physicalListingPrice").value), stock: Number(element("physicalListingStock").value), area: element("physicalListingArea").value, description: element("physicalListingDescription").value, imageUrl: element("physicalListingImage").value, fulfillment }),
      });
      const listing = normalizeListing(data.listing);
      if (listing) listings.unshift(listing);
      window.dispatchEvent(new CustomEvent("fn-physical-listings-change", { detail: { listings } }));
      event.currentTarget.reset();
      element("physicalListingStock").value = "1";
      document.querySelector('input[name="physicalFulfillment"][value="pickup"]').checked = true;
      closeModal(element("physicalListingModal"));
      renderListings();
    } catch (failure) {
      error.textContent = failure.message || "Physical item could not be listed";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll("[data-supporter-plan]").forEach((button) => button.addEventListener("click", async () => {
    const error = element("supporterError");
    error.hidden = true;
    button.disabled = true;
    try {
      const data = await fetchJson("/api/physical/supporter", { method: "POST", body: JSON.stringify({ plan: button.dataset.supporterPlan }) });
      const redirect = new URL(data.redirectUrl);
      if (redirect.protocol !== "https:" || !redirect.hostname.endsWith(".midtrans.com")) throw new Error("Payment provider returned an invalid checkout link");
      window.location.href = redirect.href;
    } catch (failure) {
      error.textContent = failure.message || "Supporter checkout could not be started";
      error.hidden = false;
      button.disabled = false;
    }
  }));

}

installDialogs();
bindEvents();
renderCartCount();
renderAccount();
renderListings();
void Promise.all([loadAuth(), loadListings(), loadRates()]);
