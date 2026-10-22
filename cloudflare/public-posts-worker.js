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
  const script = `<script>document.querySelectorAll(".copy").forEach(function(b){b.addEventListener("click",function(){var c=b.closest(".codebox").querySelector("code").innerText;var done=function(t){b.textContent=t;setTimeout(function(){b.textContent="نسخ"},1800)};if(navigator.clipboard){navigator.clipboard.writeText(c).then(function(){done("تم النسخ ✓")},function(){done("تعذر النسخ")})}else{done("تعذر النسخ")}})})</script>`;
  const html = `${pageHead({ title, description, extra })}
<body><main class="wrap"><header class="top">${BRAND}<span class="pill">منشور عام</span></header>
<article class="card"><span class="kind">${htmlEscape(plain(post.kind) || "مشاركة")}</span><h1>${htmlEscape(title)}</h1>
<div class="author"><span class="avatar" aria-hidden="true">${initial}</span><div class="who"><span class="name">${htmlEscape(author)}</span><div class="sub">${handle ? `<span class="handle">@${htmlEscape(handle)}</span>` : ""}${published ? `<time datetime="${published}">${htmlEscape(dateLabel)}</time>` : ""}</div></div></div>
<div class="body">${htmlEscape(text)}</div>${codeBlock}${tagList}
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
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
