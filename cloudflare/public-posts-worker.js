const DB_ROOT = "https://codna-f8612-default-rtdb.europe-west1.firebasedatabase.app";
const SITE = "https://codeex.dev";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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
  const body = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${htmlEscape(title)} | Codeex</title><meta name="description" content="${htmlEscape(description)}"><link rel="canonical" href="${SITE}/"></head><body style="margin:0;background:#f3f6fb;color:#19243a;font:500 18px/1.8 system-ui,Arial,sans-serif"><main style="max-width:760px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e5eaf2;border-radius:24px;text-align:center"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(description)}</p><a href="${SITE}/">العودة إلى Codeex</a></main></body></html>`;
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
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 5).map(plain).filter(Boolean) : [];
  const created = Number(post.createdAt);
  const published = Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : "";
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)} | Codeex</title>
<meta name="description" content="${htmlEscape(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="article"><meta property="og:site_name" content="Codeex">
<meta property="og:title" content="${htmlEscape(title)}"><meta property="og:description" content="${htmlEscape(description)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}"><meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${htmlEscape(title)}">
${published ? `<meta property="article:published_time" content="${published}">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEscape(title)}"><meta name="twitter:description" content="${htmlEscape(description)}"><meta name="twitter:image" content="${image}">
<style>
:root{color-scheme:light;--ink:#19243a;--muted:#687891;--line:#e5eaf2;--blue:#2864e8;--paper:#fff;--bg:#f3f6fb}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% 0,#e8f0ff 0,transparent 55%),var(--bg);color:var(--ink);font:500 17px/1.9 system-ui,"Noto Sans Arabic",Tahoma,Arial,sans-serif}.wrap{width:min(880px,calc(100% - 32px));margin:42px auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;color:var(--muted);font-size:14px}.brand{color:var(--blue);font-weight:900;font-size:20px;text-decoration:none}.card{padding:clamp(22px,5vw,56px);background:var(--paper);border:1px solid var(--line);border-radius:24px;box-shadow:0 20px 64px #344d7018}.kind{display:inline-block;padding:4px 12px;border-radius:999px;background:#edf3ff;color:var(--blue);font-weight:800;font-size:13px}.card h1{margin:16px 0 10px;font-size:clamp(25px,5vw,42px);line-height:1.45;overflow-wrap:anywhere}.meta{color:var(--muted);font-size:14px}.body{margin-top:28px;white-space:pre-wrap;overflow-wrap:anywhere}.code{direction:ltr;text-align:left;white-space:pre;overflow:auto;padding:18px;border-radius:14px;background:#101827;color:#e6edf7;font:14px/1.7 ui-monospace,monospace}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}.tag{padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--blue);font-size:13px}.footer{margin-top:24px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted)}.footer a{color:var(--blue);font-weight:800;text-decoration:none}
</style>
</head>
<body><main class="wrap"><header class="top"><a class="brand" href="${SITE}/">Codeex</a><span>منشور عام</span></header><article class="card"><span class="kind">${htmlEscape(plain(post.kind) || "مشاركة")}</span><h1>${htmlEscape(title)}</h1><div class="meta">${htmlEscape(author)}${handle ? ` · @${htmlEscape(handle)}` : ""}${published ? ` · <time datetime="${published}">${new Date(created).toLocaleDateString("ar")}</time>` : ""}</div><div class="body">${htmlEscape(text)}</div>${code ? `<h2>مقطع الكود</h2><pre class="code"><code>${htmlEscape(code)}</code></pre>` : ""}${tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag">#${htmlEscape(tag)}</span>`).join("")}</div>` : ""}<footer class="footer">رابط مستقل لمشاركة عامة في Codeex — لا يلزم تسجيل الدخول لقراءة هذا المنشور. <a href="${SITE}/">زيارة Codeex</a></footer></article></main></body></html>`;
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
  const headers = responseHeaders("text/html");
  headers["Retry-After"] = "60";
  headers["X-Robots-Tag"] = "noindex, nofollow";
  return new Response("<!doctype html><html lang=\"ar\" dir=\"rtl\"><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title>تعذر تحميل المنشور | Codeex</title><p>تعذر تحميل المنشور الآن. حاول مرة أخرى لاحقاً.</p></html>", { status: 503, headers });
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
