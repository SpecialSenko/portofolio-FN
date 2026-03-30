export const PHYSICAL_ORDER_REDIRECT_PATH = "/store/physical-order";
export const STORE_URL = "https://gamerpay.gg/shop/525d38b58d";
export const STORE_ICON_URL = "https://www.google.com/s2/favicons?sz=128&domain_url=https://gamerpay.gg/shop/525d38b58d";
export const CSFLOAT_URL = "https://csfloat.com/stall/76561199088840145";
export const CSFLOAT_ICON_URL = "https://www.google.com/s2/favicons?sz=128&domain_url=https://csfloat.com/stall/76561199088840145";

export const storeTabs = [
  { id: "store", label: "Store" },
  { id: "video", label: "Video" },
  { id: "files", label: "Files" },
  { id: "physical", label: "Physical" },
] as const;

export const storeItems = {
  store: [
    {
      title: "FN GamerPay Store",
      badge: "Live",
      meta: "Marketplace",
      description: "Open the GamerPay storefront.",
      action: "Visit store",
      href: STORE_URL,
      icon: STORE_ICON_URL,
      iconText: "GP",
      domain: "gamerpay.gg",
      kind: "external",
    },
    {
      title: "FN CSFloat Stall",
      badge: "Live",
      meta: "Marketplace",
      description: "Browse the live CSFloat stall.",
      action: "Open stall",
      href: CSFLOAT_URL,
      icon: CSFLOAT_ICON_URL,
      iconText: "CF",
      domain: "csfloat.com",
      kind: "external",
    },
  ],
  video: [
    {
      title: "Video Drop",
      badge: "Digital",
      meta: "Video",
      description: "Placeholder item for video products.",
      action: "Coming soon",
      iconText: "VD",
      kind: "static",
    },
  ],
  files: [
    {
      title: "Files Pack",
      badge: "Digital",
      meta: "Files",
      description: "Placeholder item for downloadable files.",
      action: "Coming soon",
      iconText: "FL",
      kind: "static",
    },
  ],
  physical: [
    {
      title: "GTX 1650 4GB",
      badge: "Ships",
      meta: "4GB VRAM",
      description: "Rp4,000,000, about US$237.65 at the March 30, 2026 mid-market IDR/USD rate. Fill your address before continuing.",
      action: "Order GPU",
      iconText: "GPU",
      kind: "physical",
      redirect: PHYSICAL_ORDER_REDIRECT_PATH,
    },
  ],
} as const;
