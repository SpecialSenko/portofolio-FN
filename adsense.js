const client = String(import.meta.env.VITE_ADSENSE_CLIENT || "").trim();
const slot = String(import.meta.env.VITE_ADSENSE_SLOT || "").trim();
const configured = /^ca-pub-\d+$/.test(client) && /^\d+$/.test(slot);
let initialized = false;

function loadAdSenseScript() {
  const existing = document.querySelector('script[data-fraxb-adsense="true"]');
  if (existing) return;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.dataset.fraxbAdsense = "true";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

function initializeAdRail() {
  if (!configured || initialized) return;
  const host = document.getElementById("googleAdSlot");
  const placeholder = document.getElementById("adRailPlaceholder");
  if (!host || !placeholder) return;

  const unit = document.createElement("ins");
  unit.className = "adsbygoogle";
  unit.dataset.adClient = client;
  unit.dataset.adSlot = slot;
  unit.dataset.adFormat = "auto";
  unit.dataset.fullWidthResponsive = "true";
  host.replaceChildren(unit);
  host.hidden = false;
  placeholder.hidden = true;
  initialized = true;
  loadAdSenseScript();
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

window.addEventListener("fn-page-change", (event) => {
  if (event.detail?.page === "global") initializeAdRail();
});
