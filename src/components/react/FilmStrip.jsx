import { useEffect, useMemo, useRef, useState, useCallback } from "react";

const STEAM_ID = "76561199088840145";
const APP_ID = 730;
const CONTEXT_ID = 2;
const STEAM_INVENTORY_URL = `https://steamcommunity.com/profiles/${STEAM_ID}/inventory/`;
const STEAM_COMMUNITY_API_URL = `https://steamcommunity.com/inventory/${STEAM_ID}/${APP_ID}/${CONTEXT_ID}?l=english&count=75`;
const STEAM_LEGACY_API_URL = `https://steamcommunity.com/profiles/${STEAM_ID}/inventory/json/${APP_ID}/${CONTEXT_ID}/?start=0`;
const CSFLOAT_STALL_URL = `https://csfloat.com/stall/${STEAM_ID}`;
const CSFLOAT_LISTINGS_API_URL = `https://csfloat.com/api/v1/listings?user_id=${STEAM_ID}&limit=50&sort_by=most_recent`;
const GIVEAWAY_CHANNEL_URL = "https://discordapp.com/channels/637489101800472586/1486832107631284417";
const STEAM_IMAGE_HOSTS = [
  "community.cloudflare.steamstatic.com",
  "community.akamai.steamstatic.com",
  "community.fastly.steamstatic.com",
];

const projectImages = import.meta.glob(
  "../../assets/project/*.{png,jpg,jpeg,webp}",
  { eager: true, query: "?url", import: "default" }
);
const gameImages = import.meta.glob(
  "../../assets/games/*.{png,jpg,jpeg,webp}",
  { eager: true, query: "?url", import: "default" }
);

// ── AUTO-DETECT CERTIFICATES from assets/certificates/ ───────────────────────
const _certGlob = import.meta.glob(
  "../../assets/certificates/*.pdf",
  { eager: true, query: "?url", import: "default" }
);

const formatAssetTitle = (path) =>
  path
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Certificate";

const CERTIFICATES = Object.entries(_certGlob)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => ({ src, title: formatAssetTitle(path) }));

// ── helpers ───────────────────────────────────────────────────────────────────
const getImages = (g) => Object.entries(g).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v).filter(v=>typeof v==="string");
const toSteamGlowColor = (c) => c && c !== "transparent" ? (c.startsWith("#") ? c : `#${c}`) : null;
const rarityToColor = (rarity) => {
  switch (rarity) {
    case 1:
      return "#b0c3d9";
    case 2:
      return "#5e98d9";
    case 3:
      return "#4b69ff";
    case 4:
      return "#8847ff";
    case 5:
      return "#d32ce6";
    case 6:
      return "#eb4b4b";
    case 7:
      return "#e4ae39";
    default:
      return null;
  }
};
const normalizeInventoryItems = (items) =>
  Array.isArray(items) ? items.filter((item) => typeof item?.src === "string") : [];
const normalizeSteamDescriptions = (descriptions) => {
  if (!Array.isArray(descriptions) || !descriptions.length) return [];

  return descriptions
    .filter((item) => item?.icon_url || item?.icon_url_large)
    .map((item) => {
      const rarityTag = item.tags?.find(
        (tag) =>
          tag.category?.toLowerCase() === "rarity" ||
          tag.internal_name?.includes("Rarity")
      );

      return {
        src: `https://${STEAM_IMAGE_HOSTS[0]}/economy/image/${item.icon_url_large || item.icon_url}`,
        color: rarityTag?.color || "transparent",
        name: item.market_name || item.name || "Steam item",
        source: "steam",
      };
    });
};
const normalizeCsfloatListings = (listings) => {
  if (!Array.isArray(listings) || !listings.length) return [];

  return listings
    .filter((listing) => typeof listing?.item?.icon_url === "string")
    .map((listing) => ({
      src: `https://${STEAM_IMAGE_HOSTS[0]}/economy/image/${listing.item.icon_url}`,
      color: rarityToColor(listing.item?.rarity),
      name:
        listing.item?.market_hash_name ||
        [listing.item?.item_name, listing.item?.wear_name].filter(Boolean).join(" | ") ||
        "CSFloat listing",
      source: "csfloat",
      href: listing?.id ? `https://csfloat.com/item/${listing.id}` : CSFLOAT_STALL_URL,
    }));
};
const parseInventoryPayload = (data) => {
  if (Array.isArray(data?.items)) {
    return normalizeInventoryItems(data.items);
  }

  const communityItems = normalizeSteamDescriptions(data?.descriptions);
  if (communityItems.length) {
    return communityItems;
  }

  const legacyItems = normalizeSteamDescriptions(
    data?.rgDescriptions ? Object.values(data.rgDescriptions) : []
  );
  if (legacyItems.length) {
    return legacyItems;
  }

  return normalizeCsfloatListings(data);
};
const detectInventorySource = (data, items) => {
  if (typeof data?.source === "string") {
    return data.source;
  }

  if (items.some((item) => item?.source === "csfloat")) {
    return "csfloat";
  }

  return "steam";
};
const getInventoryImageCandidates = (src) => {
  if (typeof src !== "string" || !src.trim()) {
    return ["/your-image.webp"];
  }

  const match = src.match(/^https?:\/\/[^/]+\/economy\/image\/(.+)$/i);
  if (!match?.[1]) {
    return [...new Set([src, "/your-image.webp"])];
  }

  return [
    ...new Set([
      src,
      ...STEAM_IMAGE_HOSTS.map((host) => `https://${host}/economy/image/${match[1]}`),
      "/your-image.webp",
    ]),
  ];
};

// ── useSteamItems ─────────────────────────────────────────────────────────────
function useSteamItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("steam");
  useEffect(() => {
    let cancelled = false;
    const loadingFallbackId = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
      }
    }, 6500);
    const requestJson = async (url, timeoutMs = 4500) => {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          ...(controller ? { signal: controller.signal } : {}),
        });

        if (!response.ok) {
          throw new Error(`Inventory request failed: ${response.status}`);
        }

        return await response.json();
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      }
    };
    const requestInventory = async () => requestJson(`/api/inventory?t=${Date.now()}`, 5500);
    const requestBrowserFallbacks = async () => {
      const fallbackUrls = [
        { source: "csfloat", url: `${CSFLOAT_LISTINGS_API_URL}&_=${Date.now()}` },
        { source: "steam", url: `${STEAM_COMMUNITY_API_URL}&_=${Date.now()}` },
        { source: "steam-legacy", url: `${STEAM_LEGACY_API_URL}&_=${Date.now()}` },
      ];

      for (const fallback of fallbackUrls) {
        try {
          const data = await requestJson(fallback.url);
          const nextItems = parseInventoryPayload(data);
          if (nextItems.length) {
            return { items: nextItems, source: fallback.source };
          }
        } catch {
          // Ignore blocked or empty public endpoints and keep trying.
        }
      }

      return null;
    };
    const tryFetch = async (attempt=0) => {
      try {
        const localData = await requestInventory();
        const localItems = parseInventoryPayload(localData);
        if (localItems.length) {
          return { items: localItems, source: detectInventorySource(localData, localItems) };
        }

        const browserFallback = await requestBrowserFallbacks();
        return browserFallback ?? {
          items: [],
          source: typeof localData?.source === "string" ? localData.source : "none",
        };
      } catch {
        const browserFallback = await requestBrowserFallbacks();
        if (browserFallback) {
          return browserFallback;
        }

        if(attempt<1){
          await new Promise(r=>setTimeout(r,700));
          return tryFetch(attempt+1);
        }
        return { items: [], source: "none" };
      }
    };
    tryFetch().then((result)=>{
      if(cancelled)return;
      setItems(result?.items ?? []);
      setSource(typeof result?.source === "string" ? result.source : "none");
      setLoading(false);
      window.clearTimeout(loadingFallbackId);
    });
    return ()=>{cancelled=true;window.clearTimeout(loadingFallbackId);};
  },[]);
  return {items,loading,source};
}

// ── useDragScroll ─────────────────────────────────────────────────────────────
function useDragScroll() {
  const ref=useRef(null), drag=useRef({active:false,startX:0,scrollLeft:0,moved:false});
  const onMouseDown=useCallback(e=>{const el=ref.current;if(!el)return;drag.current={active:true,startX:e.pageX-el.offsetLeft,scrollLeft:el.scrollLeft,moved:false};el.style.cursor="grabbing";el.style.userSelect="none";},[]);
  const onMouseMove=useCallback(e=>{if(!drag.current.active)return;const el=ref.current;if(!el)return;const x=e.pageX-el.offsetLeft,walk=(x-drag.current.startX)*1.2;if(Math.abs(walk)>4)drag.current.moved=true;el.scrollLeft=drag.current.scrollLeft-walk;},[]);
  const onMouseUp=useCallback(()=>{drag.current.active=false;const el=ref.current;if(el){el.style.cursor="grab";el.style.userSelect="";};},[]);
  const onTouchStart=useCallback(e=>{const el=ref.current;if(!el)return;const t=e.touches[0];drag.current={active:true,startX:t.pageX-el.offsetLeft,scrollLeft:el.scrollLeft,moved:false};},[]);
  const onTouchMove=useCallback(e=>{if(!drag.current.active)return;const el=ref.current;if(!el)return;const t=e.touches[0],x=t.pageX-el.offsetLeft,walk=(x-drag.current.startX)*1.2;if(Math.abs(walk)>4)drag.current.moved=true;el.scrollLeft=drag.current.scrollLeft-walk;},[]);
  const onTouchEnd=useCallback(()=>{drag.current.active=false;},[]);
  useEffect(()=>{window.addEventListener("mouseup",onMouseUp);return()=>window.removeEventListener("mouseup",onMouseUp);},[onMouseUp]);
  return {ref, dragHandlers:{onMouseDown,onMouseMove,onMouseUp,onTouchStart,onTouchMove,onTouchEnd}, wasDragging:()=>drag.current.moved};
}

// ── useCVSwipe ────────────────────────────────────────────────────────────────
function useCVSwipe(onSwipeLeft) {
  const ref=useRef(null), touch=useRef(null);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const onTS=e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};};
    const onTE=e=>{if(!touch.current)return;const dx=touch.current.x-e.changedTouches[0].clientX,dy=Math.abs(touch.current.y-e.changedTouches[0].clientY);if(dx>60&&dy<60)onSwipeLeft();touch.current=null;};
    el.addEventListener("touchstart",onTS,{passive:true}); el.addEventListener("touchend",onTE,{passive:true});
    return()=>{el.removeEventListener("touchstart",onTS);el.removeEventListener("touchend",onTE);};
  },[onSwipeLeft]);
  return ref;
}

// ── CertModal (fullscreen viewer) ─────────────────────────────────────────────
function CertModal({cert,onClose}) {
  useEffect(()=>{
    if(!cert)return;
    const h=e=>{if(e.key==="Escape")onClose();};
    const shell=document.getElementById("page-shell");
    window.addEventListener("keydown",h);
    if(shell) shell.style.overflow="hidden";
    return()=>{
      window.removeEventListener("keydown",h);
      if(shell) shell.style.overflow="";
    };
  },[cert,onClose]);
  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:950,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(6px)",opacity:cert?1:0,pointerEvents:cert?"auto":"none",transition:"opacity 260ms ease"}} />
      <div style={{position:"fixed",top:"50%",left:"50%",zIndex:960,transform:cert?"translate(-50%,-50%) scale(1)":"translate(-50%,-50%) scale(0.88)",width:"min(720px,96vw)",maxHeight:"88vh",background:"linear-gradient(160deg,#f5ead6 0%,#ede0c4 30%,#e8d9b8 60%,#dfd0aa 100%)",borderRadius:"10px",boxShadow:"0 40px 100px rgba(0,0,0,0.7),0 4px 20px rgba(0,0,0,0.4)",opacity:cert?1:0,pointerEvents:cert?"auto":"none",transition:"opacity 280ms ease,transform 300ms cubic-bezier(0.34,1.2,0.64,1)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:1,backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E")`,backgroundRepeat:"repeat",opacity:0.6}} />
        <div style={{position:"relative",zIndex:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1rem",padding:"0.9rem 1.1rem 0.8rem",borderBottom:"1px solid rgba(139,100,50,0.2)"}}>
          <div style={{minWidth:0}}>
            <p style={{margin:0,fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.74rem",letterSpacing:"0.3em",textTransform:"uppercase",color:"rgba(100,65,15,0.55)"}}>Certificate</p>
            <p style={{margin:"0.2rem 0 0",fontFamily:"Georgia,serif",fontSize:"0.8rem",color:"rgba(70,45,12,0.82)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cert?.title||"Certificate"}</p>
          </div>
          <button onClick={onClose} style={{display:"inline-flex",alignItems:"center",gap:"0.55rem",background:"rgba(90,60,20,0.12)",border:"1px solid rgba(139,100,50,0.36)",borderRadius:"9999px",padding:"0.5rem 0.95rem",fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.24em",textTransform:"uppercase",color:"rgba(80,50,10,0.9)",cursor:"pointer",boxShadow:"0 8px 20px rgba(90,60,20,0.12)",transition:"transform 180ms ease,background 180ms ease,border-color 180ms ease"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.background="rgba(139,100,50,0.2)";e.currentTarget.style.borderColor="rgba(139,100,50,0.6)";}} onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.background="rgba(90,60,20,0.12)";e.currentTarget.style.borderColor="rgba(139,100,50,0.36)";}}>Back</button>
        </div>
        <div style={{position:"relative",zIndex:5,padding:"0.85rem 1rem 1rem",overflow:"auto"}}>
          <div style={{borderRadius:"6px",border:"1px solid rgba(139,100,50,0.22)",overflow:"hidden",background:"#fff",boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
            {cert?.src?.toLowerCase().endsWith(".pdf")
              ? <iframe src={`${cert.src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={cert.title} style={{display:"block",width:"100%",height:"min(72vh,760px)",border:"none"}} />
              : <img src={cert?.src} alt={cert?.title} style={{display:"block",width:"100%",height:"auto",maxHeight:"55vh",objectFit:"contain"}} />
            }
          </div>
        </div>
      </div>
    </>
  );
}

// ── CV Pages ──────────────────────────────────────────────────────────────────
const CV_PERSONAL_DETAILS = [
  {label:"Nama",value:"Thoriq Alfath"},
  {label:"NIM",value:"2302020007"},
  {label:"Tempat, Tanggal Lahir",value:"Bekasi, 11 Maret 2005"},
  {label:"Jenis Kelamin",value:"Laki-Laki"},
  {label:"Agama",value:"Islam"},
  {label:"Kewarganegaraan",value:"Indonesia"},
  {label:"Pekerjaan",value:"Mahasiswa"},
  {label:"Surel",value:"alfathsaki22@gmail.com"},
  {label:"Telepon",value:"0857 1609 1606"},
  {label:"Alamat sesuai KTP",value:"Jl Incinerator No 2 RT 3 RW 3, Kel. Pulau Untung Jawa, Kec. Kepulauan Seribu Selatan, DKI Jakarta Utara 14510"},
  {label:"Alamat tinggal saat ini",value:"Jl Incinerator No 2 RT 3 RW 3, Kel. Pulau Untung Jawa, Kec. Kepulauan Seribu Selatan, DKI Jakarta Utara 14510"},
];

const CV_FORMAL_EDUCATION = [
  {role:"SD / MI Miftahul Amal",place:"2011 - 2017",bullets:["Menyelesaikan pendidikan dasar."]},
  {role:"SMP / Paket B Citra Bangsa",place:"2017 - 2020",bullets:["Menyelesaikan pendidikan menengah pertama."]},
  {role:"SMA / Paket C Citra Bangsa",place:"2020 - 2023",bullets:["Menyelesaikan pendidikan menengah atas."]},
  {role:"Universitas Saintek Muhammadiyah",place:"2023 - Sekarang",bullets:["Mahasiswa jurusan Film dan Televisi."]},
];

const CV_CREATIVE_EXPERIENCE = [
  {
    role:"Editing & Post-Production",
    place:"Adobe After Effects · Motion / VFX",
    bullets:[
      "Mengerjakan editing video dengan fokus pada ritme, transisi, dan cinematic storytelling.",
      "Membuat compositing, motion treatment, dan VFX sederhana menggunakan Adobe After Effects.",
      "Menyiapkan hasil akhir visual untuk kebutuhan kampus, portofolio, dan konten digital.",
    ],
  },
  {
    role:"Photography & Visual Capture",
    place:"Lightroom · Photoshop · Camera Angle",
    bullets:[
      "Memotret still image dan visual reference dengan perhatian pada framing, lighting, dan mood.",
      "Melakukan color correction, retouching, dan tone building menggunakan Adobe Lightroom dan Photoshop.",
      "Memahami teknik camera angle untuk mendukung narasi visual yang lebih kuat.",
    ],
  },
  {
    role:"Website Maker & Logo Design",
    place:"Freelance / Project Support",
    bullets:[
      "Membuat website sederhana dan desain logo untuk kebutuhan branding dan presentasi karya.",
      "Menggabungkan visual design dan basic coding agar tampilan hasil lebih rapi dan menarik.",
    ],
  },
  {
    role:"Discord Server Moderator",
    place:"Community Support",
    bullets:[
      "Menjaga komunitas tetap tertata, aktif, dan nyaman untuk anggota server.",
      "Membantu koordinasi rules, komunikasi, dan operasional dasar server Discord.",
    ],
  },
];

const CV_PROJECTS = [
  {
    role:"Minecraft Server",
    place:"Community / Server Project",
    bullets:[
      "Terlibat dalam pengembangan dan pengelolaan server Minecraft berbasis komunitas.",
      "Membantu kebutuhan kreatif, konsep pengalaman pemain, dan pengaturan presentasi server.",
    ],
  },
  {
    role:"Script Writing & Cinematography",
    place:"Creative Writing / Visual Planning",
    bullets:[
      "Menulis konsep naskah, urutan adegan, dan visual treatment untuk kebutuhan karya film.",
      "Menyusun ide sinematografi agar alur visual terasa lebih terarah dan sinematik.",
    ],
  },
  {
    role:"Campus Short Movie",
    place:"Film dan Televisi",
    bullets:[
      "Terlibat dalam produksi film pendek kampus sebagai bagian dari eksplorasi media dan storytelling.",
      "Mengerjakan proses kreatif dari pengembangan ide sampai presentasi hasil visual.",
    ],
  },
];

const CV_LANGUAGE_SKILLS = ["Inggris aktif","Jerman pasif","Jepang pasif","Indonesia aktif"];
const CV_TECHNICAL_SKILLS = [
  "Microsoft Word",
  "Microsoft Excel",
  "PowerPoint",
  "Adobe Photoshop",
  "Adobe Lightroom",
  "Adobe After Effects",
  "Canva",
  "C#",
  "PHP",
  "Web Design Maker",
  "C++",
  "Desktop Programming",
  "Teknik Camera Angle",
];

const CV_ORGANIZATION_EXPERIENCE = [
  {role:"Panitia Kelulusan Paket B",place:"2011 - 2023",bullets:["Terlibat dalam dukungan kegiatan kelulusan tingkat SMP / Paket B."]},
  {role:"Panitia Kelulusan Paket C",place:"2011 - 2023",bullets:["Membantu kebutuhan kegiatan kelulusan tingkat SMA / Paket C."]},
  {role:"Aktivitas Kampus",place:"2023 - Sekarang",bullets:["Aktif mengikuti kegiatan akademik dan pengembangan diri di lingkungan Film dan Televisi."]},
];

const CV_PAGES = [
  {
    id:"header",
    render:()=>(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:"1rem"}}>
        <p style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.58rem",letterSpacing:"0.5em",textTransform:"uppercase",color:"rgba(100,70,30,0.55)",marginBottom:"0.1rem"}}>Curriculum Vitae</p>
        <h1 style={{fontFamily:"'Palatino Linotype',Palatino,'Book Antiqua',serif",fontSize:"clamp(1.7rem,5.5vw,2.6rem)",fontWeight:700,letterSpacing:"0.14em",color:"#3b2408",lineHeight:1.05,textAlign:"center",margin:0}}>Thoriq Alfath</h1>
        <p style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.82rem",color:"rgba(70,45,12,0.8)",letterSpacing:"0.08em",textAlign:"center",margin:"-0.15rem 0 0"}}>Mahasiswa Film dan Televisi · NIM 2302020007</p>
        <p style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.88rem",color:"rgba(70,45,12,0.82)",letterSpacing:"0.1em",textAlign:"center",margin:0}}>Visual Storyteller · Creative Director · Photographer   </p>
        <p style={{fontFamily:"Georgia,serif",fontSize:"0.76rem",color:"rgba(80,55,20,0.72)",lineHeight:1.75,textAlign:"center",maxWidth:"28rem",margin:"0.1rem 0 0.2rem"}}>Editor, photographer, dan visual storyteller yang berfokus pada cinematic editing, visual capture, script writing, serta VFX compositing menggunakan Adobe After Effects.</p>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"0.3rem 0.5rem"}}>
          {["Editing","Photography","VFX","Adobe After Effects","Cinematography","Script Writing","Film & Television"].map(t=>(
            <span key={t} style={{fontFamily:"Georgia,serif",fontSize:"0.65rem",color:"rgba(60,38,8,0.75)",border:"1px solid rgba(139,100,50,0.32)",borderRadius:"3px",padding:"0.18rem 0.55rem",background:"rgba(255,255,255,0.28)",letterSpacing:"0.04em"}}>{t}</span>
          ))}
        </div>
        <div style={{color:"rgba(139,100,50,0.35)",fontSize:"0.85rem",letterSpacing:"0.7em"}}>✦ ✦ ✦</div>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"0.3rem 0.1rem"}}>
          {[{label:"Surel",href:"mailto:alfathsaki22@gmail.com",display:"alfathsaki22@gmail.com"},{label:"Telepon",href:null,display:"0857 1609 1606"},{label:"Domisili",href:null,display:"Jakarta, Indonesia"}].map(({label,href,display},i,arr)=>(
            <span key={label} style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",fontFamily:"Georgia,serif",fontSize:"0.68rem",color:"rgba(80,55,20,0.65)"}}>
              <span style={{fontSize:"0.56rem",letterSpacing:"0.22em",textTransform:"uppercase",color:"rgba(139,100,50,0.55)"}}>{label}</span>
              {href?<a href={href} target="_blank" rel="noreferrer" style={{color:"rgba(120,75,18,0.85)",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"2px"}}>{display}</a>:<span>{display}</span>}
              {i<arr.length-1&&<span style={{color:"rgba(139,100,50,0.3)",marginLeft:"0.3rem"}}>·</span>}
            </span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id:"experience",
    render:()=>(
      <div style={{height:"100%",display:"flex",flexDirection:"column",justifyContent:"center"}}>
        <CVSection title="Experience">
          <CVEntry role="Senior Frontend Developer" place="Studio Whatever · 2022–Present" bullets={["Led redesign of core product, improving load time by 40%.","Built reusable React component library used across 3 products.","Mentored 2 junior devs through code review and pair programming."]}/>
          <CVEntry role="UI / UX Developer" place="Agency Co. · 2020–2022" bullets={["Delivered 12+ client sites on time and under budget.","Introduced animation system reducing onboarding friction by 25%."]}/>
        </CVSection>
      </div>
    ),
  },
  {
    id:"skills",
    render:()=>(
      <div style={{height:"100%",display:"flex",flexDirection:"column",justifyContent:"center"}}>
        <CVSection title="Skills">
          <div style={{display:"flex",flexWrap:"wrap",gap:"0.5rem 0.8rem"}}>
            {["React","TypeScript","Node.js","CSS / Tailwind","Figma","Three.js","PostgreSQL","Docker"].map(s=>(
              <span key={s} style={{fontFamily:"Georgia,serif",fontSize:"0.78rem",color:"rgba(60,40,10,0.8)",border:"1px solid rgba(139,100,50,0.38)",borderRadius:"3px",padding:"0.28rem 0.7rem",background:"rgba(255,255,255,0.3)"}}>{s}</span>
            ))}
          </div>
        </CVSection>
        <CVSection title="Education" style={{marginTop:"2rem"}}>
          <CVEntry role="B.Sc. Computer Science" place="University of Somewhere · 2016–2020" bullets={["Graduated with honours.","Thesis on real-time collaborative editing systems."]}/>
        </CVSection>
      </div>
    ),
  },
  {
    id:"projects",
    render:()=>(
      <div style={{height:"100%",display:"flex",flexDirection:"column",justifyContent:"center"}}>
        <CVSection title="Projects">
          <CVEntry role="Portfolio Site" place="2024 — React + Vite" bullets={["Interactive film-strip UI with live Steam inventory feed."]}/>
          <CVEntry role="Open Source Library" place="2023 — TypeScript" bullets={["4 k+ GitHub stars. Drag-to-scroll utilities for React."]}/>
        </CVSection>
        <div style={{marginTop:"auto",paddingTop:"2rem",width:"100%",display:"grid",justifyItems:"center"}}>
          <div style={{width:"100%",height:"1px",background:"linear-gradient(90deg,transparent,rgba(139,100,50,0.4),transparent)",marginBottom:"1rem"}}/>
          <p style={{width:"100%",fontFamily:"Georgia,serif",fontSize:"0.58rem",textAlign:"center",color:"rgba(100,70,30,0.4)",letterSpacing:"0.3em",textTransform:"uppercase"}}>References available upon request</p>
        </div>
      </div>
    ),
  },
];

// ── CVPaper ───────────────────────────────────────────────────────────────────
const PORTFOLIO_PAGES = [
  {
    id:"cover",
    render:() => (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:"1rem",textAlign:"center"}}>
        <p style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.58rem",letterSpacing:"0.5em",textTransform:"uppercase",color:"rgba(100,70,30,0.55)",marginBottom:"0.1rem"}}>Curriculum Vitae</p>
        <h1 style={{fontFamily:"'Palatino Linotype',Palatino,'Book Antiqua',serif",fontSize:"clamp(1.8rem,5.4vw,2.8rem)",fontWeight:700,letterSpacing:"0.14em",color:"#3b2408",lineHeight:1.05,margin:0}}>Thoriq Alfath</h1>
        <p style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.9rem",color:"rgba(70,45,12,0.82)",letterSpacing:"0.08em",margin:0}}>Mahasiswa Film dan Televisi - NIM 2302020007</p>
        <p style={{fontFamily:"Georgia,serif",fontSize:"0.78rem",color:"rgba(80,55,20,0.72)",lineHeight:1.8,maxWidth:"28rem",margin:"0.1rem 0 0.2rem"}}>
          Editor, photographer, dan visual storyteller yang berfokus pada cinematic editing, visual capture,
          script writing, serta VFX compositing menggunakan Adobe After Effects.
        </p>
        <CVChipList items={["Editing","Photography","VFX","Adobe After Effects","Cinematography","Script Writing","Film & Television"]}/>
        <div style={{color:"rgba(139,100,50,0.35)",fontSize:"0.85rem",letterSpacing:"0.7em"}}>* * *</div>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"0.4rem 0.7rem"}}>
          {[
            {label:"Surel",value:"alfathsaki22@gmail.com"},
            {label:"Telepon",value:"0857 1609 1606"},
            {label:"Domisili",value:"Jakarta, Indonesia"},
          ].map(({label,value})=>(
            <span key={label} style={{fontFamily:"Georgia,serif",fontSize:"0.7rem",color:"rgba(80,55,20,0.7)"}}>
              <span style={{fontSize:"0.56rem",letterSpacing:"0.22em",textTransform:"uppercase",color:"rgba(139,100,50,0.55)"}}>{label}</span>
              <span style={{marginLeft:"0.35rem"}}>{value}</span>
            </span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id:"personal",
    render:() => (
      <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
        <CVSection title="Data Pribadi">
          <CVFactTable items={CV_PERSONAL_DETAILS}/>
        </CVSection>
        <CVSection title="Ringkasan">
          <p style={{margin:0,fontFamily:"Georgia,serif",fontSize:"0.82rem",color:"rgba(55,35,10,0.8)",lineHeight:1.85}}>
            Saat ini aktif menempuh studi Film dan Televisi sambil memperkuat kemampuan di bidang editing, photography,
            motion treatment, VFX, dan media visual. Terbiasa mengolah materi dari tahap ide, penulisan, pengambilan gambar,
            sampai tahap finishing untuk kebutuhan karya dan presentasi visual.
          </p>
        </CVSection>
      </div>
    ),
  },
  {
    id:"experience",
    render:() => (
      <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
        <CVSection title="Experience">
          {CV_CREATIVE_EXPERIENCE.map((entry)=>(
            <CVEntry key={entry.role} role={entry.role} place={entry.place} bullets={entry.bullets}/>
          ))}
        </CVSection>
      </div>
    ),
  },
  {
    id:"projects",
    render:() => (
      <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
        <CVSection title="Projects">
          {CV_PROJECTS.map((entry)=>(
            <CVEntry key={entry.role} role={entry.role} place={entry.place} bullets={entry.bullets}/>
          ))}
        </CVSection>
      </div>
    ),
  },
  {
    id:"education",
    render:() => (
      <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
        <CVSection title="Pendidikan Formal">
          {CV_FORMAL_EDUCATION.map((entry)=>(
            <CVEntry key={`${entry.role}-${entry.place}`} role={entry.role} place={entry.place} bullets={entry.bullets}/>
          ))}
        </CVSection>
        <CVSection title="Bahasa">
          <CVChipList items={CV_LANGUAGE_SKILLS}/>
        </CVSection>
      </div>
    ),
  },
  {
    id:"skills",
    render:() => (
      <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
        <CVSection title="Kemampuan Teknis">
          <CVChipList items={CV_TECHNICAL_SKILLS}/>
        </CVSection>
        <CVSection title="Pengalaman Organisasi">
          {CV_ORGANIZATION_EXPERIENCE.map((entry)=>(
            <CVEntry key={`${entry.role}-${entry.place}`} role={entry.role} place={entry.place} bullets={entry.bullets}/>
          ))}
        </CVSection>
        <div style={{marginTop:"auto",paddingTop:"1.2rem"}}>
          <div style={{width:"100%",height:"1px",background:"linear-gradient(90deg,transparent,rgba(139,100,50,0.4),transparent)",marginBottom:"1rem"}}/>
          <p style={{margin:0,fontFamily:"Georgia,serif",fontSize:"0.76rem",color:"rgba(55,35,10,0.78)",lineHeight:1.8}}>
            Daftar riwayat hidup ini saya buat dengan sebenar-benarnya, semoga dapat digunakan sebagaimana mestinya.
          </p>
          <p style={{margin:"1rem 0 0",fontFamily:"Georgia,serif",fontSize:"0.74rem",color:"rgba(100,70,30,0.7)",textAlign:"right"}}>
            Jakarta, 11 Maret 2026
          </p>
        </div>
      </div>
    ),
  },
];

function CVPaper({open,onClose}) {
  const [page,setPage]=useState(0),[dir,setDir]=useState(1),[animating,setAnimating]=useState(false),[displayPage,setDisplayPage]=useState(0);
  const total=PORTFOLIO_PAGES.length;
  useEffect(()=>{
    const shell=document.getElementById("page-shell");
    if(open){
      setPage(0);setDisplayPage(0);
      document.body.style.overflow="hidden";
      document.body.style.touchAction="none";
      document.documentElement.style.overflow="hidden";
      if(shell) shell.style.overflow="hidden";
    } else {
      document.body.style.overflow="";
      document.body.style.touchAction="";
      document.documentElement.style.overflow="";
      if(shell) shell.style.overflow="";
    }
  },[open]);
  useEffect(()=>()=>{document.body.style.overflow="";document.body.style.touchAction="";document.documentElement.style.overflow="";const shell=document.getElementById("page-shell");if(shell) shell.style.overflow="";},[]);
  const goTo=useCallback((next,direction)=>{if(animating)return;setDir(direction);setAnimating(true);setTimeout(()=>{setDisplayPage(next);setPage(next);setAnimating(false);},320);},[animating]);
  const goNext=useCallback(()=>{if(page<total-1)goTo(page+1,1);},[page,total,goTo]);
  const goPrev=useCallback(()=>{if(page>0)goTo(page-1,-1);},[page,goTo]);
  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(e.key==="ArrowRight")goNext();if(e.key==="ArrowLeft")goPrev();if(e.key==="Escape")onClose();};
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[open,goNext,goPrev,onClose]);
  const tRef=useRef(null);
  const onTS=e=>{tRef.current={x:e.touches[0].clientX};};
  const onTE=e=>{if(!tRef.current)return;const dx=tRef.current.x-e.changedTouches[0].clientX;if(dx>50)goNext();if(dx<-50)goPrev();tRef.current=null;};
  const ss={transform:animating?`translateX(${dir*-40}px)`:"translateX(0)",opacity:animating?0:1,transition:animating?"transform 280ms cubic-bezier(0.4,0,1,1),opacity 200ms ease":"transform 300ms cubic-bezier(0,0,0.2,1),opacity 260ms ease"};

  return (
    <>
      {/* Full-screen dark backdrop — hides everything behind CV */}
      <div style={{
        position:"fixed",inset:0,zIndex:800,
        background:"rgba(0,0,0,0.92)",
        opacity:open?1:0,
        pointerEvents:open?"auto":"none",
        transition:"opacity 400ms ease",
      }}/>
      {/* Back button — fixed top-left of the screen */}
      {/* CV Paper — centered card sliding up from below */}
      <div onTouchStart={onTS} onTouchEnd={onTE} style={{
        position:"fixed",
        top:"50%",left:"50%",
        zIndex:810,
        width:"min(760px,96vw)",
        height:"min(840px,92vh)",
        transform:open?"translate(-50%,-50%) scale(1)":"translate(-50%,-44%) scale(0.96)",
        opacity:open?1:0,
        pointerEvents:open?"auto":"none",
        transition:"transform 420ms cubic-bezier(0.34,1.1,0.64,1),opacity 350ms ease",
        overflow:"hidden",display:"flex",flexDirection:"column",
        background:"linear-gradient(160deg,#f5ead6 0%,#ede0c4 30%,#e8d9b8 60%,#dfd0aa 100%)",
        borderRadius:"12px",
        boxShadow:"0 40px 120px rgba(0,0,0,0.8),0 8px 30px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.4)",
      }}>
        {/* Paper texture */}
        <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:1,backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E")`,backgroundRepeat:"repeat",opacity:0.6}}/>
        {/* Right shadow edge */}
        <div style={{position:"absolute",top:0,right:0,bottom:0,width:"18px",background:"linear-gradient(270deg,rgba(80,50,20,0.18) 0%,transparent 100%)",pointerEvents:"none",zIndex:2}}/>
        {/* Header: ‹ back · dots · page counter */}
        <div style={{position:"relative",zIndex:10,display:"flex",alignItems:"center",gap:"0.9rem",padding:"1rem 1.1rem 0.75rem",borderBottom:"1px solid rgba(139,100,50,0.2)",flexShrink:0}}>
          {/* ‹ back — right next to dots */}
          <button onClick={onClose} aria-label="Back" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"0.55rem",minWidth:"11.75rem",border:"1px solid rgba(139,100,50,0.4)",background:`rgba(255,255,255,0.32) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='60' viewBox='0 0 280 60'%3E%3Ctext x='42' y='39' font-family='Arial, sans-serif' font-size='24' font-weight='700' fill='%2350320a'%3E%26lt%3B BACK%3C/text%3E%3C/svg%3E") center / 82% auto no-repeat`,borderRadius:"9999px",padding:"0.8rem 1.25rem",cursor:"pointer",fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0",fontWeight:700,letterSpacing:"0.26em",textTransform:"uppercase",color:"transparent",textIndent:"-9999px",boxShadow:"0 10px 24px rgba(90,60,20,0.14)",flexShrink:0,transition:"transform 180ms ease,background 180ms ease,border-color 180ms ease"}}
            onMouseEnter={e=>e.currentTarget.style.color="rgba(80,50,10,1)"} onMouseLeave={e=>e.currentTarget.style.color="rgba(80,50,10,0.6)"}>‹</button>
          {/* Dot nav */}
          <div style={{display:"flex",gap:"0.4rem",alignItems:"center",flexWrap:"wrap"}}>
            {PORTFOLIO_PAGES.map((_,i)=><button key={i} onClick={()=>goTo(i,i>page?1:-1)} style={{width:i===page?"1.4rem":"0.45rem",height:"0.45rem",borderRadius:"9999px",background:i===page?"rgba(100,65,15,0.75)":"rgba(139,100,50,0.3)",border:"none",padding:0,cursor:"pointer",transition:"width 280ms ease,background 200ms ease"}}/>)}
          </div>
        </div>
        {/* Page content */}
        <div style={{flex:1,position:"relative",zIndex:5,overflow:"hidden"}}>
          <div style={{...ss,padding:"clamp(1.35rem,3vw,2rem) clamp(1.15rem,3vw,2.5rem) clamp(1rem,2.4vw,1.5rem)",height:"100%",boxSizing:"border-box",overflowY:"auto",paddingRight:"clamp(0.65rem,1.6vw,1rem)"}}>
            {PORTFOLIO_PAGES[displayPage]?.render()}
          </div>
        </div>
        {/* Footer: ‹ Page N / total › */}
        <div style={{position:"relative",zIndex:10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",gap:"1.5rem",padding:"0.8rem 1.5rem 1.2rem",borderTop:"1px solid rgba(139,100,50,0.2)"}}>
          <NavBtn fn={goPrev} icon="<" dis={page===0}/>
          <span style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.68rem",letterSpacing:"0.32em",textTransform:"uppercase",color:"rgba(100,65,15,0.7)",minWidth:"8rem",textAlign:"center"}}>Page {page+1} / {total}</span>
          <NavBtn fn={goNext} icon=">" dis={page===total-1}/>
        </div>
      </div>
    </>
  );
}
function NavBtn({fn,icon,dis}){
  return <button onClick={fn} disabled={dis} style={{width:"3rem",height:"3rem",borderRadius:"9999px",border:`1px solid ${dis?"rgba(139,100,50,0.15)":"rgba(139,100,50,0.52)"}`,background:dis?"rgba(139,100,50,0.05)":"rgba(255,255,255,0.28)",color:dis?"rgba(139,100,50,0.25)":"rgba(80,50,10,0.92)",cursor:dis?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",fontWeight:700,lineHeight:1,boxShadow:dis?"none":"0 10px 24px rgba(90,60,20,0.12)",transition:"all 200ms ease"}}
    onMouseEnter={e=>{if(!dis){e.currentTarget.style.background="rgba(255,255,255,0.42)";e.currentTarget.style.transform="translateY(-1px)";}}} onMouseLeave={e=>{if(!dis){e.currentTarget.style.background="rgba(255,255,255,0.28)";e.currentTarget.style.transform="translateY(0)";}}}>{icon}</button>;
}
function CVSection({title,children}){
  return <div style={{marginBottom:"2rem"}}>
    <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
      <h2 style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.7rem",fontWeight:700,letterSpacing:"0.42em",textTransform:"uppercase",color:"rgba(100,65,15,0.8)",whiteSpace:"nowrap"}}>{title}</h2>
      <div style={{flex:1,height:"1px",background:"rgba(139,100,50,0.35)"}}/>
    </div>
    {children}
  </div>;
}
function CVEntry({role,place,bullets}){
  return <div style={{marginBottom:"1.25rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:"0.1rem 0.5rem",marginBottom:"0.35rem"}}>
      <span style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.95rem",fontWeight:700,color:"#3b2408"}}>{role}</span>
      <span style={{fontFamily:"Georgia,serif",fontSize:"0.76rem",color:"rgba(100,70,30,0.65)",fontStyle:"italic"}}>{place}</span>
    </div>
    <ul style={{margin:0,paddingLeft:"1.1rem"}}>{bullets.map((b,i)=><li key={i} style={{fontFamily:"Georgia,serif",fontSize:"0.82rem",color:"rgba(55,35,10,0.8)",lineHeight:1.75,marginBottom:"0.15rem"}}>{b}</li>)}</ul>
  </div>;
}

// ── CertPanelRail — renders inside the shared image panel slot ────────────────
function CVFactTable({items}){
  return <div style={{display:"grid",gap:"0.65rem"}}>
    {items.map(({label,value})=>(
      <div key={label} style={{display:"grid",gridTemplateColumns:"minmax(9rem,11.5rem) minmax(0,1fr)",gap:"0.75rem",alignItems:"start"}}>
        <span style={{fontFamily:"'Palatino Linotype',Palatino,serif",fontSize:"0.72rem",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(100,65,15,0.72)"}}>{label}</span>
        <span style={{fontFamily:"Georgia,serif",fontSize:"0.82rem",color:"rgba(55,35,10,0.82)",lineHeight:1.7}}>{value}</span>
      </div>
    ))}
  </div>;
}
function CVChipList({items}){
  return <div style={{display:"flex",flexWrap:"wrap",gap:"0.45rem 0.6rem"}}>
    {items.map((item)=>(
      <span key={item} style={{fontFamily:"Georgia,serif",fontSize:"0.72rem",color:"rgba(60,40,10,0.82)",border:"1px solid rgba(139,100,50,0.34)",borderRadius:"9999px",padding:"0.22rem 0.7rem",background:"rgba(255,255,255,0.3)",lineHeight:1.4}}>{item}</span>
    ))}
  </div>;
}

function CertPanelRail({onOpenCert}) {
  if(CERTIFICATES.length===0) return(
    <p style={{fontFamily:"Georgia,serif",fontSize:"0.72rem",color:"rgba(134,239,172,0.4)",padding:"1rem",fontStyle:"italic"}}>No certificates found. Add PDFs to src/assets/certificates/</p>
  );
  return(
    <>
      {CERTIFICATES.map((cert,i)=>(
        <button key={i} onClick={()=>onOpenCert(cert)}
          className="film-frame shrink-0 snap-start"
          style={{background:"#fff",border:"1px solid rgba(134,239,172,0.18)",borderRadius:"1rem",overflow:"hidden",cursor:"pointer",padding:0,transition:"transform 200ms ease,border-color 200ms ease,box-shadow 200ms ease"}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor="rgba(134,239,172,0.55)";e.currentTarget.style.boxShadow="0 10px 28px rgba(0,0,0,0.35)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.borderColor="rgba(134,239,172,0.18)";e.currentTarget.style.boxShadow="none";}}>
          <div style={{position:"relative",width:"100%",height:"100%",overflow:"hidden",background:"#f5f5f0"}}>
            <iframe
              src={`${cert.src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              title={`cert-${i}`}
              style={{position:"absolute",top:0,left:0,width:"250%",height:"250%",border:"none",transform:"scale(0.4)",transformOrigin:"top left",pointerEvents:"none"}}
              loading="lazy"
            />
            <div style={{position:"absolute",bottom:0,left:0,right:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.4rem 0.6rem",background:"linear-gradient(0deg,rgba(0,0,0,0.6),transparent)"}}>
              <span style={{fontSize:"10px",textTransform:"uppercase",letterSpacing:"0.28em",color:"rgba(255,255,255,0.55)"}}>Cert {String(i+1).padStart(2,"0")}</span>
              <span style={{width:"0.5rem",height:"0.5rem",borderRadius:"9999px",background:"rgb(134,239,172)",boxShadow:"0 0 14px rgba(134,239,172,0.8)",display:"inline-block"}}/>
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

// ── Certificate Slide Section — kept only for legacy, now unused ──────────────
function CertSlideSection({visible,onClose}) { return null; }


// ── Main ──────────────────────────────────────────────────────────────────────
export default function FilmStrip() {
  const {items,loading,source}=useSteamItems();
  const [menuOpen,setMenuOpen]=useState(false);
  const [view,setView]=useState("idle");
  const [showPanel, setShowPanel] = useState(false);
  const [activeCert,setActiveCert]=useState(null);
  // CV: 0=hidden, 1=cert orb visible (click1), 2=CV paper open (click2)
  const [cvStep,setCvStep]=useState(0);
  const [certSlideOpen,setCertSlideOpen]=useState(false);
  const {ref:railRef,dragHandlers,wasDragging}=useDragScroll();

  const cvOpen = cvStep===2;
  const certOrbVisible = cvStep>=1;

  const openPanel=useCallback((nextView)=>{
    setMenuOpen(false);
    setView(nextView);
    window.setTimeout(()=>setShowPanel(true),80);
  },[]);
  const closePanel=useCallback(()=>{
    setShowPanel(false);
    setCertSlideOpen(false);
    window.setTimeout(()=>{setView("idle");setMenuOpen(false);},320);
  },[]);
  const openCV=useCallback(()=>{
    closePanel();
    setCvStep(2);
  },[closePanel]);
  const closeCV=useCallback(()=>setCvStep(0),[]);
  const handleWheel=e=>{const rail=railRef.current;if(!rail)return;if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();rail.scrollBy({left:e.deltaY,behavior:"auto"});}};
  const handleOpenCertificate=useCallback((cert)=>{
    closePanel();
    setActiveCert(cert);
  },[closePanel]);

  const handleCVOrbClick=useCallback(()=>{
    if(cvStep===0){setCvStep(1);if(certSlideOpen){closePanel();setCertSlideOpen(false);}}
    else if(cvStep===1){openCV();}
  },[cvStep,certSlideOpen,closePanel,openCV]);

  // cert orb click: open certs panel the same way games/projects open
  const handleCertOrbClick=useCallback(()=>{
    if(certSlideOpen){closePanel();setCertSlideOpen(false);}
    else{setCertSlideOpen(true);openPanel("certs");}
  },[certSlideOpen,closePanel,openPanel]);

  const filmReel=useMemo(()=>getImages(projectImages),[]);
  const workReel=useMemo(()=>getImages(gameImages),[]);
  const featuredFilmReel=filmReel.length?filmReel:workReel;
  const panelImages=view==="film"?featuredFilmReel:view==="projects"?workReel:[];
  const inventoryUnavailable=!loading&&!items.length;
  const inventoryLink=source==="csfloat"?CSFLOAT_STALL_URL:STEAM_INVENTORY_URL;
  const inventoryLinkLabel=source==="csfloat"?"Open CSFloat":"Open Inventory";
  const panelTitle=view==="film"?"Film":view==="projects"?"Projects":view==="certs"?"Certificates":source==="csfloat"?"CSFloat Stall":"Steam Inventory";
  const panelDesc=view==="steam"
    ? loading
      ? "Connecting to Steam and CSFloat to load the latest items."
      : inventoryUnavailable
      ? "Inventory is temporarily unavailable. Use the direct link while the feed reconnects."
      : source==="csfloat"
        ? "Steam is rate-limited right now, so this reel is using your public CSFloat stall."
        : "Live items from Steam. Click and drag to browse."
    : view==="certs"
      ? "Tap a certificate to open it fullscreen."
      : view==="film"
        ? "Local photo frames and cinematic stills are back in the reel. Click and drag to browse."
        : "Project visuals and artwork collected from the local gallery.";
  return (
    <section className="relative flex h-full w-full flex-col justify-start overflow-hidden bg-transparent px-3 py-3 select-none md:justify-center md:px-6 md:py-5">
      <CVPaper open={cvOpen} onClose={closeCV}/>
      <CertModal cert={activeCert} onClose={()=>setActiveCert(null)}/>

      {/* 1. ORB + CARDS */}
      <div style={{maxHeight:view==="idle"?"430px":"0px",opacity:view==="idle"?1:0,overflow:"hidden",transition:"max-height 320ms ease,opacity 220ms ease",pointerEvents:view==="idle"?"auto":"none"}}>
        <div className="flex w-full items-center justify-center gap-6 px-4 py-5 md:gap-14 md:py-6">
          <button type="button" onClick={()=>openPanel("film")} className="menu-card" style={{opacity:menuOpen?1:0,transform:menuOpen?"translateY(0) scale(1)":"translateY(16px) scale(0.82)",pointerEvents:menuOpen?"auto":"none",transition:"opacity 280ms ease,transform 340ms cubic-bezier(0.34,1.56,0.64,1)"}}>
            <span className="menu-card__badge">FL</span><span className="menu-card__title">Film</span><span className="menu-card__hint">open reel</span>
          </button>
          <div className="relative flex items-center justify-center">
            {menuOpen&&<span className="orb-glow"/>}
            <button type="button" onClick={()=>setMenuOpen(v=>!v)} className={`orb-button ${menuOpen?"orb-button--open":""}`}>
              <img src="/my-icon-transparent.png" alt="avatar" className="h-16 w-16 rounded-full border border-white/10 object-contain md:h-20 md:w-20"/>
            </button>
          </div>
          <button type="button" onClick={()=>openPanel("projects")} className="menu-card" style={{opacity:menuOpen?1:0,transform:menuOpen?"translateY(0) scale(1)":"translateY(16px) scale(0.82)",pointerEvents:menuOpen?"auto":"none",transition:"opacity 280ms ease 60ms,transform 340ms cubic-bezier(0.34,1.56,0.64,1) 60ms"}}>
            <span className="menu-card__badge">WK</span><span className="menu-card__title">Projects</span><span className="menu-card__hint">tap to open</span>
          </button>
        </div>
        {/* MY WORK — tight under the logo */}
        <div
          className="pointer-events-none flex justify-center px-4"
          style={{
            marginTop:"-1rem",
            maxHeight:menuOpen?"4rem":"0px",
            opacity:menuOpen?1:0,
            overflow:"hidden",
            paddingBottom:menuOpen?"0.75rem":"0px",
            transition:"max-height 280ms ease,opacity 220ms ease,padding-bottom 220ms ease",
          }}
        >
          <h2 className="mywork-title text-center text-2xl font-black uppercase tracking-[0.42em] md:text-3xl">MY WORK</h2>
        </div>
      </div>

      {/* 2. BACK — centered ^ when panel open */}

      {/* 3. IMAGE PANEL — film / projects / certs / steam */}
      <div style={{maxHeight:showPanel?"500px":"0px",opacity:showPanel?1:0,overflow:"hidden",transition:"max-height 380ms cubic-bezier(0.4,0,0.2,1),opacity 240ms ease",pointerEvents:view==="idle"?"none":"auto"}}>
        {view!=="idle"&&(
          <div className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-2 md:px-6">
            <div className="mb-3 flex flex-col items-center gap-2 text-center">
              <button type="button" onClick={closePanel} className="panel-back-btn" aria-label={`Close ${panelTitle}`}>
                <span className="panel-back-btn__label">Close</span>
              </button>
              <div className="min-w-0">
                <h3 className="panel-title">{panelTitle}</h3>
                <p className="panel-desc">{panelDesc}</p>
              </div>
            </div>
            <div className="relative">
              <div ref={railRef} onWheel={handleWheel} {...dragHandlers} className="film-panel-rail flex gap-3 overflow-x-auto px-1 pb-3 pt-1 md:gap-4" style={{cursor:"grab"}}>
                {view==="steam"
                  ? loading
                    ? <div className="steam-panel-empty">Connecting to the live inventory feed. If Steam is slow, this panel will try your public CSFloat listings next.</div>
                    : inventoryUnavailable
                      ? <div className="steam-panel-empty">The live inventory feed is unavailable right now. Use the button above to open it directly.</div>
                      : items.map((item,i)=><SteamPanelFrame key={`s-${i}`} item={item} index={i} wasDragging={wasDragging}/>)
                  : view==="certs"
                  ? <CertPanelRail onOpenCert={handleOpenCertificate}/>
                  : panelImages.map((src,i)=>(
                      <div key={`${view}-${i}`} className="film-frame shrink-0 snap-start">
                        <img src={src} alt={`${panelTitle} ${i+1}`} className="h-full w-full object-cover" draggable={false}/>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent"/>
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2">
                          <span className="text-[10px] uppercase tracking-[0.28em] text-white/55"> {String(i+1).padStart(2,"0")}</span>
                          <span className="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.8)]"/>
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. STEAM STRIP */}
      <div className="w-full pb-4">
        <div className="steam-strip-header">
          <span className="steam-strip-line"/>
          <button type="button" onClick={()=>openPanel("steam")} className="steam-strip-cta">
            <span className="steam-strip-cta__dot"/><span>{source==="csfloat"?"Inventory Reel":"Steam Inventory Reel"}</span>
          </button>
          <a href={inventoryLink} target="_blank" rel="noreferrer" className="steam-strip-link">{inventoryLinkLabel}</a>
          <span className="steam-strip-line"/>
        </div>
        <SteamStrip items={items} loading={loading} source={source}/>
      </div>

      {/* 7. CV + CERT ORB ROW */}
      <div className={`cv-section ${cvOpen?"cv-section--hidden":""}`}>
        {/* CV orb always centered; cert orb slides in to the right of it */}
        <div className="cv-orb-row">
          <div className="cv-side-orb cv-side-orb--left" style={{
            opacity:certOrbVisible?1:0,
            transform:certOrbVisible?"translateY(-50%) translateX(0) scale(1)":"translateY(-50%) translateX(-20px) scale(0.72)",
            pointerEvents:certOrbVisible?"auto":"none",
            transition:"opacity 400ms cubic-bezier(0.34,1.56,0.64,1),transform 440ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <a
              href={GIVEAWAY_CHANNEL_URL}
              target="_blank"
              rel="noreferrer"
              className="giveaway-orb"
              aria-label="Open Discord giveaway channel"
            >
              <span className="giveaway-orb__ring giveaway-orb__ring--1"/>
              <span className="giveaway-orb__ring giveaway-orb__ring--2"/>
              <span className="giveaway-orb__glow"/>
              <span className="giveaway-orb__inner">
                <span className="giveaway-orb__label">GIVEAWAY</span>
                <span className="giveaway-orb__sub">join discord</span>
              </span>
            </a>
          </div>
          {/* CV ORB — stays centered */}
          <div className="cv-orb-wrap">
            <button type="button" onClick={handleCVOrbClick} className="cv-orb" aria-label="Open CV">
              <span className="cv-orb__ring cv-orb__ring--1"/>
              <span className="cv-orb__ring cv-orb__ring--2"/>
              <span className="cv-orb__glow"/>
              <span className="cv-orb__inner">
                <span className="cv-orb__label">{cvStep===0?"Portofolio":"Portofolio"}</span>
                <span className="cv-orb__sub">{cvStep===0?"tap to view":cvStep===1?"open portofolio":"open now"}</span>
              </span>
            </button>
          </div>

          {/* CERT ORB — absolute, slides in from the right, doesn't move CV */}
          <div className="cv-side-orb cv-side-orb--right" style={{
            opacity:certOrbVisible?1:0,
            transform:certOrbVisible?"translateY(-50%) translateX(0) scale(1)":"translateY(-50%) translateX(20px) scale(0.72)",
            pointerEvents:certOrbVisible?"auto":"none",
            transition:"opacity 400ms cubic-bezier(0.34,1.56,0.64,1),transform 440ms cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <button type="button" onClick={handleCertOrbClick} className="cert-orb" aria-label="Toggle certificates">
              <span className="cert-orb__ring cert-orb__ring--1"/>
              <span className="cert-orb__ring cert-orb__ring--2"/>
              <span className="cert-orb__glow"/>
              <span className="cert-orb__inner" style={{borderColor:certSlideOpen?"rgba(134,239,172,0.72)":"rgba(134,239,172,0.3)"}}>
                <span className="cert-orb__label">{certSlideOpen?"CERTIFICATE":"CERTIFICATE"}</span>
                <span className="cert-orb__sub">{certSlideOpen?"close":"tap to view"}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cvAuraPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.5}50%{transform:translate(-50%,-50%) scale(1.12);opacity:.15}}
        @keyframes cvRingPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.6}50%{transform:translate(-50%,-50%) scale(1.08);opacity:.25}}
        @keyframes cvTextGlow{0%,100%{text-shadow:0 0 8px rgba(251,191,36,.6),0 0 20px rgba(245,158,11,.3)}50%{text-shadow:0 0 16px rgba(251,191,36,1),0 0 40px rgba(245,158,11,.7),0 0 60px rgba(251,191,36,.3)}}
        @keyframes cvSubGlow{0%,100%{opacity:.45}50%{opacity:.85}}
        @keyframes certTextGlow{0%,100%{text-shadow:0 0 8px rgba(134,239,172,.6),0 0 20px rgba(74,222,128,.3)}50%{text-shadow:0 0 16px rgba(134,239,172,1),0 0 40px rgba(74,222,128,.7)}}
        @keyframes certGlowPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.45}50%{transform:translate(-50%,-50%) scale(1.12);opacity:.12}}
        @keyframes giveawayTextGlow{0%,100%{text-shadow:0 0 8px rgba(165,180,252,.55),0 0 20px rgba(99,102,241,.25)}50%{text-shadow:0 0 16px rgba(199,210,254,.95),0 0 38px rgba(99,102,241,.55)}}
        @keyframes giveawayGlowPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.42}50%{transform:translate(-50%,-50%) scale(1.12);opacity:.14}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes scrollLeft{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        
        .mywork-title{background:linear-gradient(90deg,#f8fafc 0%,#38bdf8 35%,#e0f2fe 50%,#60a5fa 72%,#f8fafc 100%);background-size:220% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 3s linear infinite;filter:drop-shadow(0 0 10px rgba(56,189,248,.3))}
        .orb-glow{position:absolute;inset:-40px;border-radius:9999px;background:radial-gradient(circle,rgba(56,189,248,.2) 0%,rgba(56,189,248,.07) 45%,transparent 72%);pointer-events:none}
        .orb-button{position:relative;display:flex;height:6rem;width:6rem;align-items:center;justify-content:center;border-radius:9999px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.45);backdrop-filter:blur(16px);transition:transform 180ms ease,border-color 180ms ease,box-shadow 180ms ease}
        .orb-button:hover{transform:scale(1.05)}
        .orb-button--open{border-color:rgba(125,211,252,.65);box-shadow:0 0 24px rgba(56,189,248,.18)}
        .menu-card{display:flex;height:8rem;width:6.5rem;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;border-radius:1.25rem;border:1px solid rgba(186,230,253,.12);background:rgba(0,0,0,.48);backdrop-filter:blur(10px);transition:border-color 180ms ease,background-color 180ms ease}
        .menu-card:hover{border-color:rgba(125,211,252,.35);background:rgba(0,0,0,.6)}
        .menu-card__badge{display:grid;height:2.2rem;width:2.2rem;place-items:center;border-radius:9999px;background:rgba(56,189,248,.14);color:white;font-size:.72rem;font-weight:700;letter-spacing:.1em}
        .menu-card__title{color:white;font-size:.78rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
        .menu-card__hint{color:rgba(255,255,255,.4);font-size:9px;letter-spacing:.22em;text-transform:uppercase}
        .film-panel-rail{scroll-snap-type:x mandatory;scrollbar-width:none;-ms-overflow-style:none}
        .film-panel-rail::-webkit-scrollbar{display:none}
        .film-panel-rail:active{cursor:grabbing!important}
        .film-frame{position:relative;flex:0 0 clamp(150px,16vw,210px);height:clamp(184px,22vw,248px);overflow:hidden;border-radius:1rem;border:none;background:transparent;box-shadow:none}
        .panel-back-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.4rem;border:none;border-radius:9999px;background:rgba(56,189,248,.12);box-shadow:0 0 0 1px rgba(125,211,252,.24),0 10px 24px rgba(0,0,0,.18);padding:.55rem 1rem;transition:transform 180ms ease,background-color 180ms ease,box-shadow 180ms ease}
        .panel-back-btn:hover{transform:translateY(-1px);background:rgba(56,189,248,.22);box-shadow:0 0 0 1px rgba(125,211,252,.5),0 12px 28px rgba(0,0,0,.24)}
        .panel-back-btn__label{font-size:.68rem;line-height:1;color:#e0f2fe;letter-spacing:.22em;text-transform:uppercase}
        .panel-title{margin:0;width:100%;font-size:.74rem;letter-spacing:.38em;text-transform:uppercase;color:rgba(255,255,255,.76);text-align:center}
        .panel-desc{margin:.3rem 0 0;width:min(100%,38rem);font-size:.75rem;line-height:1.55;color:rgba(255,255,255,.52);text-align:center}

        .steam-strip-shell{position:relative;height:6rem;overflow:hidden}
        .steam-strip-header{margin-bottom:.75rem;display:flex;align-items:center;justify-content:center;gap:.65rem;padding:0 1rem;flex-wrap:wrap}
        .steam-strip-line{height:1px;width:min(10vw,5rem);background:linear-gradient(90deg,transparent,rgba(125,211,252,.45),transparent)}
        .steam-strip-cta,.steam-strip-link{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:9999px;border:1px solid rgba(125,211,252,.24);padding:.5rem .85rem;font-size:10px;letter-spacing:.26em;text-transform:uppercase;transition:transform 180ms ease,border-color 180ms ease,background-color 180ms ease}
        .steam-strip-cta{background:rgba(56,189,248,.1);color:#e0f2fe}
        .steam-strip-link{background:rgba(255,255,255,.04);color:rgba(255,255,255,.7);text-decoration:none}
        .steam-strip-cta:hover,.steam-strip-link:hover{transform:translateY(-1px);border-color:rgba(125,211,252,.6)}
        .steam-strip-cta:hover{background:rgba(56,189,248,.18)}
        .steam-strip-link:hover{background:rgba(255,255,255,.08)}
        .steam-strip-cta__dot{width:.4rem;height:.4rem;border-radius:9999px;background:#7dd3fc;box-shadow:0 0 12px rgba(125,211,252,.85)}
        .steam-track{display:flex;gap:.75rem;width:max-content;animation:scrollLeft 120s linear infinite}
        .steam-frame{position:relative;display:flex;height:5.5rem;width:9rem;flex:0 0 auto;align-items:center;justify-content:center;overflow:hidden;border-radius:.2rem;border:1px solid rgba(255,255,255,.1);background:#1a1a1b;padding:.5rem}
        .steam-panel-frame{background:radial-gradient(circle at 20% 12%,rgba(56,189,248,.12),transparent 42%),rgba(0,0,0,.52)}
        .steam-panel-skeleton{position:absolute;inset:1rem;border-radius:.75rem;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(125,211,252,.12),rgba(255,255,255,.03));background-size:220% 100%;animation:shimmer 2.4s linear infinite}
        .steam-panel-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:white;font-size:.72rem;font-weight:600}
        .steam-panel-meta{margin-top:.35rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
        .steam-panel-index{color:rgba(224,242,254,.6);font-size:9px;letter-spacing:.22em;text-transform:uppercase}
        .steam-panel-rarity{display:inline-flex;align-items:center;justify-content:center;min-width:4rem;border-radius:9999px;padding:.25rem .5rem;color:white;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
        .steam-panel-empty{width:min(100%,32rem);margin:0 auto;padding:1rem 1.25rem;border:1px solid rgba(125,211,252,.16);border-radius:1rem;background:rgba(2,6,23,.45);color:rgba(255,255,255,.72);font-size:.82rem;line-height:1.7;text-align:center}
        .steam-strip-shell--empty{display:grid;place-items:center}
        .steam-empty-state{display:grid;gap:.35rem;justify-items:center;padding:1rem 1.25rem;border:1px solid rgba(125,211,252,.14);border-radius:1rem;background:rgba(2,6,23,.42);backdrop-filter:blur(10px);text-align:center}
        .steam-empty-state__title{color:#e0f2fe;font-size:.72rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
        .steam-empty-state__copy{color:rgba(255,255,255,.6);font-size:.72rem;line-height:1.5}
        .cv-section{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:1.25rem 0 2rem;cursor:default;transition:opacity 220ms ease,transform 220ms ease}
        .cv-section--hidden{opacity:0;transform:translateY(14px);pointer-events:none}
        .cv-orb-row{position:relative;display:flex;align-items:center;justify-content:center;min-height:8rem;width:min(100%,22rem);margin:0 auto;--cv-side-offset:4.5rem}
        .cv-side-orb{position:absolute;top:50%}
        .cv-side-orb--left{right:calc(50% + var(--cv-side-offset));transform:translateY(-50%)}
        .cv-side-orb--right{left:calc(50% + var(--cv-side-offset))}
        .cv-orb-wrap{display:flex;align-items:center;justify-content:center}
        .cv-orb{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;width:7rem;height:7rem;background:transparent;border:none;padding:0}
        .cv-orb__glow{position:absolute;inset:-30px;border-radius:9999px;background:radial-gradient(circle,rgba(251,191,36,.35) 0%,rgba(245,158,11,.15) 45%,transparent 70%);filter:blur(18px);pointer-events:none;animation:cvAuraPulse 2.8s ease-in-out infinite;top:50%;left:50%;transform:translate(-50%,-50%);width:calc(100% + 60px);height:calc(100% + 60px)}
        .cv-orb__ring{position:absolute;border-radius:9999px;pointer-events:none;top:50%;left:50%}
        .cv-orb__ring--1{width:6.8rem;height:6.8rem;border:1px solid rgba(251,191,36,.45);animation:cvRingPulse 2.8s ease-in-out infinite}
        .cv-orb__ring--2{width:8.4rem;height:8.4rem;border:1px dashed rgba(251,191,36,.2);animation:cvRingPulse 2.8s ease-in-out infinite .4s}
        .cv-orb__inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;width:5.5rem;height:5.5rem;border-radius:9999px;background:transparent;border:1px solid rgba(251,191,36,.3);transition:border-color 200ms ease}
        .cv-orb:hover .cv-orb__inner{border-color:rgba(251,191,36,.7)}
        .cv-orb__label{font-size:1.1rem;font-weight:700;letter-spacing:.18em;color:#fde68a;animation:cvTextGlow 2.8s ease-in-out infinite}
        .cv-orb__sub{font-size:.48rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(251,191,36,.6);margin-top:.2rem;animation:cvSubGlow 2.8s ease-in-out infinite}
        .cert-orb{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;width:6rem;height:6rem;background:transparent;border:none;padding:0}
        .cert-orb__glow{position:absolute;inset:-24px;border-radius:9999px;background:radial-gradient(circle,rgba(134,239,172,.28) 0%,rgba(74,222,128,.1) 45%,transparent 70%);filter:blur(14px);pointer-events:none;animation:certGlowPulse 2.8s ease-in-out infinite .5s;top:50%;left:50%;transform:translate(-50%,-50%);width:calc(100% + 48px);height:calc(100% + 48px)}
        .cert-orb__ring{position:absolute;border-radius:9999px;pointer-events:none;top:50%;left:50%}
        .cert-orb__ring--1{width:5.8rem;height:5.8rem;border:1px solid rgba(134,239,172,.38);animation:cvRingPulse 2.8s ease-in-out infinite .3s}
        .cert-orb__ring--2{width:7.2rem;height:7.2rem;border:1px dashed rgba(134,239,172,.16);animation:cvRingPulse 2.8s ease-in-out infinite .7s}
        .cert-orb__inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;width:4.7rem;height:4.7rem;border-radius:9999px;background:transparent;transition:border-color 200ms ease}
        .cert-orb:hover .cert-orb__inner{border-color:rgba(134,239,172,.72)!important}
        .cert-orb__label{font-size:.8rem;font-weight:700;letter-spacing:.12em;color:#bbf7d0;animation:certTextGlow 2.8s ease-in-out infinite}
        .cert-orb__sub{font-size:.42rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(134,239,172,.55);margin-top:.15rem;animation:cvSubGlow 2.8s ease-in-out infinite}
        .giveaway-orb{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;width:6rem;height:6rem;background:transparent;border:none;padding:0;text-decoration:none}
        .giveaway-orb__glow{position:absolute;inset:-24px;border-radius:9999px;background:radial-gradient(circle,rgba(129,140,248,.3) 0%,rgba(99,102,241,.12) 45%,transparent 70%);filter:blur(14px);pointer-events:none;animation:giveawayGlowPulse 2.8s ease-in-out infinite .2s;top:50%;left:50%;transform:translate(-50%,-50%);width:calc(100% + 48px);height:calc(100% + 48px)}
        .giveaway-orb__ring{position:absolute;border-radius:9999px;pointer-events:none;top:50%;left:50%}
        .giveaway-orb__ring--1{width:5.8rem;height:5.8rem;border:1px solid rgba(165,180,252,.4);animation:cvRingPulse 2.8s ease-in-out infinite .15s}
        .giveaway-orb__ring--2{width:7.2rem;height:7.2rem;border:1px dashed rgba(129,140,248,.18);animation:cvRingPulse 2.8s ease-in-out infinite .55s}
        .giveaway-orb__inner{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;width:4.7rem;height:4.7rem;border-radius:9999px;background:transparent;border:1px solid rgba(165,180,252,.3);transition:border-color 200ms ease,transform 200ms ease}
        .giveaway-orb:hover .giveaway-orb__inner{border-color:rgba(165,180,252,.75);transform:scale(1.03)}
        .giveaway-orb__label{font-size:.74rem;font-weight:700;letter-spacing:.12em;color:#c7d2fe;animation:giveawayTextGlow 2.8s ease-in-out infinite}
        .giveaway-orb__sub{font-size:.42rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(199,210,254,.6);margin-top:.15rem;animation:cvSubGlow 2.8s ease-in-out infinite}
        @media(max-width:520px){
          .cv-orb-row{min-height:7.25rem;--cv-side-offset:3.7rem}
          .cv-orb{width:6.2rem;height:6.2rem}
          .cv-orb__ring--1{width:6rem;height:6rem}
          .cv-orb__ring--2{width:7.3rem;height:7.3rem}
          .cv-orb__inner{width:4.95rem;height:4.95rem}
          .cv-orb__label{font-size:1rem}
          .cv-orb__sub{font-size:.44rem}
          .cert-orb,.giveaway-orb{width:5.25rem;height:5.25rem}
          .cert-orb__ring--1,.giveaway-orb__ring--1{width:5.05rem;height:5.05rem}
          .cert-orb__ring--2,.giveaway-orb__ring--2{width:6.2rem;height:6.2rem}
          .cert-orb__inner,.giveaway-orb__inner{width:4.1rem;height:4.1rem}
          .cert-orb__label,.giveaway-orb__label{font-size:.68rem}
          .cert-orb__sub,.giveaway-orb__sub{font-size:.38rem}
        }
        @media(min-width:768px){.orb-button{height:7rem;width:7rem}.menu-card{height:9rem;width:7.5rem}}
      `}</style>
    </section>
  );
}

function SteamStrip({items,loading,source}) {
  if (loading) {
    return (
      <div className="steam-strip-shell steam-strip-shell--empty">
        <div className="steam-empty-state">
          <span className="steam-empty-state__title">Connecting inventory</span>
          <span className="steam-empty-state__copy">Trying Steam first, then your public CSFloat stall if Steam is slow.</span>
        </div>
      </div>
    );
  }

  if(!items.length){
    return <div className="steam-strip-shell steam-strip-shell--empty"><div className="steam-empty-state"><span className="steam-empty-state__title">Inventory feed unavailable</span><span className="steam-empty-state__copy">Open {source==="csfloat"?"your CSFloat stall":"Steam"} directly while the reel reconnects.</span></div></div>;
  }

  const frames = Array.from({length:20},(_,i)=>items[i%items.length]);
  return <div className="steam-strip-shell"><div className="steam-track">{[...frames,...frames].map((item,i)=><SteamFrame key={i} item={item}/>)}</div></div>;
}

function InventoryImage({src,alt,className}) {
  const candidates = useMemo(() => getInventoryImageCandidates(src), [src]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  return (
    <img
      src={candidates[Math.min(candidateIndex, candidates.length - 1)]}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={className}
      onError={() => {
        setCandidateIndex((current) => (
          current < candidates.length - 1 ? current + 1 : current
        ));
      }}
    />
  );
}

function SteamFrame({item}) {
  const bg=toSteamGlowColor(item.color);
  return <div className="steam-frame">{bg&&<div className="absolute inset-0 opacity-20 blur-sm" style={{backgroundColor:bg,boxShadow:`0 0 20px ${bg}`}}/>}<InventoryImage src={item.src} alt={item.name||"Item"} className="relative z-10 max-h-[85%] max-w-[85%] object-contain brightness-110 contrast-125 saturate-110"/></div>;
}

function SteamPanelFrame({item,index}) {
  const bg=toSteamGlowColor(item.color);
  return <div className="film-frame steam-panel-frame shrink-0 snap-start">{bg&&<div className="absolute inset-0 opacity-25 blur-xl" style={{backgroundColor:bg,boxShadow:`0 0 36px ${bg}`}}/>}<div className="absolute inset-0 bg-gradient-to-b from-white/6 via-transparent to-black/75"/><InventoryImage src={item.src} alt={item.name||"Steam item"} className="relative z-10 h-full w-full object-contain p-6 brightness-110 contrast-125 saturate-110"/><div className="absolute bottom-0 left-0 right-0 z-20 px-3 py-3"><span className="steam-panel-name">{item.name||"Steam item"}</span><div className="steam-panel-meta"><span className="steam-panel-index">Item {String(index+1).padStart(2,"0")}</span><span className="steam-panel-rarity" style={{backgroundColor:bg?`${bg}33`:"rgba(125,211,252,0.14)",border:`1px solid ${bg||"rgba(125,211,252,0.32)"}`}}>{item.source==="csfloat"?"Stall":"Live"}</span></div></div></div>;
}
