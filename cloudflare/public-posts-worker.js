const DB_ROOT = "https://codna-f8612-default-rtdb.europe-west1.firebasedatabase.app";
const SITE = "https://codeex.dev";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const FONT_CSS = `@font-face{font-family:Cairo;font-style:normal;font-weight:400 900;font-display:swap;src:url(/assets/fonts/cairo-arabic.woff2) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
@font-face{font-family:Cairo;font-style:normal;font-weight:400 900;font-display:swap;src:url(/assets/fonts/cairo-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

const BASE_CSS = `
:root{color-scheme:light dark;--bg:#f3f6fb;--paper:#fff;--soft:#f7f9fd;--ink:#19243a;--muted:#667690;--line:#e5eaf2;--blue:#2864e8;--violet:#7a62db;--teal:#279987;--chip:#edf3ff;--shadow:0 24px 70px #344d7022}
@media(prefers-color-scheme:dark){:root{--bg:#0c1322;--paper:#141d31;--soft:#101828;--ink:#e9eefb;--muted:#93a1bb;--line:#243049;--chip:#1b2848;--blue:#7aa2ff;--shadow:0 24px 70px #0008}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:radial-gradient(900px 420px at 88% -90px,#2864e824,transparent 70%),radial-gradient(700px 380px at 4% -70px,#7a62db1e,transparent 70%),var(--bg);color:var(--ink);font:500 17px/1.9 Cairo,Tajawal,"Noto Sans Arabic",system-ui,Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{width:min(820px,calc(100% - 28px));margin:0 auto;padding:20px 0 56px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 22px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:21px;text-decoration:none;direction:ltr}
.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--violet));color:#fff;font:800 14px/1 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 22px #2864e845}
.pill{padding:3px 14px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--muted);font-size:13px;font-weight:700}
.card{position:relative;overflow:hidden;padding:clamp(22px,5vw,50px);background:var(--paper);border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow)}
.card:before{content:"";position:absolute;inset:0 0 auto;height:6px;background:linear-gradient(90deg,var(--blue),var(--violet),var(--teal))}
.kind{display:inline-block;margin-top:6px;padding:2px 14px;border-radius:999px;background:var(--chip);color:var(--blue);font-weight:800;font-size:13px}
h1{margin:12px 0 18px;font-size:clamp(26px,5.6vw,40px);line-height:1.55;font-weight:900;overflow-wrap:anywhere}
.author{display:flex;align-items:center;gap:12px;padding:0 0 22px;border-bottom:1px solid var(--line)}
.avatar{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--violet));color:#fff;font-weight:800;font-size:19px;line-height:1}
.who{display:flex;flex-direction:column;min-width:0;line-height:1.55}
.name{font-weight:800;overflow-wrap:anywhere}
.sub{display:flex;flex-wrap:wrap;align-items:center;gap:0 10px;color:var(--muted);font-size:14px}
.sub>*+*:before{content:"\\00b7";margin-inline-end:10px}
.handle{direction:ltr;unicode-bidi:isolate}
.body{margin-top:26px;font-size:18px;line-height:2.05;white-space:pre-wrap;overflow-wrap:anywhere}
.codebox{margin-top:30px;border-radius:16px;overflow:hidden;background:#0e1626;border:1px solid #1f2c47;direction:ltr}
.codebar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;background:#131e33;color:#9db0d1;font:700 12px/1 ui-monospace,Menlo,Consolas,monospace}
.dots{display:flex;gap:6px}.dots i{width:10px;height:10px;border-radius:50%;background:#33415f}
.lang{text-transform:uppercase;letter-spacing:.06em}
.copy{cursor:pointer;border:1px solid #2a3a5c;background:#182641;color:#c9d6ee;border-radius:8px;padding:6px 12px;font:700 12px/1 Cairo,Tajawal,system-ui,sans-serif;direction:rtl}
.copy:hover{background:#1f3158}
pre{margin:0;padding:18px;overflow:auto;color:#e6edf7;font:14px/1.75 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}
.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:26px}
.tag{padding:2px 12px;border:1px solid var(--line);border-radius:999px;background:var(--soft);color:var(--blue);font-size:13px;font-weight:700}
.cta{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:34px;padding:20px 22px;border-radius:20px;background:linear-gradient(135deg,#2864e812,#7a62db14);border:1px solid var(--line)}
.cta b{display:block;font-size:17px}.cta span{color:var(--muted);font-size:14px}
.btn{display:inline-block;padding:9px 22px;border-radius:12px;border:1px solid var(--line);background:var(--paper);font-weight:800;font-size:15px;text-decoration:none;line-height:1.6}
.btn.primary{border:0;background:linear-gradient(135deg,var(--blue),var(--violet));color:#fff;box-shadow:0 10px 24px #2864e838}
.btn:hover{transform:translateY(-1px)}
.foot{margin-top:22px;text-align:center;color:var(--muted);font-size:13px}
.err{text-align:center;padding-block:clamp(36px,9vw,84px)}
.big{font-size:clamp(84px,24vw,170px);line-height:1.05;font-weight:900;letter-spacing:.02em;direction:ltr;background:linear-gradient(135deg,var(--blue),var(--violet) 55%,var(--teal));-webkit-background-clip:text;background-clip:text;color:transparent}
.err h1{margin:6px 0 10px}.err p{margin:0 auto 26px;max-width:46ch;color:var(--muted)}
.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.links{display:flex;gap:6px 18px;justify-content:center;flex-wrap:wrap;margin-top:26px;color:var(--muted);font-size:14px}
.links a{text-decoration:none}.links a:hover{color:var(--blue)}
.video-card{margin:26px 0 0;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:0 10px 30px #1b2b4212}
.video-frame{position:relative;aspect-ratio:16/9;background:#0b1220}
.video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.video-play{position:absolute;inset:0;display:block;width:100%;padding:0;border:0;color:#fff;cursor:pointer;overflow:hidden;background:radial-gradient(ellipse at 30% 20%,#27407a,#0b1220)}
.video-play img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92;transition:transform .35s ease,opacity .2s}
.video-play:hover img{transform:scale(1.035);opacity:1}
.video-play:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0b122000 45%,#0b1220b8);pointer-events:none}
.video-btn{position:absolute;top:50%;left:50%;z-index:2;display:grid;place-items:center;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--violet));box-shadow:0 8px 28px #2864e866,0 0 0 8px #ffffff26;transform:translate(-50%,-50%);transition:transform .2s}
.video-play:hover .video-btn{transform:translate(-50%,-50%) scale(1.08)}
.video-play:focus-visible{outline:3px solid var(--blue);outline-offset:-3px}
@media(prefers-reduced-motion:reduce){.video-play img,.video-btn{transition:none}}
@media(max-width:520px){.body{font-size:17px}.cta{padding:16px}.btn{width:100%;text-align:center}}
`;

function pageHead({ title, description, extra = "" }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f4f7fb">
<title>${htmlEscape(title)} | Codeex</title>
<meta name="description" content="${htmlEscape(description)}">
<link rel="preload" href="/assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>
${extra}
<style>${FONT_CSS}${BASE_CSS}</style>
</head>`;
}

const BRAND = `<a class="brand" href="/"><span class="mark">&lt;/&gt;</span>Codeex</a>`;

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plain(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

async function readJson(path) {
  const response = await fetch(`${DB_ROOT}/${path}`, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  return response.json();
}

async function loadPublicPost(id) {
  const indexed = await readJson(`publicPostIndex/${encodeURIComponent(id)}.json`);
  if (indexed !== true) return null;
  const post = await readJson(`publicPosts/${encodeURIComponent(id)}/data.json`);
  if (!post || post.id !== id || post.isPublic !== true || post.groupId !== "") return null;
  return post;
}

function postTitle(post) {
  return plain(post.title) || plain(post.text).replace(/\s+/g, " ").slice(0, 110) || "منشور عام في Codeex";
}

function postDescription(post) {
  return (plain(post.text).replace(/\s+/g, " ") || plain(post.title)).slice(0, 180);
}

function responseHeaders(type) {
  return {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Robots-Tag": "index, follow",
  };
}

function errorPage(status, title, description) {
  const body = `${pageHead({ title, description, extra: `<meta name="robots" content="noindex,follow">` })}
<body><main class="wrap"><header class="top">${BRAND}<span class="pill">خطأ في الصفحة</span></header>
<section class="card err"><div class="big">${htmlEscape(status)}</div><h1>${htmlEscape(title)}</h1><p>${htmlEscape(description)}</p>
<div class="actions"><a class="btn primary" href="/">العودة إلى الرئيسية</a></div></section>
<p class="foot">Codeex · مجتمع المطورين العرب</p></main></body></html>`;
  const headers = responseHeaders("text/html");
  headers["X-Robots-Tag"] = "noindex, nofollow";
  return new Response(body, { status, headers });
}

function wrapTitle(title) {
  const words = [...title].join("").split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  const limit = title.length > 95 ? 27 : title.length > 58 ? 33 : 39;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && [...next].length > limit) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, 3);
  if (lines.length > 3) visible[2] = `${[...visible[2]].slice(0, limit - 1).join("")}…`;
  return visible.length ? visible : ["منشور عام في Codeex"];
}

function shareImage(post) {
  const title = postTitle(post);
  const lines = wrapTitle(title);
  const firstY = lines.length === 1 ? 330 : lines.length === 2 ? 295 : 260;
  const titleText = lines
    .map((line, index) => `<tspan x="600" dy="${index === 0 ? 0 : 82}">${htmlEscape(line)}</tspan>`)
    .join("");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="t d">
<title id="t">${htmlEscape(title)}</title><desc id="d">صورة مشاركة للمنشور العام</desc>
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eef3ff"/><stop offset="1" stop-color="#f5f1ff"/></linearGradient><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#2864e8"/><stop offset=".55" stop-color="#7a62db"/><stop offset="1" stop-color="#279987"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#19243a" flood-opacity=".12"/></filter></defs>
<rect width="1200" height="630" fill="url(#bg)"/><circle cx="90" cy="78" r="140" fill="#2864e8" opacity=".08"/><circle cx="1110" cy="570" r="180" fill="#7a62db" opacity=".08"/><rect x="76" y="73" width="1048" height="484" rx="42" fill="#fff" filter="url(#shadow)"/><rect x="76" y="73" width="1048" height="11" rx="6" fill="url(#accent)"/><path d="M152 160h90M958 468h90" stroke="url(#accent)" stroke-width="8" stroke-linecap="round" opacity=".7"/><text x="600" y="${firstY}" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" fill="#19243a" font-family="Cairo,Tajawal,Arial,sans-serif" font-size="58" font-weight="800" letter-spacing="0">${titleText}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      ...responseHeaders("image/svg+xml"),
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": "inline; filename=codeex-share.svg",
    },
  });
}

const VIDEO_ID = { youtube: /^[A-Za-z0-9_-]{11}$/, archive: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/ };

function videoHtml(post) {
  const provider = plain(post.videoProvider), id = plain(post.videoId);
  if (!VIDEO_ID[provider] || !VIDEO_ID[provider].test(id)) return "";
  const thumb = provider === "youtube" ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : `https://archive.org/services/img/${encodeURIComponent(id)}`;
  const icon = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z" fill="currentColor"/></svg>`;
  return `<figure class="video-card"><div class="video-frame"><button type="button" class="video-play" data-provider="${provider}" data-vid="${htmlEscape(id)}" aria-label="تشغيل الفيديو"><img src="${htmlEscape(thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="video-btn">${icon}</span></button></div></figure>`;
}

function postPage(post, id) {
  const title = postTitle(post);
  const description = postDescription(post);
  const canonical = `${SITE}/post/${encodeURIComponent(id)}`;
  const image = `${SITE}/og/${encodeURIComponent(id)}.svg`;
  const author = plain(post.name) || "عضو Codeex";
  const handle = plain(post.handle);
  const text = plain(post.text);
  const code = plain(post.code);
  const language = plain(post.codeLanguage) || "code";
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 5).map(plain).filter(Boolean) : [];
  const created = Number(post.createdAt);
  const published = Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : "";
  const dateLabel = published
    ? new Date(created).toLocaleDateString("ar-u-nu-latn", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const initial = htmlEscape([...author][0] || "C");
  const extra = `<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="article"><meta property="og:site_name" content="Codeex">
<meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${htmlEscape(description)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}"><meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${htmlEscape(title)}">
${published ? `<meta property="article:published_time" content="${published}">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEscape(title)}"><meta name="twitter:description" content="${htmlEscape(description)}"><meta name="twitter:image" content="${image}">`;
  const codeBlock = code
    ? `<div class="codebox"><div class="codebar"><span class="dots"><i></i><i></i><i></i></span><span class="lang">${htmlEscape(language)}</span><button class="copy" type="button">نسخ</button></div><pre><code>${htmlEscape(code)}</code></pre></div>`
    : "";
  const tagList = tags.length
    ? `<div class="tags">${tags.map((tag) => `<span class="tag" dir="auto">#${htmlEscape(tag)}</span>`).join("")}</div>`
    : "";
  const script = `<script>document.querySelectorAll(".video-play").forEach(function(b){b.addEventListener("click",function(){var p=b.dataset.provider,id=b.dataset.vid;var src=p==="youtube"?"https://www.youtube-nocookie.com/embed/"+id+"?rel=0&modestbranding=1&playsinline=1&autoplay=1":"https://archive.org/embed/"+encodeURIComponent(id);var f=document.createElement("iframe");f.src=src;f.title="مشغل الفيديو";f.allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen";f.allowFullscreen=true;f.referrerPolicy="strict-origin-when-cross-origin";b.parentNode.replaceChildren(f)})});document.querySelectorAll(".video-play img").forEach(function(i){i.addEventListener("error",function(){i.remove()})});document.querySelectorAll(".copy").forEach(function(b){b.addEventListener("click",function(){var c=b.closest(".codebox").querySelector("code").innerText;var done=function(t){b.textContent=t;setTimeout(function(){b.textContent="نسخ"},1800)};if(navigator.clipboard){navigator.clipboard.writeText(c).then(function(){done("تم النسخ ✓")},function(){done("تعذر النسخ")})}else{done("تعذر النسخ")}})})</script>`;
  const html = `${pageHead({ title, description, extra })}
<body><main class="wrap"><header class="top">${BRAND}<span class="pill">منشور عام</span></header>
<article class="card"><span class="kind">${htmlEscape(plain(post.kind) || "مشاركة")}</span><h1>${htmlEscape(title)}</h1>
<div class="author"><span class="avatar" aria-hidden="true">${initial}</span><div class="who"><span class="name">${htmlEscape(author)}</span><div class="sub">${handle ? `<span class="handle">@${htmlEscape(handle)}</span>` : ""}${published ? `<time datetime="${published}">${htmlEscape(dateLabel)}</time>` : ""}</div></div></div>
<div class="body">${htmlEscape(text)}</div>${videoHtml(post)}${codeBlock}${tagList}
<div class="cta"><div><b>انضم إلى مجتمع Codeex</b><span>مجتمع المطورين العرب لمشاركة الأكواد والمعرفة.</span></div><a class="btn primary" href="${SITE}/">زيارة Codeex</a></div>
</article><p class="foot">منشور عام — لا يلزم تسجيل الدخول لقراءته.</p></main>${script}</body></html>`;
  return new Response(html, { status: 200, headers: responseHeaders("text/html") });
}

async function sitemapResponse() {
  let ids = [];
  try {
    const index = await readJson("publicPostIndex.json");
    if (index && typeof index === "object") {
      ids = Object.entries(index)
        .filter(([id, enabled]) => enabled === true && ID_PATTERN.test(id))
        .map(([id]) => id)
        .slice(0, 50000);
    }
  } catch {
    // Keep the site's existing static routes listed if the Firebase public index is unavailable.
  }
  const fixed = ["", "about/", "privacy/", "contact/"].map((path) => `${SITE}/${path}`);
  const postUrls = ids.map((id) => `${SITE}/post/${encodeURIComponent(id)}`);
  const urls = [...fixed, ...postUrls]
    .map((loc) => `<url><loc>${htmlEscape(loc)}</loc></url>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, { headers: responseHeaders("application/xml") });
}

function unavailable() {
  const response = errorPage(503, "تعذر تحميل المنشور", "تعذر تحميل المنشور الآن. حاول مرة أخرى بعد قليل.");
  response.headers.set("Retry-After", "60");
  return response;
}


/* =====================================================================================================
   Broken-video cleanup. Runs from a Cron Trigger and deletes posts whose video was removed or no longer
   works. Needs two Worker secrets: FB_CLIENT_EMAIL and FB_PRIVATE_KEY (a Firebase service account).
   A video must fail several separate checks (hours apart) before its post is deleted.
   ===================================================================================================== */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000; // re-check each video at most every 6 hours
const FAILS_BEFORE_DELETE = 3; // consecutive confirmed failures needed to delete (about 12+ hours)
const MAX_CHECKS_PER_RUN = 8;
const MAX_GROUPS_PER_RUN = 6;
const MAX_DELETES_PER_RUN = 3;
const FETCH_TIMEOUT_MS = 9000;

const b64url = (input) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function getAccessToken(env) {
  if (!env.FB_CLIENT_EMAIL || !env.FB_PRIVATE_KEY) throw new Error("FB_CLIENT_EMAIL / FB_PRIVATE_KEY secrets are missing");
  const pem = String(env.FB_PRIVATE_KEY).replace(/\\n/g, "\n");
  const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: env.FB_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(new Uint8Array(signature))}` }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  return (await res.json()).access_token;
}

async function adminDb(token, method, path, body, query = "") {
  const res = await fetch(`${DB_ROOT}/${path}.json?access_token=${encodeURIComponent(token)}${query}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase ${method} ${path} failed (${res.status})`);
  return res.json();
}

async function timedFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

/* Returns "ok", "gone" (confirmed unavailable) or "unknown" (could not tell: never counts as a failure). */
async function checkVideoStatus(provider, id) {
  try {
    if (provider === "youtube") {
      const res = await timedFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
      if (res.ok) return "ok";
      if ([400, 401, 404].includes(res.status)) return "gone"; // deleted / private / embedding disabled
      return "unknown"; // 403, 429, 5xx: may be rate limiting, never treated as a failure
    }
    if (provider === "archive") {
      const res = await timedFetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
      if (!res.ok) return "unknown";
      const data = await res.json();
      const meta = data && data.metadata;
      if (!meta || !Object.keys(meta).length) return "gone";
      if (data.is_dark || String(meta["access-restricted-item"]) === "true") return "gone";
      if (String(meta.mediatype) !== "movies") return "gone";
      const playable = (data.files || []).some((f) => /\.(mp4|webm|ogv|mkv|m4v|mov|avi|mpg|mpeg)$/i.test(String(f.name || "")) || /MPEG4|h\.264|Ogg Video|WebM|Matroska/i.test(String(f.format || "")));
      return playable ? "ok" : "gone";
    }
  } catch {
    /* network error or timeout */
  }
  return "unknown";
}

const videoQuery = `&orderBy=${encodeURIComponent('"data/videoProvider"')}&startAt=${encodeURIComponent('"a"')}`;

async function collectVideoPosts(token, now) {
  const found = [];
  const add = (path, raw) => {
    for (const [id, value] of Object.entries(raw || {})) {
      const d = value && value.data;
      if (!d || !ID_PATTERN.test(id)) continue;
      const provider = String(d.videoProvider || ""), videoId = String(d.videoId || "");
      if (VIDEO_ID[provider] && VIDEO_ID[provider].test(videoId)) found.push({ id, path, uid: String(d.uid || ""), title: String(d.title || d.text || "").slice(0, 60), provider, videoId });
    }
  };
  add("posts", await adminDb(token, "GET", "posts", undefined, videoQuery));
  const groupIds = Object.keys((await adminDb(token, "GET", "groupPosts", undefined, "&shallow=true")) || {}).sort();
  if (groupIds.length) {
    const start = (Math.floor(now / (30 * 60 * 1000)) * MAX_GROUPS_PER_RUN) % groupIds.length;
    for (let i = 0; i < Math.min(MAX_GROUPS_PER_RUN, groupIds.length); i++) {
      const gid = groupIds[(start + i) % groupIds.length];
      if (!ID_PATTERN.test(gid)) continue;
      add(`groupPosts/${gid}`, await adminDb(token, "GET", `groupPosts/${gid}`, undefined, videoQuery));
    }
  }
  return found;
}

async function removePostPatch(post, reason, now) {
  const patch = { [`videoChecks/${post.id}`]: null };
  if (post.path === "posts") {
    patch[`posts/${post.id}`] = null;
    patch[`publicPosts/${post.id}`] = null;
    patch[`publicPostIndex/${post.id}`] = null;
    patch[`publicPostOwners/${post.id}`] = null;
  } else patch[`${post.path}/${post.id}`] = null;
  patch[`removedPosts/${post.id}`] = { uid: post.uid, title: post.title, provider: post.provider, videoId: post.videoId, reason, at: now };
  if (post.uid) {
    const nid = `v${now}${post.id.slice(0, 6)}`.replace(/[^A-Za-z0-9_-]/g, "");
    patch[`users/${post.uid}/notifications/${nid}`] = {
      id: nid,
      type: "post_removed",
      read: false,
      time: now,
      text: `حُذف منشورك «${post.title || "منشور"}» لأن الفيديو المرفق به لم يعد متاحاً.`.slice(0, 300),
    };
  }
  return patch;
}

/* dryRun=true reports what would happen without writing anything. */
async function cleanupBrokenVideos(env, { dryRun = false } = {}) {
  const token = await getAccessToken(env);
  const now = Date.now();
  const posts = await collectVideoPosts(token, now);
  const checks = (await adminDb(token, "GET", "videoChecks")) || {};
  const report = { candidates: posts.length, checked: [], deleted: [], skipped: "" };

  const due = posts
    .filter((p) => now - Number(checks[p.id]?.last || 0) >= CHECK_EVERY_MS)
    .sort((a, b) => Number(checks[a.id]?.last || 0) - Number(checks[b.id]?.last || 0))
    .slice(0, MAX_CHECKS_PER_RUN);
  const results = [];
  for (const post of due) results.push([post, await checkVideoStatus(post.provider, post.videoId)]);

  const gone = results.filter(([, r]) => r === "gone").length;
  if (results.length >= 4 && gone / results.length > 0.6) {
    // Almost everything failing at once points to a problem on our side or the provider's: change nothing.
    report.skipped = "too many failures in one run; nothing was changed";
    report.checked = results.map(([p, r]) => ({ id: p.id, result: r }));
    return report;
  }

  let deletes = 0;
  for (const [post, result] of results) {
    const prev = checks[post.id] || {};
    const fails = result === "gone" ? Number(prev.fails || 0) + 1 : result === "ok" ? 0 : Number(prev.fails || 0);
    report.checked.push({ id: post.id, result, fails });
    if (dryRun) continue;
    if (result === "gone" && fails >= FAILS_BEFORE_DELETE && deletes < MAX_DELETES_PER_RUN) {
      await adminDb(token, "PATCH", "", await removePostPatch(post, `video ${result} after ${fails} checks`, now));
      deletes++;
      report.deleted.push(post.id);
    } else {
      await adminDb(token, "PUT", `videoChecks/${post.id}`, { fails, last: now, result });
    }
  }
  if (!dryRun) {
    // Forget check records of posts that no longer exist.
    const live = new Set(posts.map((p) => p.id));
    for (const id of Object.keys(checks).filter((k) => !live.has(k)).slice(0, 5)) await adminDb(token, "DELETE", `videoChecks/${id}`);
  }
  return report;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupBrokenVideos(env).then((r) => console.log("video cleanup:", JSON.stringify(r))).catch((e) => console.log("video cleanup failed:", String(e && e.message))));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__video-cleanup" && env && env.CLEANUP_KEY && url.searchParams.get("key") === env.CLEANUP_KEY) {
      try {
        const report = await cleanupBrokenVideos(env, { dryRun: url.searchParams.get("run") !== "1" });
        return new Response(JSON.stringify(report, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message) }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    if (url.hostname === "www.codeex.dev") {
      url.hostname = "codeex.dev";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/sitemap.xml") return sitemapResponse();
    const imageMatch = url.pathname.match(/^\/og\/([^/]+)\.svg$/);
    if (imageMatch) {
      let id;
      try { id = decodeURIComponent(imageMatch[1]); } catch { return errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب."); }
      if (!ID_PATTERN.test(id)) return errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب.");
      try {
        const post = await loadPublicPost(id);
        return post ? shareImage(post) : errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب.");
      } catch { return unavailable(); }
    }
    const postMatch = url.pathname.match(/^\/post\/([^/]+)\/?$/);
    if (postMatch) {
      let id;
      try { id = decodeURIComponent(postMatch[1]); } catch { return errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب."); }
      if (!ID_PATTERN.test(id)) return errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب.");
      try {
        const post = await loadPublicPost(id);
        return post ? postPage(post, id) : errorPage(404, "المنشور غير موجود", "تعذر العثور على المنشور العام المطلوب.");
      } catch { return unavailable(); }
    }
    return fetch(request);
  },
};
