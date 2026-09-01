const client = String(import.meta.env.VITE_ADSENSE_CLIENT || "ca-pub-6419232461977756").trim();
const slot = String(import.meta.env.VITE_ADSENSE_SLOT || "").trim();
const videoAdUrl = String(import.meta.env.VITE_SPONSORED_VIDEO_URL || "").trim();
const configured = /^ca-pub-\d+$/.test(client) && /^\d+$/.test(slot);
let initialized = false;

function loadAdSenseScript() {
  const existing = Array.from(document.scripts).find((script) =>
    script.src.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js")
    && script.src.includes(`client=${client}`)
  );
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

function trustedVideoUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" && url.origin !== window.location.origin) return "";
    return url.href;
  } catch {
    return "";
  }
}

const imageAdButton = document.getElementById("openImageAd");
const videoAdButton = document.getElementById("openVideoAd");
const videoAdAvailability = document.getElementById("videoAdAvailability");
const videoAdModal = document.getElementById("videoAdModal");
const videoAdPlayer = document.getElementById("videoAdPlayer");
const videoAdStatus = document.getElementById("videoAdStatus");
const closeVideoAdButton = document.getElementById("closeVideoAd");
const trustedVideo = trustedVideoUrl(videoAdUrl);
let videoReturnFocus = null;
let watchedSeconds = 0;
let watchTimer = null;
let completionDispatched = false;

function updateVideoStatus() {
  const remaining = Math.max(0, 30 - Math.floor(watchedSeconds));
  videoAdStatus.textContent = remaining
    ? `${remaining} second${remaining === 1 ? "" : "s"} remaining.`
    : "30-second advertisement completed.";
}

function stopWatchTimer() {
  clearInterval(watchTimer);
  watchTimer = null;
}

function closeVideoAd() {
  if (videoAdModal.hidden) return;
  stopWatchTimer();
  videoAdPlayer.pause();
  videoAdModal.hidden = true;
  document.body.style.overflow = "";
  if (videoReturnFocus instanceof HTMLElement) videoReturnFocus.focus();
  videoReturnFocus = null;
}

imageAdButton?.addEventListener("click", () => {
  document.querySelector('[data-nav][data-page="global"]')?.click();
  document.getElementById("closeAdPopover")?.click();
  requestAnimationFrame(() => {
    const rail = document.getElementById("adRailSlot");
    rail?.setAttribute("tabindex", "-1");
    rail?.focus({ preventScroll: true });
  });
});

if (trustedVideo) {
  videoAdPlayer.src = trustedVideo;
  videoAdAvailability.textContent = "Open the active sponsor video.";
  videoAdButton.disabled = false;
} else {
  videoAdAvailability.textContent = "No 30-second video is active right now.";
  videoAdButton.disabled = true;
}

videoAdButton?.addEventListener("click", () => {
  if (!trustedVideo) return;
  document.getElementById("closeAdPopover")?.click();
  videoReturnFocus = videoAdButton;
  watchedSeconds = 0;
  completionDispatched = false;
  updateVideoStatus();
  videoAdModal.hidden = false;
  document.body.style.overflow = "hidden";
  closeVideoAdButton.focus();
});

videoAdPlayer?.addEventListener("loadedmetadata", () => {
  if (!Number.isFinite(videoAdPlayer.duration) || videoAdPlayer.duration < 30) {
    videoAdPlayer.removeAttribute("src");
    videoAdPlayer.load();
    videoAdButton.disabled = true;
    videoAdAvailability.textContent = "The configured video is shorter than 30 seconds.";
    closeVideoAd();
  }
});
videoAdPlayer?.addEventListener("play", () => {
  if (watchTimer || watchedSeconds >= 30) return;
  const startedAt = performance.now() - watchedSeconds * 1000;
  watchTimer = setInterval(() => {
    if (videoAdPlayer.paused || videoAdPlayer.ended) return;
    watchedSeconds = Math.min(30, (performance.now() - startedAt) / 1000);
    updateVideoStatus();
    if (watchedSeconds >= 30) {
      stopWatchTimer();
      if (!completionDispatched) {
        completionDispatched = true;
        closeVideoAd();
        window.dispatchEvent(new CustomEvent("fn-sponsored-ad-complete"));
      }
    }
  }, 250);
});
videoAdPlayer?.addEventListener("pause", stopWatchTimer);
closeVideoAdButton?.addEventListener("click", closeVideoAd);
videoAdModal?.addEventListener("click", (event) => { if (event.target === videoAdModal) closeVideoAd(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !videoAdModal?.hidden) closeVideoAd(); });
