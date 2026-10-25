/* Codeex viewport helper: exposes the device class on <html> so CSS/JS can react
   without hard-coded pixel checks. Purely additive; the app below is unchanged. */
(function viewportClass() {
  var root = document.documentElement, tick = 0;
  function apply() {
    var w = window.innerWidth || root.clientWidth;
    var cls = w <= 700 ? "phone" : w <= 1100 ? "tablet" : w < 1920 ? "desktop" : "wide";
    if (root.getAttribute("data-viewport") !== cls) root.setAttribute("data-viewport", cls);
    root.setAttribute("data-touch", window.matchMedia && matchMedia("(pointer: coarse)").matches ? "1" : "0");
  }
  apply();
  window.addEventListener("resize", function () {
    cancelAnimationFrame(tick);
    tick = requestAnimationFrame(apply);
  }, { passive: true });
  window.addEventListener("orientationchange", apply, { passive: true });
})();

(function boot(run) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})(() => {
  "use strict";

  /* ==========================================================================
   Diagnostics
   ========================================================================== */

  class AppError extends Error {}

  const DEBUG = (() => {
    try {
      return localStorage.getItem("codna_debug") === "1";
    } catch {
      return false;
    }
  })();

  const log = {
    info: (...args) => DEBUG && console.info(...args),
    warn: (...args) => DEBUG && console.warn(...args),
    error: (...args) => DEBUG && console.error(...args),
  };

  if (!DEBUG && typeof console !== "undefined") {
    console.log("%cتنبيه | Warning", "color:#df5671;font:700 22px sans-serif");
    console.log(
      "هذه الأداة مخصّصة للمطورين. لا تلصق هنا أي كود طلبه منك شخص آخر؛ فقد يُستخدم للوصول إلى حسابك.\nThis console is for developers. Never paste code someone else gave you; it can be used to take over your account.",
    );
  }

  /* ==========================================================================
   Configuration and services
   ========================================================================== */
  const firebaseConfig = {
    apiKey: "AIzaSyA9KT6QFaZSoEl85ugSKEOHRojuX7HzslY",
    authDomain: "codna-f8612.firebaseapp.com",
    databaseURL: "https://codna-f8612-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "codna-f8612",
    messagingSenderId: "150421379278",
    appId: "1:150421379278:web:00fb4951cc995c0c4c589f",
    measurementId: "G-LLYZ9T9LLJ",
  };
  const APP_CHECK_SITE_KEY = "6LfLpfItAAAAAKspHSt-Aa65yOPEcPa_SclAC0be";
  let firebaseAvailable = typeof firebase !== "undefined" && !!firebase.apps;
  let firebaseApp = firebaseAvailable
    ? firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(firebaseConfig)
    : null;
  let selectedCodeFileBase64 = "", selectedCodeFileName = "", selectedCodeFileBytes = 0, selectedCodeFileText = "";
  let appCheckStarted = false,
    auth = firebaseAvailable ? firebase.auth(firebaseApp) : null,
    database = firebaseAvailable ? firebase.database(firebaseApp) : null,
    cloudFunctions =
      firebaseAvailable && firebase.functions ? firebase.app().functions("europe-west1") : null;
  function activateAppCheck() {
    if (appCheckStarted || !firebaseApp || typeof firebase === "undefined" || !firebase.appCheck)
      return;
    if (!APP_CHECK_SITE_KEY) {
      log.warn("App Check site key is not configured.");
      return;
    }
    try {
      const appCheck = firebase.appCheck();
      appCheck.activate(
        new firebase.appCheck.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        true,
      );
      appCheckStarted = true;
      log.info("App Check ready.");
    } catch (error) {
      log.error("App Check initialization failed.", error);
    }
  }
  activateAppCheck();
  if (auth) auth.useDeviceLanguage();
  try {
    if (firebaseAvailable && location.protocol !== "file:" && firebase.analytics)
      firebase.analytics(firebaseApp);
  } catch {}

  /* ==========================================================================
   Application state
   ========================================================================== */
  let activeUser = null,
    cloudPosts = [],
    remoteRawPosts = {},
    savedIds = [],
    joinedIds = [],
    noticeItems = [],
    remoteGroups = [],
    rawGroupData = {},
    publicProfiles = {},
    activeConversation = "",
    activeMessages = [],
    activeChatRef = null,
    userUnsubs = [];

  let editingPostId = "",
    pendingKind = "",
    groupMembersMap = {},
    groupMembershipOverrides = {},
    groupMemberUnsubs = [],
    groupRequestData = {},
    groupPendingStatus = {},
    groupRequestUnsubs = [],
    privateGroupPosts = {},
    privateGroupUnsubs = {},
    selectedGroupId = "",
    pendingGroupId = "",
    viewedProfileUid = "",
    firebaseAuthStarted = false;

  let page = "home",
    feedFilter = "الأحدث",
    searchTerm = "",
    profileTab = "projects",
    pendingSharedPostId = new URLSearchParams(location.search).get("post") || "",
    pendingSharedGroupId = new URLSearchParams(location.search).get("group") || "",
    sharedPostHandled = false,
    sharedPostLookupBusy = false,
    sharedAuthReady = false;

  let language = "ar"; // Arabic only

  let coreRefs = [],
    coreStarted = false,
    olderPages = [],
    olderRaw = {},
    authBusy = false,
    pendingResetCode = "",
    authActionHandled = false;

  let groups = [];

  /* Feed windowing / lazy loading state */
  const POST_PAGE = 15;
  let postLimit = POST_PAGE,
    postsReady = false,
    postsLoadError = false,
    postsExhausted = false,
    loadingMore = false,
    loadingTimer = 0,
    postsWindowRef = null,
    lastWindowRaw = {},
    extraRawPosts = {},
    savedRawPosts = {},
    savedFetched = new Set(),
    extraWatches = new Map(),
    extrasApplied = false,
    ownPostCount = 0,
    feedObserver = null,
    pendingRender = 0,
    pendingFrame = false;

  const Store = {
    currentUser() {
      return activeUser;
    },
    setUser(user) {
      activeUser = user;
    },
    posts() {
      return cloudPosts;
    },
    savePosts(items) {
      cloudPosts = items;
    },
    joined() {
      return joinedIds;
    },
    setJoined(ids) {
      joinedIds = ids;
      if (activeUser) writeUserMap("joined", ids);
    },
    saved() {
      return savedIds;
    },
    setSaved(ids) {
      savedIds = ids;
      if (activeUser) writeUserMap("saved", ids);
    },
    notices() {
      return noticeItems;
    },
    setNotices(items) {
      noticeItems = items;
      if (activeUser) {
        const obj = {};
        items.forEach((n) => (obj[n.id] = n));
        database.ref(`users/${activeUser.uid}/notifications`).set(obj).catch(handleError);
      }
    },
  };

  const currentUser = () => Store.currentUser();

  /* ==========================================================================
   Static data
   ========================================================================== */
  const ICON = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    question:
      '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1.1 1-1.8 1.4-1.8 3M12 17h.01"/>',
    article: '<path d="M5 3h11l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/>',
    groups:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6M23 11h-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2"/>',
  };

  Object.assign(ICON, {
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-8-2 6"/>',
    comment: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.8-5.1A8.5 8.5 0 1 1 21 11.5Z"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v6h5M9 13h7M9 17h7"/>',
    heart:
      '<path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10a4.8 4.8 0 0 1 8.8-2.6 4.8 4.8 0 0 1 8.8 2.6Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>',
    project: '<path d="M4 5h16v14H4z"/><path d="m9 9-3 3 3 3m6-6 3 3-3 3m-2-7-2 8"/>',
    resource: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.4.8l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.4-.8l-1.7.7-1.4-2.4L8 15a8 8 0 0 1 0-1.7l-1.5-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.4-.8l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.4.8l1.7-.7 1.4 2.4-1.5 1.1a8 8 0 0 1 0 1.7Z"/>',
    share:
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  });

  const icon = (n) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[n] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;

  const TOP = [
    ["home", "الرئيسية", "home"],
    ["article", "المقالات", "articles"],
    ["groups", "المجتمع", "groups"],
    ["project", "المشاريع", "projects"],
  ];

  const SIDE = [
    ["home", "الصفحة الرئيسية", "home"],
    ["bell", "إشعاراتي", "notifications"],
    ["message", "الرسائل", "messages"],
    ["bookmark", "المحفوظات", "saved"],
    ["file", "مساهماتي", "profile"],
    ["settings", "الإعدادات", "settings"],
  ];

  /* ==========================================================================
   Utilities
   ========================================================================== */
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  /* Always show the current profile name (falls back to the name stored on the item). */
  const personName = (x) => publicProfiles[x?.uid]?.name || x?.name || "";
  /* The site admin (same uid that the Firebase rules treat as admin). */
  const ADMIN_UID = "ck3SB5Fb05gjxUd6Hi6u3BdWpsv2";
  const isAdminUid = (uid) => !!uid && uid === ADMIN_UID;
  const ADMIN_BADGE = '<span class="admin-badge"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6l8-3z" fill="#fff" fill-opacity=".28" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.5 12.2l2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>أدمن الموقع</span>';
  const profileLink = (uid, name, cls = "author-profile-link") =>
    uid
      ? `<button type="button" class="${cls}" data-action="open-profile" data-uid="${esc(uid)}">${esc(name)}</button>${isAdminUid(uid) ? ADMIN_BADGE : ""}`
      : esc(name);

  function read(k, f) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v === null ? f : v;
    } catch {
      return f;
    }
  }

  function write(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      toast("تعذر الحفظ في المتصفح؛ قد تكون مساحة التخزين ممتلئة.");
    }
  }

  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const timeAgo = (ts) => {
    const m = Math.max(1, Math.floor((Date.now() - ts) / 60000));
    if (language === "en") {
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    }
    if (m < 60) return `منذ ${m} د`;
    const h = Math.floor(m / 60);
    if (h < 24) return `منذ ${h} س`;
    return `منذ ${Math.floor(h / 24)} ي`;
  };

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const SAFE_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const isSafeImage = (src) =>
    typeof src === "string" && src.length <= 60000 && SAFE_IMAGE.test(src);

  const isStrongPassword = (value) =>
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /[A-Za-z؀-ۿ]/.test(value) &&
    /\d/.test(value);

  /* ---- Usernames and display names ---------------------------------------
     Usernames are unique, case-insensitive, ASCII only. Display names and
     usernames may not contain emoji; only an administrator editing the
     database directly can set one. */
  const normalizeHandle = (value) =>
    String(value || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

  const EMOJI_SOURCE =
    "[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\u200D\\u20E3\\uFE0E\\uFE0F]";
  const EMOJI_RE = (() => {
    try {
      return new RegExp(EMOJI_SOURCE, "u");
    } catch {
      /* Older browsers without Unicode property escapes. */
      return /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2190-\u21FF\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\u200D\u20E3\uFE0E\uFE0F]/;
    }
  })();
  const EMOJI_RE_G = new RegExp(EMOJI_RE.source, EMOJI_RE.flags + "g");
  const INVISIBLE_RE = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
  const hasEmoji = (value) => EMOJI_RE.test(String(value || ""));
  const stripEmoji = (value) =>
    String(value || "")
      .replace(EMOJI_RE_G, "")
      .replace(INVISIBLE_RE, "")
      .replace(/\s{2,}/g, " ")
      .trim();

  function validateName(name) {
    const v = String(name || "").trim();
    if (v.length < 2 || v.length > 50) return "اكتب اسماً من 2 إلى 50 حرفاً.";
    if (hasEmoji(v)) return "لا يمكن استخدام الإيموجي في الاسم.";
    if (INVISIBLE_RE.test(v)) return "الاسم يحتوي على رموز غير مرئية غير مسموحة.";
    return "";
  }

  const RESERVED_HANDLES = new Set([
    "admin", "administrator", "root", "support", "codna", "moderator", "mod",
    "system", "staff", "official", "help", "null", "undefined", "api", "www",
  ]);
  const handleKey = (handle) => normalizeHandle(handle);

  function validateHandle(handle) {
    if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(handle))
      return "اسم المستخدم من 3 إلى 40 خانة: أحرف إنجليزية صغيرة أو أرقام أو _ أو -، ويبدأ بحرف أو رقم.";
    if (RESERVED_HANDLES.has(handle)) return "اسم المستخدم هذا محجوز.";
    return "";
  }

  /* Atomically claims handles/<name> = uid. Returns false if someone else owns it. */
  async function claimHandle(handle, uid) {
    const result = await database
      .ref(`handles/${handleKey(handle)}`)
      .transaction((current) => (current === null || current === uid ? uid : undefined));
    return !!result.committed && result.snapshot.val() === uid;
  }

  function releaseHandle(handle, uid) {
    return database
      .ref(`handles/${handleKey(handle)}`)
      .transaction((current) => (current === uid ? null : undefined));
  }

  /* Reserves `wanted`, or falls back to user_<uid prefix>. Never blocks login. */
  async function reserveHandle(uid, wanted) {
    const base = normalizeHandle(wanted),
      candidates = [];
    if (base && !validateHandle(base)) candidates.push(base);
    for (const n of [8, 12, 16, 24]) candidates.push(normalizeHandle(`user_${uid.slice(0, n)}`));
    for (const c of candidates) {
      try {
        if (await claimHandle(c, uid)) return c;
      } catch (e) {
        log.warn("Codeex: username reservation unavailable.", e);
        return candidates[0];
      }
    }
    return candidates[candidates.length - 1];
  }

  /* Makes sure an existing profile owns its username (migrates old accounts). */
  async function ensureHandleClaim(ref, profile, uid) {
    const current = normalizeHandle(profile.handle);
    try {
      if (current && !validateHandle(current)) {
        const owner = (await database.ref(`handles/${handleKey(current)}`).once("value")).val();
        if (owner === uid && current === profile.handle) return profile;
      }
    } catch (e) {
      log.warn("Codeex: could not verify username ownership.", e);
      return profile;
    }
    const handle = await reserveHandle(uid, current);
    if (handle !== profile.handle) {
      await ref.update({ handle });
      profile = { ...profile, handle };
    }
    return profile;
  }

  const actionStamps = new Map();

  function allowAction(key, minIntervalMs, quiet = false) {
    const now = Date.now();
    if (now - (actionStamps.get(key) || 0) < minIntervalMs) {
      if (!quiet) toast("الرجاء التمهّل قليلاً قبل إعادة المحاولة.");
      return false;
    }
    actionStamps.set(key, now);
    return true;
  }

  const LOGIN_GUARD_KEY = "codna_login_guard";
  const LOGIN_MAX_FAILURES = 5;

  function loginLockRemaining() {
    const state = read(LOGIN_GUARD_KEY, { fails: 0, until: 0 });
    return Math.max(0, (state.until || 0) - Date.now());
  }

  function recordLoginFailure() {
    const state = read(LOGIN_GUARD_KEY, { fails: 0, until: 0 });
    state.fails = (state.fails || 0) + 1;
    if (state.fails >= LOGIN_MAX_FAILURES) {
      const step = state.fails - LOGIN_MAX_FAILURES;
      state.until = Date.now() + Math.min(15 * 60000, 30000 * 2 ** step);
    }
    write(LOGIN_GUARD_KEY, state);
  }

  function resetLoginGuard() {
    write(LOGIN_GUARD_KEY, { fails: 0, until: 0 });
  }

  /* ==========================================================================
   Feedback, dialogs and error handling
   ========================================================================== */

  function toast(text, type = "info") {
    const el = document.querySelector("#toast");
    el.textContent = localizeText(text);
    el.classList.toggle("error", type === "error");
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), type === "error" ? 5000 : 2400);
  }
  let modalScrollY = 0;
  function openModal(title, body) {
    document.querySelector("#modalTitle").textContent = localizeText(title);
    document.querySelector("#modalBody").innerHTML = localizeMarkup(body);
    const backdrop = document.querySelector("#modalBackdrop");
    if (!backdrop.classList.contains("open")) {
      modalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    }
    backdrop.classList.add("open");
    document.body.classList.add("modal-open");
    document.documentElement.classList.add("modal-open");
  }
  function closeModal() {
    const backdrop = document.querySelector("#modalBackdrop");
    if (!backdrop.classList.contains("open")) return;
    backdrop.classList.remove("open");
    backdrop.querySelector(".modal")?.classList.remove("comments-modal", "auth-modal");
    document.body.classList.remove("modal-open");
    document.documentElement.classList.remove("modal-open");
    window.scrollTo(0, modalScrollY);
  }
  const ERROR_MESSAGES = {
    connection: "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.",
    data: "حدث خطأ في معالجة البيانات. حاول مرة أخرى بعد قليل.",
    permission: "لا تملك صلاحية تنفيذ هذا الإجراء.",
    session: "انتهت جلستك. سجّل الدخول مجدداً ثم أعد المحاولة.",
    verification: "تعذّر التحقق من الطلب. أعد تحميل الصفحة ثم حاول مجدداً.",
    throttled: "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.",
    service: "الخدمة غير متاحة حالياً. حاول مرة أخرى لاحقاً.",
  };

  const BAD_CREDENTIALS = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  const LOGIN_INCOMPLETE = "لم يكتمل تسجيل الدخول. أعد المحاولة.";

  const ERROR_BY_CODE = {
    "auth/invalid-credential": BAD_CREDENTIALS,
    "auth/invalid-login-credentials": BAD_CREDENTIALS,
    "auth/wrong-password": BAD_CREDENTIALS,
    "auth/user-not-found": BAD_CREDENTIALS,
    "auth/email-already-in-use": "هذا البريد مسجّل بالفعل.",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
    "auth/weak-password": "كلمة المرور ضعيفة؛ استخدم 8 أحرف على الأقل تتضمن أحرفاً وأرقاماً.",
    "auth/user-disabled": "هذا الحساب غير متاح حالياً.",
    "auth/invalid-action-code":
      "رابط التفعيل غير صالح أو سبق استخدامه؛ إن كان حسابك مفعلاً فسجّل الدخول مباشرة.",
    "auth/expired-action-code": "انتهت صلاحية الرابط؛ سجّل الدخول واطلب رسالة تفعيل جديدة.",
    "auth/account-exists-with-different-credential":
      "يوجد حساب بهذا البريد عبر طريقة دخول أخرى؛ سجّل بالطريقة الأصلية أولاً.",
    "auth/popup-closed-by-user": LOGIN_INCOMPLETE,
    "auth/cancelled-popup-request": LOGIN_INCOMPLETE,
    "auth/popup-blocked": "تم حظر النافذة المنبثقة؛ اسمح بها في المتصفح ثم أعد المحاولة.",
    "auth/web-storage-unsupported":
      "المتصفح يمنع التخزين المطلوب لتسجيل الدخول؛ فعّل ملفات الارتباط ثم أعد المحاولة.",
    "auth/operation-not-supported-in-this-environment":
      "هذا المتصفح لا يدعم تسجيل الدخول بهذه الطريقة؛ افتح الموقع في المتصفح مباشرة.",
  };

  function describeError(err) {
    if (err instanceof AppError) return err.message;
    const code = String(err?.code || "").toLowerCase();
    const text = String(err?.message || "");
    if (ERROR_BY_CODE[code]) return ERROR_BY_CODE[code];
    if (code.startsWith("functions/") && /[؀-ۿ]/.test(text)) return text;
    if (/network|unavailable|deadline|timeout|offline|disconnected/.test(code))
      return ERROR_MESSAGES.connection;
    if (/app-check|appcheck|recaptcha/.test(code)) return ERROR_MESSAGES.verification;
    if (/too-many|throttled|resource-exhausted|quota/.test(code)) return ERROR_MESSAGES.throttled;
    if (/unauthenticated|requires-recent-login|token-expired|user-token/.test(code))
      return ERROR_MESSAGES.session;
    if (/permission|unauthorized-(?!domain)|forbidden/.test(code)) return ERROR_MESSAGES.permission;
    if (
      /unauthorized-domain|operation-not-allowed|invalid-api-key|oauth|continue-uri|configuration/.test(
        code,
      )
    )
      return ERROR_MESSAGES.service;
    if (!code && (err instanceof TypeError || /fetch|network/i.test(text)))
      return ERROR_MESSAGES.connection;
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return ERROR_MESSAGES.connection;
    return ERROR_MESSAGES.data;
  }

  let lastErrorToastAt = 0;

  function handleError(err, { quiet = false } = {}) {
    log.error(err);
    const message = describeError(err);
    const box = quiet ? null : document.querySelector("#modalBackdrop.open #authError");
    if (box) {
      box.textContent = localizeText(message);
      return;
    }
    if (quiet && Date.now() - lastErrorToastAt < 10000) return;
    lastErrorToastAt = Date.now();
    toast(message, "error");
  }

  function onListenError(err) {
    if (!auth?.currentUser) return;
    handleError(err, { quiet: true });
  }

  /* ==========================================================================
   Localization and theme
   ========================================================================== */
  function localizeText(text) {
    if (language !== "en") return text;
    let value = String(text)
      .replace(/^مرحباً\s+/, "Welcome, ")
      .replace(/^عضو منذ\s+/, "Member since ");
    return Object.keys(EN)
      .sort((a, b) => b.length - a.length)
      .reduce((v, k) => v.split(k).join(EN[k]), value);
  }

  function localizeMarkup(markup) {
    if (language !== "en") return markup;
    const held = [];
    let out = String(markup).replace(
      /(<textarea\b[^>]*>)([\s\S]*?)(<\/textarea>)/gi,
      (m, a, b, c) => {
        const token = `__CODNA_TEXTAREA_${held.length}__`;
        held.push([token, a + b + c]);
        return token;
      },
    );
    out = out.replace(/>([^<>]+)</g, (m, t) => `>${localizeText(t)}<`);
    out = out.replace(
      /(placeholder|aria-label|title)="([^"]*)"/g,
      (m, k, v) => `${k}="${localizeText(v)}"`,
    );
    for (const [token, value] of held) out = out.replace(token, value);
    return out;
  }

  function setLanguage() {
    language = "ar";
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.documentElement.dataset.lang = "ar";
    try { localStorage.removeItem("codna_language_v1"); } catch (_) {}
    renderFrame();
  }

  function setTheme(mode, persist = true) {
    const theme = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.content = theme === "dark" ? "#0e1521" : "#f4f7fb";
    const button = document.querySelector("#themeToggle");
    if (button) {
      button.innerHTML =
        theme === "dark"
          ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"/></svg>';
      button.setAttribute(
        "aria-label",
        localizeText(theme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الليلي"),
      );
      button.title = button.getAttribute("aria-label");
    }
    if (persist) write("codna_html_theme_v1", theme);
    const setting = document.querySelector("#themeSettingButton");
    if (setting)
      setting.textContent = localizeText(
        theme === "dark" ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الليلي",
      );
  }

  /* ==========================================================================
   Publishing rules
   ========================================================================== */
  function postFingerprint(p) {
    return [p.kind, p.title, p.text, p.code, p.codeLanguage, p.videoId]
      .map((x) =>
        String(x || "")
          .trim()
          .toLowerCase(),
      )
      .join("\u241f");
  }

  function postCooldownMessage(ms) {
    const min = Math.ceil(Math.max(0, ms) / 60000);
    return language === "ar"
      ? `يمكنك نشر مشاركة جديدة بعد ${min} دقيقة. التعديل متاح في أي وقت.`
      : `You can publish again in ${min} minute(s). Editing remains available.`;
  }

  const MAX_PROJECT_RESOURCE_BYTES = 2 * 1024 * 1024; // projects and resources
  const MAX_DISCUSSION_BYTES = 1024 * 1024; // every other kind
  const PROJECT_RESOURCE_COOLDOWN_MS = 10 * 60 * 1000;
  const isProjectResourceKind = (kind) => ["مشروع", "مورد", "project", "resource"].includes(String(kind || ""));
  const maxCodeBytes = (kind) => (isProjectResourceKind(kind) ? MAX_PROJECT_RESOURCE_BYTES : MAX_DISCUSSION_BYTES);
  const utf8Bytes = (value) => new TextEncoder().encode(String(value || "")).byteLength;
  const wordCount = (value) => String(value || "").trim().split(/\s+/u).filter(Boolean).length;

  function validatePublishDraft(p, existing = null) {
    const isArticle = p.kind === "مقالة", isDiscussion = p.kind === "نقاش";
    if (isArticle) {
      const unchangedLegacyFile = existing && p.fileName === (existing.fileName || "") && p.code === (existing.code || "");
      if (p.fileName && !unchangedLegacyFile)
        throw new AppError(language === "en" ? "Articles cannot include an uploaded file." : "لا يمكن إرفاق ملف بالمقالة.");
      if (wordCount(`${p.title || ""} ${p.text || ""}`) > 1000)
        throw new AppError(language === "en" ? "An article cannot exceed 1,000 words." : "لا يمكن أن تتجاوز المقالة 1000 كلمة.");
    }
    const descriptionLines = String(p.text || "").split(/\r\n|\r|\n/).length;
    if (p.kind !== "مقالة" && p.kind !== "article" && descriptionLines > 500)
      throw new AppError(language === "en" ? "Descriptions cannot exceed 500 lines." : "لا يمكن أن يتجاوز الوصف 500 سطر، باستثناء المقالات.");
    if (!isProjectResourceKind(p.kind) && utf8Bytes(`${p.title || ""}${p.text || ""}${p.code || ""}`) > MAX_DISCUSSION_BYTES)
      throw new AppError(language === "en" ? "The text and code together cannot exceed 1 MB." : "لا يمكن أن يتجاوز مجموع النص والكود 1 ميجابايت.");
    if (isProjectResourceKind(p.kind) && utf8Bytes(p.code || "") > MAX_PROJECT_RESOURCE_BYTES)
      throw new AppError(language === "en" ? "Project/resource code cannot exceed 2 MB." : "لا يمكن أن يتجاوز كود المشروع أو المورد 2 ميجابايت.");
    if (isArticle && selectedCodeFileBase64)
      throw new AppError(language === "en" ? "Articles cannot include an uploaded file." : "لا يمكن إرفاق ملف بالمقالة.");
    if (p.videoId || p.videoProvider) {
      if (!isValidVideoId(p.videoProvider, p.videoId))
        throw new AppError(language === "en" ? "The video link is not valid." : "رابط الفيديو غير صالح.");
      if (String(p.code || "").trim() || p.fileName || selectedCodeFileBase64)
        throw new AppError(language === "en" ? "A post with a video cannot include code or a file." : "لا يمكن إرفاق كود أو ملف مع الفيديو.");
    }
  }

  async function enforcePublishPolicy(p, isEdit = false) {
    if (!activeUser) throw new AppError("سجّل الدخول أولاً.");
    validatePublishDraft(p, isEdit ? findPost(p.id) : null);
    if (isEdit) return;
    const fp = await sha256(postFingerprint(p));
    if (isAdminUid(activeUser.uid)) {
      p.fingerprint = fp; // the site admin has no cooldown, duplicate lock or publishing ban
      return;
    }
    const key = `codna-post-policy-v2:${activeUser.uid}`;
    const now = Date.now();
    let state = read(key, { lastProjectResourceAt: 0, lastFingerprint: "", strikes: 0, bannedUntil: 0 });
    if (state.bannedUntil > now)
      throw new AppError(language === "en" ? "Publishing is temporarily suspended after repeated duplicate attempts." : "تم تعليق النشر مؤقتاً بسبب تكرار محاولات نشر محتوى مكرر.");
    if (isProjectResourceKind(p.kind) && state.lastProjectResourceAt && now - state.lastProjectResourceAt < PROJECT_RESOURCE_COOLDOWN_MS) {
      const min = Math.ceil((PROJECT_RESOURCE_COOLDOWN_MS - (now - state.lastProjectResourceAt)) / 60000);
      throw new AppError(language === "en" ? `You can publish another project/resource in ${min} minute(s).` : `يمكنك نشر مشروع أو مورد آخر بعد ${min} دقيقة.`);
    }
    if (state.lastFingerprint === fp) {
      state.strikes = (state.strikes || 0) + 1;
      state.bannedUntil = state.strikes >= 3 ? now + 86400000 : 0;
      write(key, state);
      throw new AppError(language === "en" ? "This post is a duplicate; change it before trying again." : "هذا المنشور مكرر؛ عدّل المحتوى قبل إعادة المحاولة.");
    }
    p.fingerprint = fp;
  }

  function commitPublishPolicy(p) {
    if (!activeUser || isAdminUid(activeUser.uid)) return;
    const key = `codna-post-policy-v2:${activeUser.uid}`;
    const state = read(key, { lastProjectResourceAt: 0, lastFingerprint: "", strikes: 0, bannedUntil: 0 });
    state.lastFingerprint = p.fingerprint || "";
    state.strikes = 0;
    state.bannedUntil = 0;
    if (isProjectResourceKind(p.kind)) state.lastProjectResourceAt = Date.now();
    write(key, state);
  }

  function postData(p) {
    return {
      id: p.id || "",
      uid: p.uid,
      name: p.name,
      handle: p.handle || "",
      kind: p.kind || "نقاش",
      title: p.title || "",
      text: p.text || "",
      code: p.code || "",
      codeLanguage: p.codeLanguage || "javascript",
      fileName: p.fileName || "",
      fileSize: Number(p.fileSize) || 0,
      videoProvider: safeVideo(p)?.provider || "",
      videoId: safeVideo(p)?.id || "",
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
      avatarUrl: p.avatarUrl || "",
      tone: p.tone || "blue",
      groupId: p.groupId || "",
      isPublic: p.isPublic === true && !p.groupId,
      fingerprint: p.fingerprint || "",
      createdAt: Number(p.createdAt) || Date.now(),
    };
  }
  /* Public copies contain only intentionally shareable fields. Owner IDs stay in a private path. */
  function publicPostData(p) {
    return {
      id: p.id || "",
      isPublic: true,
      groupId: "",
      name: p.name || "عضو Codeex",
      handle: p.handle || "",
      kind: p.kind || "نقاش",
      title: p.title || "",
      text: p.text || "",
      code: p.code || "",
      codeLanguage: p.codeLanguage || "javascript",
      fileName: p.fileName || "",
      videoProvider: safeVideo(p)?.provider || "",
      videoId: safeVideo(p)?.id || "",
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
      tone: p.tone || "blue",
      createdAt: Number(p.createdAt) || Date.now(),
    };
  }

  /* ==========================================================================
   Data layer
   ========================================================================== */
  function normalizePosts(raw, silent = false) {
    raw = raw || {};
    const base = { ...olderRaw, ...raw };
    remoteRawPosts = extrasApplied ? { ...extraRawPosts, ...base } : base;
    cloudPosts = Object.entries(remoteRawPosts)
      .filter(([, v]) => v?.data)
      .map(([id, v]) => {
        const d = v.data,
          reactions = v.reactions || {},
          comments = Object.entries(v.comments || {})
            .map(([commentId, c]) => ({ ...c, id: commentId }))
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const likedBy = Object.keys(reactions).filter((uid) => reactions[uid] === true);
        return {
          ...d,
          tags: Array.isArray(d.tags) ? d.tags : Object.values(d.tags || {}),
          id,
          comments,
          likedBy,
          likes: likedBy.length,
        };
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!silent) scheduleRender();
  }

  /* Coalesces bursts of realtime events into one render. */
  function scheduleRender(frame = false) {
    pendingFrame = pendingFrame || frame;
    if (pendingRender) return;
    pendingRender = setTimeout(() => {
      pendingRender = 0;
      const wantFrame = pendingFrame;
      pendingFrame = false;
      if (wantFrame) renderFrame();
      else if (!["compose", "messages", "settings"].includes(page)) renderPage();
    }, 120);
  }

  /* ---- Lazy feed: only a window of posts is downloaded; more load while scrolling ---- */
  function bindPostsWindow() {
    if (postsWindowRef) {
      postsWindowRef.ref.off("value", postsWindowRef.fn);
      coreRefs = coreRefs.filter((x) => x[2] !== postsWindowRef.fn);
    }
    const limit = postLimit,
      ref = database.ref("posts").orderByChild("data/createdAt").limitToLast(limit),
      fn = (snap) => {
        const raw = snap.val() || {};
        postsReady = true;
        postsLoadError = false;
        if (!olderPages.length) postsExhausted = Object.keys(raw).length < limit;
        loadingMore = false;
        clearTimeout(loadingTimer);
        lastWindowRaw = raw;
        normalizePosts(raw);
        openSharedPostWhenReady();
      },
      onError = (err) => {
        postsLoadError = !postsReady;
        postsReady = true;
        loadingMore = false;
        clearTimeout(loadingTimer);
        onListenError(err);
        scheduleRender();
      };
    ref.on("value", fn, onError);
    postsWindowRef = { ref, fn };
    coreRefs.push([ref, "value", fn]);
  }

  function bindOwnPostCount() {
    if (!activeUser) return;
    const ref = database
        .ref("posts")
        .orderByChild("data/uid")
        .equalTo(activeUser.uid)
        .limitToLast(200),
      fn = (snap) => {
        const next = Object.keys(snap.val() || {}).length;
        if (next === ownPostCount) return;
        ownPostCount = next;
        scheduleRender(true);
      };
    ref.on("value", fn, onListenError);
    coreRefs.push([ref, "value", fn]);
  }

  /* Older posts load as separate small pages (cursor = oldest post already shown),
     so each scroll downloads only the next page instead of re-downloading everything. */
  function loadMorePosts(size = POST_PAGE) {
    if (loadingMore || postsExhausted || !database || !activeUser) return;
    const known = new Set(Object.keys({ ...olderRaw, ...lastWindowRaw })),
      stamps = Object.values({ ...olderRaw, ...lastWindowRaw })
        .map((v) => Number(v?.data?.createdAt))
        .filter((n) => Number.isFinite(n) && n > 0);
    if (!stamps.length) return;
    const n = Math.max(1, size),
      ref = database
        .ref("posts")
        .orderByChild("data/createdAt")
        .endAt(Math.min(...stamps))
        .limitToLast(n + 1),
      page = { ref, raw: {}, fn: null, first: true };
    loadingMore = true;
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      loadingMore = false;
      scheduleRender();
    }, 10000);
    scheduleRender();
    page.fn = (snap) => {
      page.raw = snap.val() || {};
      if (page.first) {
        page.first = false;
        const fresh = Object.keys(page.raw).filter((id) => !known.has(id)).length;
        postsExhausted = fresh < n;
        loadingMore = false;
        clearTimeout(loadingTimer);
      }
      olderRaw = Object.assign({}, ...olderPages.map((x) => x.raw));
      normalizePosts(lastWindowRaw);
    };
    olderPages.push(page);
    ref.on("value", page.fn, (err) => {
      olderPages = olderPages.filter((x) => x !== page);
      loadingMore = false;
      clearTimeout(loadingTimer);
      onListenError(err);
      scheduleRender();
    });
    coreRefs.push([ref, "value", page.fn]);
  }

  function ensurePostWindow(min) {
    if (!database || !activeUser || postsExhausted) return;
    const have = Object.keys({ ...olderRaw, ...lastWindowRaw }).length;
    if (have < min) loadMorePosts(Math.min(min - have, 300));
  }

  function rebuildExtraRaw() {
    const merged = {};
    for (const w of extraWatches.values()) Object.assign(merged, w.raw);
    Object.assign(merged, savedRawPosts);
    extraRawPosts = merged;
  }

  /* Posts that live outside the feed window (a member's profile, a group) are
     loaded on demand with a query, and dropped when you leave that page. */
  function syncExtraWatchers(wanted) {
    const keep = new Set(wanted.map(([path, value]) => `${path}:${value}`));
    let removedAny = false;
    for (const [key, w] of extraWatches) {
      if (keep.has(key)) continue;
      w.ref.off("value", w.fn);
      extraWatches.delete(key);
      removedAny = true;
    }
    if (removedAny) rebuildExtraRaw();
    if (!database) return;
    for (const [path, value] of wanted) {
      const key = `${path}:${value}`;
      if (!value || extraWatches.has(key)) continue;
      const ref = database.ref("posts").orderByChild(path).equalTo(value).limitToLast(100),
        w = { ref, raw: {}, fn: null };
      w.fn = (snap) => {
        w.raw = snap.val() || {};
        rebuildExtraRaw();
        normalizePosts(lastWindowRaw);
      };
      ref.on("value", w.fn, onListenError);
      extraWatches.set(key, w);
    }
  }

  function ensureSavedLoaded() {
    if (!database) return;
    const missing = Store.saved()
      .filter((id) => !remoteRawPosts[id] && !savedFetched.has(id))
      .slice(0, 50);
    if (!missing.length) return;
    missing.forEach((id) => savedFetched.add(id));
    Promise.all(
      missing.map((id) =>
        database
          .ref(`posts/${id}`)
          .once("value")
          .then((snap) => [id, snap.val()])
          .catch(() => [id, null]),
      ),
    ).then((rows) => {
      rows.forEach(([id, v]) => {
        if (v?.data) savedRawPosts[id] = v;
      });
      rebuildExtraRaw();
      normalizePosts(lastWindowRaw);
    });
  }

  function feedSentinel() {
    if (!postsReady || postsLoadError) return "";
    if (postsExhausted)
      return Store.posts().length ? '<div class="feed-end">وصلت إلى نهاية المنشورات</div>' : "";
    const noObserver = !("IntersectionObserver" in window);
    return `<div id="feedSentinel" class="feed-sentinel">${noObserver ? '<button class="btn small" data-action="load-more">عرض المزيد</button>' : ""}</div>`;
  }

  function setupFeedObserver() {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
    const el = document.querySelector("#feedSentinel");
    if (!el || postsExhausted || !("IntersectionObserver" in window)) return;
    feedObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMorePosts();
      },
      { rootMargin: "250px 0px" },
    );
    feedObserver.observe(el);
  }

  function writeUserMap(key, ids) {
    if (!activeUser) return Promise.resolve();
    const obj = {};
    ids.forEach((id) => (obj[String(id)] = true));
    return database.ref(`users/${activeUser.uid}/${key}`).set(obj).catch(handleError);
  }

  function isGroupMember(g) {
    return (
      !!activeUser &&
      !!g &&
      (g.ownerUid === activeUser.uid || groupMembersMap[g.id]?.[activeUser.uid] === true)
    );
  }

  let groupAdminMap = {};
  /* The owner, an appointed group admin and the site admin can manage a group's members. */
  const canManageGroup = (g) =>
    !!activeUser && !!g && (g.ownerUid === activeUser.uid || groupAdminMap[g.id] === true || isAdminUid(activeUser.uid));
  /* The site admin joins any group straight away: a private group behaves like a public one for him. */
  const needsApproval = (g) => g.visibility === "private" && !isAdminUid(activeUser?.uid);

  function stopMembershipWatchers() {
    groupMemberUnsubs.forEach((fn) => fn());
    groupMemberUnsubs = [];
    groupMembersMap = {};
    groupMembershipOverrides = {};
    groupAdminMap = {};
  }

  function syncMembershipWatchers() {
    groupMemberUnsubs.forEach((fn) => fn());
    groupMemberUnsubs = [];
    if (!activeUser) {
      groupMembersMap = {};
      groupMembershipOverrides = {};
      joinedIds = [];
      return;
    }
    const validIds = new Set(remoteGroups.map((g) => g.id));
    for (const id of Object.keys(groupMembersMap))
      if (!validIds.has(id)) delete groupMembersMap[id];
    for (const id of Object.keys(groupMembershipOverrides))
      if (!validIds.has(id)) delete groupMembershipOverrides[id];
    joinedIds = remoteGroups.filter((g) => isGroupMember(g)).map((g) => g.id);
    for (const g of remoteGroups) {
      const r = database.ref(`groupMembers/${g.id}/${activeUser.uid}`),
        fn = (s) => {
          const isMember = s.val() === true;
          if (Object.prototype.hasOwnProperty.call(groupMembershipOverrides, g.id)) {
            if (isMember !== groupMembershipOverrides[g.id]) return;
            delete groupMembershipOverrides[g.id];
          }
          const map = groupMembersMap[g.id] || (groupMembersMap[g.id] = {});
          if (isMember) map[activeUser.uid] = true;
          else {
            delete map[activeUser.uid];
            if (!Object.keys(map).length) delete groupMembersMap[g.id];
          }
          joinedIds = remoteGroups.filter((x) => isGroupMember(x)).map((x) => x.id);
          syncGroupWatchers();
          if (g.visibility === "private") {
            if (isGroupMember(g)) subscribePrivateGroup(g);
            else if (privateGroupUnsubs[g.id]) {
              privateGroupUnsubs[g.id]();
              delete privateGroupUnsubs[g.id];
              delete privateGroupPosts[g.id];
            }
          }
          if (page === "groups" || page === "group-detail") renderFrame();
        };
      r.on("value", fn, onListenError);
      groupMemberUnsubs.push(() => r.off("value", fn));
      const adminRef = database.ref(`groupAdmins/${g.id}/${activeUser.uid}`),
        adminFn = (s) => {
          const was = groupAdminMap[g.id] === true;
          groupAdminMap[g.id] = s.val() === true;
          if (was !== groupAdminMap[g.id] && (page === "groups" || page === "group-detail")) renderFrame();
        };
      adminRef.on("value", adminFn, () => {});
      groupMemberUnsubs.push(() => adminRef.off("value", adminFn));
    }
  }

  function syncGroupWatchers() {
    groupRequestUnsubs.forEach((fn) => fn());
    groupRequestUnsubs = [];
    if (!activeUser) return;
    for (const g of remoteGroups) {
      const path =
        g.ownerUid === activeUser.uid
          ? `groupRequests/${g.id}`
          : g.visibility === "private" && !isGroupMember(g)
            ? `groupRequests/${g.id}/${activeUser.uid}`
            : "";
      if (!path) continue;
      const r = database.ref(path),
        fn = (s) => {
          if (g.ownerUid === activeUser.uid) groupRequestData[g.id] = s.val() || {};
          else groupPendingStatus[g.id] = !!s.val();
          if (page === "groups") renderPage();
        };
      r.on("value", fn, onListenError);
      groupRequestUnsubs.push(() => r.off("value", fn));
    }
  }

  function replaceGroups(raw) {
    rawGroupData = raw || {};
    remoteGroups = Object.entries(rawGroupData)
      .map(([id, g]) => ({
        ...g,
        id,
        visibility: g.visibility === "private" ? "private" : "public",
      }))
      .filter(
        (g) =>
          typeof g.ownerUid === "string" &&
          g.ownerUid.length > 0 &&
          typeof g.name === "string" &&
          g.name.trim().length >= 2,
      );
    groups.splice(0, groups.length, ...remoteGroups);
    syncMembershipWatchers();
    syncGroupWatchers();
    if (page === "groups" || page === "home" || page === "group-detail") renderFrame();
  }

  function stopPrivateGroupWatchers() {
    Object.values(privateGroupUnsubs).forEach((fn) => fn());
    privateGroupUnsubs = {};
    privateGroupPosts = {};
  }

  function subscribePrivateGroup(g) {
    if (!g || g.visibility !== "private" || !isGroupMember(g) || privateGroupUnsubs[g.id]) return;
    const r = database.ref(`groupPosts/${g.id}`),
      fn = (s) => {
        const raw = s.val() || {};
        privateGroupPosts[g.id] = Object.entries(raw)
          .filter(([, v]) => v?.data)
          .map(([id, v]) => {
            const reactions = v.reactions || {},
              comments = Object.entries(v.comments || {})
                .map(([commentId, c]) => ({ ...c, id: commentId }))
                .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
              likedBy = Object.keys(reactions).filter((uid) => reactions[uid] === true);
            return {
              ...v.data,
              id,
              privateGroupId: g.id,
              comments,
              likedBy,
              likes: likedBy.length,
            };
          })
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (page === "group-detail" && selectedGroupId === g.id) renderPage();
      };
    r.on("value", fn, onListenError);
    privateGroupUnsubs[g.id] = () => r.off("value", fn);
  }

  function postRootPath(p) {
    return p?.privateGroupId ? `groupPosts/${p.privateGroupId}/${p.id}` : `posts/${p.id}`;
  }

  function stopUserWatchers() {
    userUnsubs.forEach((fn) => fn());
    userUnsubs = [];
    if (activeChatRef) {
      activeChatRef.ref.off("value", activeChatRef.callback);
      activeChatRef = null;
    }
  }

  function watchUserPath(path, callback) {
    const r = database.ref(path),
      fn = (s) => callback(s.val() || {});
    r.on("value", fn, onListenError);
    userUnsubs.push(() => r.off("value", fn));
  }

  function updateNotificationIndicator() {
    const dot = document.querySelector("#topNoticeDot"),
      button = document.querySelector('.top-inner [data-page="notifications"]'),
      count = noticeItems.filter((n) => !n.read).length;
    if (dot) dot.hidden = count === 0;
    if (button) {
      const label = count ? `الإشعارات، ${count} غير مقروء` : "الإشعارات";
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  }

  /* ---------- Follow requests (messaging opens only after a follow request is accepted) ---------- */
  let followingSet = {}, followersSet = {}, incomingFollowReqs = {}, sentFollowReqs = {}, followUnsubs = [], mobileChat = false;
  const isFollowing = (uid) => followingSet[uid] === true;
  const isFollower = (uid) => followersSet[uid] === true;
  const canMessage = (uid) => !!activeUser && !!uid && uid !== activeUser.uid && (isFollowing(uid) || isFollower(uid));
  const connectionUids = () =>
    [...new Set([...Object.keys(followingSet), ...Object.keys(followersSet)])].filter(
      (id) => id !== activeUser?.uid && publicProfiles[id] && (followingSet[id] === true || followersSet[id] === true),
    );
  function stopFollowWatchers() {
    followUnsubs.forEach((fn) => fn());
    followUnsubs = [];
  }
  function startFollowWatchers(uid) {
    stopFollowWatchers();
    const watch = (path, set) => {
      const r = database.ref(path);
      const fn = (snap) => {
        set(snap.val() || {});
        if (["messages", "profile", "notifications"].includes(page) && !document.activeElement?.matches("input,textarea")) renderPage();
      };
      r.on("value", fn, onListenError);
      followUnsubs.push(() => r.off("value", fn));
    };
    watch(`following/${uid}`, (v) => { followingSet = v; });
    watch(`followers/${uid}`, (v) => { followersSet = v; });
    watch(`followRequests/${uid}`, (v) => { incomingFollowReqs = v; });
    watch(`followSent/${uid}`, (v) => { sentFollowReqs = v; });
  }
  async function followAction(action, uid) {
    const me = activeUser;
    if (!me || !uid || uid === me.uid) return;
    if (!allowAction("follow", 700, true)) return;
    const now = Date.now(), up = {}, en = language === "en", myName = me.name || (en ? "A member" : "عضو");
    try {
      if (action === "follow") {
        if (isFollowing(uid) || sentFollowReqs[uid]) return;
        up[`followRequests/${uid}/${me.uid}`] = { uid: me.uid, name: myName, requestedAt: now };
        up[`followSent/${me.uid}/${uid}`] = { requestedAt: now };
        await database.ref().update(up);
        sentFollowReqs = { ...sentFollowReqs, [uid]: { requestedAt: now } };
        toast("أُرسل طلب المتابعة. ستظهر المراسلة عند قبوله.");
        addNotification(uid, { type: "follow_request", text: en ? `${myName} wants to follow you.` : `${myName} يريد متابعتك.` }).catch(() => {});
      } else if (action === "cancel-follow" || action === "decline-follow") {
        const asTarget = action === "decline-follow";
        up[`followRequests/${asTarget ? me.uid : uid}/${asTarget ? uid : me.uid}`] = null;
        up[`followSent/${asTarget ? uid : me.uid}/${asTarget ? me.uid : uid}`] = null;
        await database.ref().update(up);
        if (asTarget) { incomingFollowReqs = { ...incomingFollowReqs }; delete incomingFollowReqs[uid]; toast("رُفض طلب المتابعة"); }
        else { sentFollowReqs = { ...sentFollowReqs }; delete sentFollowReqs[uid]; toast("أُلغي طلب المتابعة"); }
      } else if (action === "accept-follow") {
        if (!incomingFollowReqs[uid]) return;
        up[`followers/${me.uid}/${uid}`] = true;
        up[`following/${uid}/${me.uid}`] = true;
        up[`followRequests/${me.uid}/${uid}`] = null;
        up[`followSent/${uid}/${me.uid}`] = null;
        await database.ref().update(up);
        followersSet = { ...followersSet, [uid]: true };
        incomingFollowReqs = { ...incomingFollowReqs }; delete incomingFollowReqs[uid];
        toast("قبلت طلب المتابعة. يمكنكما الآن المراسلة.");
        addNotification(uid, { type: "follow_accepted", text: en ? `${myName} accepted your follow request. You can now message each other.` : `${myName} قبل طلب متابعتك. يمكنكما الآن المراسلة.` }).catch(() => {});
      } else if (action === "unfollow" || action === "remove-follower") {
        const iFollow = action === "unfollow";
        up[`followers/${iFollow ? uid : me.uid}/${iFollow ? me.uid : uid}`] = null;
        up[`following/${iFollow ? me.uid : uid}/${iFollow ? uid : me.uid}`] = null;
        await database.ref().update(up);
        if (iFollow) { followingSet = { ...followingSet }; delete followingSet[uid]; toast("ألغيت متابعة هذا العضو"); }
        else { followersSet = { ...followersSet }; delete followersSet[uid]; toast("أُزيل المتابع"); }
      }
      renderPage();
    } catch (error) {
      handleError(error);
    }
  }
  function profileFollowActions(user) {
    const uid = esc(user.uid);
    const follow = isFollowing(user.uid)
      ? `<button class="btn" data-action="unfollow" data-uid="${uid}">✓ تتابع هذا العضو</button>`
      : sentFollowReqs[user.uid]
        ? `<button class="btn soft" data-action="cancel-follow" data-uid="${uid}">طلب المتابعة قيد الانتظار · إلغاء</button>`
        : incomingFollowReqs[user.uid]
          ? `<button class="btn primary" data-action="accept-follow" data-uid="${uid}">قبول طلب المتابعة</button><button class="btn ghost" data-action="decline-follow" data-uid="${uid}">رفض طلب المتابعة</button>`
          : `<button class="btn primary" data-action="follow" data-uid="${uid}">${icon("plus")} متابعة العضو</button>`;
    const message = canMessage(user.uid) ? `<button class="btn" data-action="message-user" data-uid="${uid}">${icon("comment")} مراسلة</button>` : "";
    return `<div class="profile-cover-actions">${follow}${message}<button class="btn" data-page="home">العودة</button></div>`;
  }

  const NOTICE_TTL_MS = 6 * 24 * 60 * 60 * 1000;
  /* Read notifications are removed 6 days after they were read. Returns the ones that remain. */
  function pruneNotifications(uid, raw) {
    const now = Date.now(), keep = [];
    for (const [key, n] of Object.entries(raw || {})) {
      if (!n || typeof n !== "object") continue;
      const id = n.id || key;
      if (n.read === true) {
        const readAt = Number(n.readAt) || 0;
        if (!readAt) {
          // Read before this feature existed: start the 6-day clock now.
          database.ref(`users/${uid}/notifications/${id}/readAt`).set(now).catch(() => {});
        } else if (now - readAt > NOTICE_TTL_MS) {
          database.ref(`users/${uid}/notifications/${id}`).remove().catch(() => {});
          continue;
        }
      }
      keep.push({ ...n, id });
    }
    return keep;
  }

  function syncUserState(uid) {
    stopUserWatchers();
    startFollowWatchers(uid);
    watchUserPath(`users/${uid}/saved`, (v) => {
      savedIds = Object.keys(v).filter((k) => v[k] === true);
      if (!["compose", "messages", "settings"].includes(page)) renderPage();
    });
    watchUserPath(`users/${uid}/notifications`, (v) => {
      noticeItems = pruneNotifications(uid, v);
      updateNotificationIndicator();
      if (page === "notifications") renderPage();
    });
  }

  async function updateProfile(patch) {
    if (!activeUser?.uid) throw new AppError("سجّل الدخول أولاً.");
    const ref = database.ref(`profiles/${activeUser.uid}`),
      snap = await ref.once("value"),
      current = snap.val() || (await ensureProfile(auth.currentUser));
    let claimed = "";
    if (typeof patch.handle === "string" && patch.handle !== current.handle) {
      const problem = validateHandle(patch.handle);
      if (problem) throw new AppError(problem);
      let ok = false;
      try {
        ok = await claimHandle(patch.handle, activeUser.uid);
      } catch (e) {
        log.warn("Codeex: username claim failed.", e);
        throw new AppError("تعذّر حجز اسم المستخدم الآن؛ حاول مرة أخرى بعد قليل.");
      }
      if (!ok) throw new AppError("اسم المستخدم هذا مستخدم من عضو آخر؛ اختر اسماً مختلفاً.");
      claimed = patch.handle;
    }
    const next = {
      ...current,
      ...patch,
      uid: activeUser.uid,
      joinedAt: Number(current.joinedAt) || Date.now(),
    };
    try {
      await ref.set(next);
    } catch (e) {
      if (claimed && handleKey(claimed) !== handleKey(current.handle))
        releaseHandle(claimed, activeUser.uid).catch(() => {});
      throw e;
    }
    if (claimed && current.handle && handleKey(current.handle) !== handleKey(claimed))
      releaseHandle(current.handle, activeUser.uid).catch(() => {});
    activeUser = { ...activeUser, ...next };
    if (auth.currentUser) publicProfiles[activeUser.uid] = next;
    renderFrame();
    return next;
  }

  async function ensureProfile(user, preferredName = "") {
    const r = database.ref(`profiles/${user.uid}`),
      snap = await r.once("value");
    let profile = snap.val();
    if (profile && Object.prototype.hasOwnProperty.call(profile, "followers")) {
      await r.child("followers").remove();
      delete profile.followers;
    }
    if (!profile) {
      const name =
        stripEmoji(preferredName || user.displayName || "")
          .slice(0, 50)
          .trim() || "مطور جديد";
      const handle = await reserveHandle(user.uid, `user_${user.uid.slice(0, 8)}`);
      profile = {
        uid: user.uid,
        name: name.length >= 2 ? name : "مطور جديد",
        handle,
        bio: "",
        avatarUrl: "",
        joinedAt: Date.now(),
      };
      await r.set(profile);
      await database.ref(`users/${user.uid}/notifications/welcome`).set({
        id: "welcome",
        text: "مرحباً بك في Codeex. أكمل ملفك الشخصي وشارك أول مشروع.",
        type: "welcome",
        time: Date.now(),
        read: false,
      });
    } else {
      profile = await ensureHandleClaim(r, profile, user.uid);
    }
    return profile;
  }

  function stopCoreListeners() {
    for (const [ref, event, fn] of coreRefs) ref.off(event, fn);
    coreRefs = [];
    coreStarted = false;
    olderPages = [];
    olderRaw = {};
    postsWindowRef = null;
    postLimit = POST_PAGE;
    postsReady = false;
    postsLoadError = false;
    postsExhausted = false;
    loadingMore = false;
    clearTimeout(loadingTimer);
    lastWindowRaw = {};
    extraRawPosts = {};
    savedRawPosts = {};
    savedFetched = new Set();
    extrasApplied = false;
    ownPostCount = 0;
    for (const w of extraWatches.values()) w.ref.off("value", w.fn);
    extraWatches.clear();
  }

  function startCoreListeners() {
    if (coreStarted) return;
    coreStarted = true;
    const bind = (path, callback) => {
      const ref = database.ref(path),
        fn = (s) => callback(s);
      ref.on("value", fn, onListenError);
      coreRefs.push([ref, "value", fn]);
    };
    if (!postsWindowRef) bindPostsWindow();
    bindOwnPostCount();
    bind("groups", (s) => replaceGroups(s.val()));
    bind("profiles", (s) => {
      publicProfiles = s.val() || {};
      if (activeUser && publicProfiles[activeUser.uid])
        activeUser = { ...activeUser, ...publicProfiles[activeUser.uid] };
      replaceGroups(rawGroupData);
      scheduleRender(true);
      maybeOpenChat();
    });
  }

  function conversationMessagesRef(otherUid) {
    const pair = [activeUser.uid, otherUid].sort();
    return database.ref(`conversations/${pair[0]}/${pair[1]}/messages`);
  }

  function subscribeConversation(otherUid) {
    if (!activeUser || !otherUid || otherUid === activeUser.uid) return;
    if (activeChatRef?.otherUid === otherUid) {
      activeConversation = otherUid;
      return;
    }
    activeConversation = otherUid;
    if (activeChatRef) activeChatRef.ref.off("value", activeChatRef.callback);
    const r = conversationMessagesRef(otherUid),
      fn = (s) => {
        activeMessages = Object.entries(s.val() || {})
          .map(([messageId, m]) => ({ ...m, id: messageId }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (page === "messages" && !document.activeElement?.matches("input,textarea")) renderPage();
      };
    r.on("value", fn, onListenError);
    activeChatRef = { ref: r, callback: fn, otherUid };
    if (page === "messages" && !document.activeElement?.matches("input,textarea")) renderPage();
  }

  function maybeOpenChat() {
    if (page !== "messages" || !activeUser) return;
    const ids = connectionUids();
    const target = activeConversation && ids.includes(activeConversation) ? activeConversation : ids[0];
    if (target && target !== activeConversation) subscribeConversation(target);
  }

  async function publishPost(p) {
    if (!activeUser || !database) throw new AppError("سجّل الدخول أولاً.");
    const isEdit = !!editingPostId;
    await enforcePublishPolicy(p, isEdit);
    const group = p.groupId ? groups.find((g) => g.id === p.groupId) : null;
    if (p.isPublic === true && (p.groupId || group))
      throw new AppError("لا يمكن جعل منشور المجموعة عاماً؛ منشورات المجموعات لا تُنشر خارجها.");
    const previousIsPublic = p.previouslyPublic === true || remoteRawPosts[p.id]?.data?.isPublic === true;
    const targetPath = group?.visibility === "private"
      ? `groupPosts/${group.id}/${p.id}/data`
      : `posts/${p.id}/data`;
    // The authenticated feed remains protected. A separate, minimized copy is published only
    // for an explicitly public post; private group content is never written to publicPosts.
    await database.ref(targetPath).set(postData(p));
    if (p.isPublic === true && !p.groupId) {
      const ownerPath = `publicPostOwners/${p.id}`;
      await database.ref(ownerPath).set(activeUser.uid);
      try {
        await database.ref(`publicPosts/${p.id}/data`).set(publicPostData(p));
        await database.ref(`publicPostIndex/${p.id}`).set(true);
      } catch (error) {
        await database.ref(`publicPostIndex/${p.id}`).remove().catch(() => {});
        await database.ref(`publicPosts/${p.id}/data`).remove().catch(() => {});
        await database.ref(ownerPath).remove().catch(() => {});
        throw error;
      }
    } else if (previousIsPublic) {
      // Hide from the public sitemap first, then remove its public body and private owner marker.
      await database.ref(`publicPostIndex/${p.id}`).remove();
      await database.ref(`publicPosts/${p.id}/data`).remove();
      await database.ref(`publicPostOwners/${p.id}`).remove();
    }
    if (!isEdit) commitPublishPolicy(p);
  }

  async function addNotification(targetUid, note) {
    if (!activeUser || !targetUid || targetUid === activeUser.uid) return;
    const r = database.ref(`users/${targetUid}/notifications`).push();
    await r.set({ ...note, id: r.key, actorUid: activeUser.uid, read: false, time: Date.now() });
  }

  let lastRenderedPage = "";
  const COMMENT_PAGE = 10;
  const MAX_COMMENTS_PER_USER = 2;
  let commentsLimit = COMMENT_PAGE;
  const myCommentCount = (p) => (p.comments || []).filter((c) => c.uid && c.uid === activeUser?.uid).length;

  function commentCardHtml(c) {
    return `<article class="comment-card"><span class="avatar"${c.uid ? ` data-action="open-profile" data-uid="${esc(c.uid)}"` : ""}>${avatarContent(c)}</span><div class="comment-content"><div class="comment-head"><strong>${profileLink(c.uid, personName(c) || "عضو")}</strong><time>${timeAgo(c.createdAt || Date.now())}</time></div><p class="comment-body">${esc(c.text)}</p></div></article>`;
  }
  /* Newest comments first; `limit` of them are shown, the rest sit behind a "show more" button (10 at a time). */
  function commentsListHtml(p, limit) {
    const sorted = [...(p.comments || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const shown = sorted.slice(0, limit), rest = sorted.length - shown.length;
    const list = shown.map(commentCardHtml).join("") || '<p class="muted">لا توجد تعليقات بعد. كن أول من يشارك رأيه.</p>';
    return list + (rest > 0 ? `<button type="button" class="btn ghost more-comments" data-action="more-comments" data-id="${esc(p.id)}">عرض المزيد (${Math.min(COMMENT_PAGE, rest)} من ${rest})</button>` : "");
  }
  function commentComposerHtml(p) {
    const left = Math.max(0, MAX_COMMENTS_PER_USER - myCommentCount(p));
    if (!left)
      return `<p class="comment-limit">وصلت إلى الحد الأقصى: تعليقان لكل شخص على المنشور الواحد.</p>`;
    const hint = language === "en" ? `You can add ${left} more of ${MAX_COMMENTS_PER_USER} comments on this post.` : `يمكنك إضافة ${left} من ${MAX_COMMENTS_PER_USER} تعليقات على هذا المنشور.`;
    return `<form id="commentForm" class="comment-composer"><input type="hidden" id="commentPostId" value="${esc(p.id)}"><textarea class="field" id="commentText" maxlength="400" placeholder="اكتب تعليقاً واضحاً ومحترماً..." required></textarea><small class="muted comment-left">${esc(hint)}</small><div class="modal-actions"><button class="btn primary" type="submit">إرسال التعليق</button></div></form>`;
  }

  async function addComment(postId, text) {
    if (!activeUser) throw new AppError("سجّل الدخول لإضافة تعليق.");
    const p = findPost(postId);
    if (!p) throw new AppError("المنشور غير متاح حالياً.");
    const limitMessage = "يمكنك التعليق مرتين فقط على المنشور الواحد.";
    if (myCommentCount(p) >= MAX_COMMENTS_PER_USER) throw new AppError(limitMessage);
    const base = postRootPath(p), uid = activeUser.uid;
    // The server-side counter is what the Firebase rules check; it is written in the same update as the comment.
    const used = Number((await database.ref(`${base}/commentCounts/${uid}`).once("value")).val()) || 0;
    if (used >= MAX_COMMENTS_PER_USER) throw new AppError(limitMessage);
    const key = database.ref(`${base}/comments`).push().key;
    await database.ref().update({
      [`${base}/comments/${key}`]: { uid, name: activeUser.name, text, createdAt: Date.now() },
      [`${base}/commentCounts/${uid}`]: used + 1,
    });
    if (p.uid !== activeUser.uid) {
      try {
        await addNotification(p.uid, {
          postId,
          commentId: key,
          type: "comment",
          ...(p.privateGroupId ? { groupId: p.privateGroupId } : {}),
          text: `علّق ${activeUser.name} على منشورك.`,
        });
      } catch (notificationError) {
        log.warn("Codeex: التعليق حُفظ، لكن تعذّر إرسال إشعار التعليق.", notificationError);
      }
    }
  }

  async function makeAvatarDataUrl(file) {
    const bitmap = await new Promise((resolve, reject) => {
      const fallback = () => {
        const image = new Image(),
          url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Image decoding failed"));
        };
        image.src = url;
      };
      if (typeof window.createImageBitmap === "function")
        window.createImageBitmap(file).then(resolve, fallback);
      else fallback();
    });
    try {
      const maxSide = 160,
        scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [0.78, 0.62, 0.48, 0.34, 0.24, 0.16]) {
        const data = canvas.toDataURL("image/jpeg", q);
        if (data.length <= 20000) return data;
      }
      throw new AppError("الصورة كبيرة جداً؛ جرّب صورة أصغر.");
    } finally {
      bitmap.close?.();
    }
  }

  function avatarContent(person) {
    const profile = person?.uid ? publicProfiles[person.uid] : null;
    const src =
      person?.avatarUrl || person?.avatarData || profile?.avatarUrl || profile?.avatarData;
    return isSafeImage(src)
      ? `<img src="${esc(src)}" alt="">`
      : esc(person?.avatar || person?.name?.slice(0, 1) || "ز");
  }

  /* ==========================================================================
   Authentication
   ========================================================================== */
  async function signInGoogle() {
    if (!auth) {
      toast("خدمات تسجيل الدخول غير متاحة بعد؛ انتظر لحظات ثم أعد المحاولة.");
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      if (/\.github\.io$/i.test(location.hostname)) {
        await auth.signInWithRedirect(provider);
        return;
      }
      await auth.signInWithPopup(provider);
      page = "home";
      closeModal();
      toast("تم تسجيل الدخول باستخدام Google");
    } catch (e) {
      handleError(e);
    }
  }

  async function signInGithub() {
    if (!auth) {
      toast("خدمات تسجيل الدخول غير متاحة بعد؛ انتظر لحظات ثم أعد المحاولة.");
      return;
    }
    const provider = new firebase.auth.GithubAuthProvider();
    provider.addScope("read:user");
    provider.addScope("user:email");
    try {
      if (/\.github\.io$/i.test(location.hostname)) {
        await auth.signInWithRedirect(provider);
        return;
      }
      await auth.signInWithPopup(provider);
      page = "home";
      closeModal();
      toast("تم تسجيل الدخول باستخدام GitHub");
    } catch (e) {
      handleError(e);
    }
  }
  function verifyActionSettings() {
    return { url: location.origin + location.pathname + "?verified=1", handleCodeInApp: false };
  }

  function setAuthInfo(msg) {
    const b = document.querySelector("#authInfo"),
      er = document.querySelector("#authError");
    if (er) er.textContent = "";
    if (b) b.textContent = localizeText(msg);
  }

  function showVerificationSent(email) {
    openModal(
      "تحقق من بريدك الإلكتروني",
      `<div class="form-grid" style="padding:0"><p>أرسلنا رابط التفعيل إلى <b dir="ltr">${esc(email)}</b>. افتح الرسالة واضغط على الرابط لتفعيل حسابك، وبعدها ستصل إلى صفحة تسجيل الدخول.</p><p class="muted" style="font-size:12px;margin:0">لم تصلك الرسالة؟ راجع مجلد الرسائل غير المرغوب فيها (Spam).</p><button class="btn primary" data-auth="login">الذهاب إلى تسجيل الدخول</button></div>`,
    );
  }

  function showUnverified() {
    const er = document.querySelector("#authError"),
      b = document.querySelector("#resendBtn");
    if (er)
      er.textContent = localizeText(
        "بريدك الإلكتروني غير مفعّل بعد. افتح رسالة التفعيل المرسلة إليك ثم سجّل الدخول.",
      );
    if (b) b.classList.remove("hidden");
  }

  function cleanActionUrl() {
    try {
      const u = new URL(location.href);
      ["mode", "oobCode", "apiKey", "lang", "continueUrl", "verified"].forEach((k) =>
        u.searchParams.delete(k),
      );
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    } catch {}
  }

  async function handleAuthAction() {
    if (authActionHandled || !auth) return;
    const q = new URLSearchParams(location.search),
      mode = q.get("mode"),
      code = q.get("oobCode");
    if (mode === "verifyEmail" && code) {
      authActionHandled = true;
      try {
        await auth.applyActionCode(code);
        cleanActionUrl();
        if (!auth.currentUser || !auth.currentUser.emailVerified) {
          try {
            await auth.signOut();
          } catch {}
          authForm("login");
          setAuthInfo("✓ تم تفعيل بريدك الإلكتروني بنجاح. سجّل الدخول الآن.");
        }
      } catch (e) {
        cleanActionUrl();
        authForm("login");
        handleError(e);
      }
      return;
    }
    if (mode === "resetPassword" && code) {
      authActionHandled = true;
      try {
        const email = await auth.verifyPasswordResetCode(code);
        pendingResetCode = code;
        cleanActionUrl();
        openModal(
          "كلمة مرور جديدة",
          `<form id="resetForm" class="form-grid" style="padding:0"><p class="muted" style="margin:0" dir="ltr">${esc(email)}</p><label>كلمة مرور جديدة<input class="field" id="newPassword" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn primary" type="submit">حفظ كلمة المرور</button></form>`,
        );
      } catch (e) {
        cleanActionUrl();
        authForm("login");
        handleError(e);
      }
      return;
    }
    if (q.get("verified") === "1") {
      authActionHandled = true;
      cleanActionUrl();
      if (!auth.currentUser) {
        authForm("login");
        setAuthInfo("✓ تم تفعيل بريدك الإلكتروني. سجّل الدخول الآن.");
      }
    }
  }

  function authState() {
    auth.onAuthStateChanged(async (user) => {
      stopUserWatchers();
      if (!user) {
        try { localStorage.removeItem("codeex_session_hint_v1"); } catch {}
        sharedAuthReady = false;
        sharedPostHandled = false;
        stopCoreListeners();
        activeUser = null;
        savedIds = [];
        joinedIds = [];
        noticeItems = [];
        remoteRawPosts = {};
        cloudPosts = [];
        remoteGroups = [];
        groups.splice(0, groups.length);
        publicProfiles = {};
        rawGroupData = {};
        stopMembershipWatchers();
        stopFollowWatchers();
        followingSet = {}; followersSet = {}; incomingFollowReqs = {}; sentFollowReqs = {};
        groupRequestData = {};
        groupPendingStatus = {};
        groupRequestUnsubs.forEach((fn) => fn());
        groupRequestUnsubs = [];
        stopPrivateGroupWatchers();
        activeConversation = "";
        activeMessages = [];
        renderFrame();
        if (pendingSharedPostId) {
          // A visitor opened /?post=ID. If that post is public, send them to its standalone
          // public page instead of asking for login; only members-only / private-group posts need login.
          (async () => {
            const id = pendingSharedPostId;
            try {
              const isGroupLink = !!new URLSearchParams(location.search).get("group");
              if (!isGroupLink && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
                const res = await fetch(`https://codna-f8612-default-rtdb.europe-west1.firebasedatabase.app/publicPostIndex/${encodeURIComponent(id)}.json`, { cache: "no-store" });
                if (res.ok && (await res.json()) === true) {
                  location.replace(`/post/${encodeURIComponent(id)}`);
                  return;
                }
              }
            } catch {}
            authForm("login");
            setAuthInfo("يلزم تسجيل الدخول لفتح المنشور.");
          })();
        }
        return;
      }
      sharedAuthReady = false;
      const firstLogin = !activeUser;
      try {
        if (user.email && !user.emailVerified) {
          if (authBusy) return;
          await auth.signOut();
          return;
        }
        try { localStorage.setItem("codeex_session_hint_v1", "1"); } catch {}
        /* Show the app shell and start downloading the feed right away; the profile
           check below runs in parallel instead of blocking the posts. */
        if (!activeUser) {
          activeUser = { uid: user.uid, email: user.email, name: user.displayName || "" };
          if (firstLogin) page = "home";
          closeModal();
          bindPostsWindow();
          renderFrame();
        }
        const profile = await ensureProfile(user);
        activeUser = { ...profile, uid: user.uid, email: user.email };
        database.ref(`profiles/${user.uid}`).update({ uid: user.uid }).catch((e) => log.warn("profile uid sync failed", e));
        syncUserState(user.uid);
        if (firstLogin) page = "home";
        closeModal();
        startCoreListeners();
        if (postsLoadError) {
          postsLoadError = false;
          postsReady = false;
          bindPostsWindow();
        }
        renderFrame();
        sharedAuthReady = true;
        openSharedPostWhenReady();
      } catch (e) {
        sharedAuthReady = false;
        handleError(e);
        activeUser = null;
        try {
          await auth.signOut();
        } catch {}
        renderVisitor();
        return;
      }
    });
  }

  function connectServices() {
    if ((!auth || !database) && typeof firebase !== "undefined" && firebase.apps) {
      firebaseAvailable = true;
      firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      activateAppCheck();
      auth = firebase.auth(firebaseApp);
      database = firebase.database(firebaseApp);
      if (auth) auth.useDeviceLanguage();
      try {
        if (location.protocol !== "file:" && firebase.analytics) firebase.analytics(firebaseApp);
      } catch {}
    }
    const w = document.querySelector("#sdkWarning");
    if (!auth || !database) {
      renderVisitor();
      if (w) {
        w.hidden = false;
        w.textContent = "جارٍ تحميل خدمات الموقع…";
      }
      return false;
    }
    if (w) w.hidden = true;
    if (!firebaseAuthStarted) {
      firebaseAuthStarted = true;
      authState();
      auth.getRedirectResult().catch(handleError);
      handleAuthAction();
    }
    return true;
  }

  /* ==========================================================================
   Rendering
   ========================================================================== */
  const PUBLIC_PAGES = new Set(["about", "privacy", "contact"]);
  function renderSiteFooter() {
    const footer = document.querySelector("#siteFooter");
    if (!footer) return;
    footer.innerHTML = `<a href="/">Codeex</a><a href="/about/">${language === "ar" ? "من نحن" : "About us"}</a><a href="/privacy/">${language === "ar" ? "الخصوصية" : "Privacy"}</a><a href="/contact/">${language === "ar" ? "اتصل بنا" : "Contact us"}</a><span class="footer-owner">${language === "ar" ? "صاحب الموقع" : "Site owner"}: <strong>Yahya El Messaoudi</strong></span>`;
  }
  function setPublicMetadata(title, description) {
    document.title = `${title} | Codeex`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = description;
  }
  function renderPublicPage(id) {
    const ar = language === "ar";
    const pages = {
      about: {
        title: ar ? "من نحن" : "About us",
        description: ar ? "تعرّف على Codeex، مجتمع المطورين العرب." : "Learn about Codeex, a community for Arab developers.",
        body: ar ? `<p><strong>Codeex</strong> مساحة مجتمعية للمطورين العرب لتبادل المعرفة، وطرح الأسئلة، وعرض المشاريع والأفكار البرمجية.</p><h2>ما الذي نقدمه؟</h2><ul><li>مجتمعاً لمشاركة الخبرات والنقاشات التقنية.</li><li>مساحة لعرض المشاريع والمقالات والموارد البرمجية.</li><li>أدوات تفاعلية تساعد المطورين على التواصل والتعلّم.</li></ul><h2>رؤيتنا</h2><p>أن نجعل المعرفة التقنية والتعاون بين المطورين العرب أكثر سهولة وانفتاحاً.</p>` : `<p><strong>Codeex</strong> is a community space for Arab developers to exchange knowledge, ask questions, and showcase software projects and ideas.</p><h2>What we offer</h2><ul><li>A place to share experience and discuss technology.</li><li>Space for projects, articles, and developer resources.</li><li>Community tools that support communication and learning.</li></ul><h2>Our vision</h2><p>To make technical knowledge and collaboration among Arab developers more accessible.</p>`,
      },
      privacy: {
        title: ar ? "سياسة الخصوصية" : "Privacy policy",
        description: ar ? "كيف يتعامل Codeex مع بيانات الحساب والمنشورات وتفضيلات الموقع." : "How Codeex handles account, post, and site preference data.",
        body: ar ? `<p>توضح هذه الصفحة أنواع المعلومات التي قد يعالجها Codeex عند استخدام الموقع، وكيف تُستخدم ضمن وظائفه.</p><h2>المعلومات التي قد تُعالج</h2><ul><li>بيانات الحساب والملف الشخصي التي تقدمها، مثل الاسم والبريد الإلكتروني والنبذة والصورة.</li><li>المنشورات والتعليقات والتفاعلات والرسائل التي تنشئها أو ترسلها.</li><li>تفضيلات محلية في المتصفح مثل اللغة والمظهر.</li></ul><h2>كيف تُستخدم</h2><p>تُستخدم المعلومات لتسجيل الدخول وتشغيل ميزات المجتمع وعرض المحتوى الذي تختار مشاركته وحماية الخدمة من الاستخدام المسيء.</p><h2>المحتوى العام والخاص</h2><p>قد تكون المنشورات والتعليقات والتفاعلات ظاهرة لأعضاء المجتمع أو للزوار بحسب نوع المحتوى وإعدادات المجموعة. لا تنشر معلومات حساسة في مساحة عامة.</p><h2>الخدمات الخارجية</h2><p>يعتمد تسجيل الدخول وتخزين بعض بيانات الموقع على خدمات Firebase من Google؛ ويخضع استخدام تلك الخدمات أيضاً لسياسات مزوديها.</p><h2>الاحتفاظ والتحكم</h2><p>يمكنك تعديل بعض بيانات ملفك أو حذف محتوى من خلال ميزات الموقع المتاحة. لم تُحدد هنا مدة احتفاظ موحدة أو آلية طلب حذف خارج الأدوات المتاحة داخل الموقع.</p><p class="muted">آخر تحديث: 20 أكتوبر 2026</p>` : `<p>This page describes information Codeex may process when you use the site and how it supports site features.</p><h2>Information that may be processed</h2><ul><li>Account and profile details you provide, such as name, email, bio, and avatar.</li><li>Posts, comments, reactions, and messages you create or send.</li><li>Local browser preferences such as language and appearance.</li></ul><h2>How information is used</h2><p>Information supports sign-in, community features, displaying content you choose to share, and protecting the service from misuse.</p><h2>Public and private content</h2><p>Posts, comments, and reactions may be visible to community members or visitors depending on the content type and group settings. Avoid sharing sensitive information in public areas.</p><h2>Third-party services</h2><p>Sign-in and some site data rely on Google's Firebase services; use of those services is also subject to their providers' policies.</p><h2>Retention and control</h2><p>You can edit some profile information or remove content using available site features. No universal retention period or separate deletion-request channel is specified here.</p><p class="muted">Last updated: October 20, 2026</p>`,
      },
      contact: {
        title: ar ? "اتصل بنا" : "Contact us",
        description: ar ? "معلومات التواصل مع فريق Codeex." : "Contact information for the Codeex team.",
        body: ar ? `<p>نسعد بملاحظاتك واقتراحاتك حول Codeex والمجتمع.</p><h2>التواصل</h2><p>لم يُضف إلى إعدادات الموقع حتى الآن بريد إلكتروني أو قناة دعم رسمية يمكن ربطها بهذه الصفحة. لتجنب توجيه رسالتك إلى عنوان غير صحيح، لن نعرض نموذج إرسال غير متصل.</p><p>يمكن لصاحب الموقع إضافة وسيلة التواصل الرسمية هنا عند توفرها.</p>` : `<p>We welcome feedback and suggestions about Codeex and its community.</p><h2>Contact details</h2><p>No official email address or support channel has been configured for this site yet. To avoid sending your message to an incorrect destination, this page does not show a non-functional contact form.</p><p>The site owner can add an official contact method here when available.</p>`,
      },
    };
    const item = pages[id] || pages.about;
    setPublicMetadata(item.title, item.description);
    return `<section class="panel public-info-card"><div class="page-head"><div><h1>${item.title}</h1><p>${item.description}</p></div></div>${item.body}</section>`;
  }
  function visitorMarkup() {
    const ar = language === "ar";
    return `<section class="visitor-card"><div class="visitor-brand"><span class="brand-mark">&lt;/&gt;</span><span>Codeex</span></div><h1>${ar ? "مجتمع المطورين العرب" : "A Community for Arab Developers"}</h1><p class="visitor-audience">${ar ? "Codeex للمطورين العرب المبتدئين والمحترفين الذين يريدون مشاركة مشاريعهم وأسئلتهم والتعلّم في مجتمع برمجي متخصص، بدلاً من تشتت النقاشات بين المنصات العامة." : "Codeex is for beginner and experienced Arab developers who want to share projects and questions and learn in a focused Arabic coding community instead of scattered general-platform discussions."}</p><div class="visitor-highlights"><span>${ar ? "شارك المعرفة" : "Share knowledge"}</span><span>${ar ? "تعلّم مع المطورين" : "Learn together"}</span><span>${ar ? "اعرض مشاريعك" : "Showcase projects"}</span></div><div class="visitor-demo"><div class="visitor-demo-card"><b>${ar ? "محرر يشبه VS Code" : "VS Code-like editor"}</b><span>${ar ? "ألوان syntax ونسخ سريع للكود" : "Syntax colors and one-click copy"}</span></div><div class="visitor-demo-card"><b>${ar ? "هذا الموقع من صنع طالب بالمدرسة العليا للتكنولوجيا" : "This site was created by a student at the Higher School of Technology"}</b><span>Yahya El Messaoudi</span></div><div class="visitor-demo-card"><b>${ar ? "مجتمعات خاصة" : "Private communities"}</b><span>${ar ? "الصلاحيات محمية على الخادم وليس في الواجهة فقط" : "Permissions are enforced on the server, not just in the UI"}</span></div></div><section class="visitor-seo-copy" aria-labelledby="visitor-seo-heading"><h2 id="visitor-seo-heading">${ar ? "مجتمع برمجي عربي للمشاريع والأسئلة والتعلّم" : "An Arabic coding community for projects, questions, and learning"}</h2><p>${ar ? "في Codeex يستطيع المطور مشاركة مشروع أو سؤال برمجي، تبادل المعرفة مع أعضاء المجتمع، واكتشاف مجموعات تقنية مناسبة لاهتمامه. صُممت المنصة لتجمع نقاشات المطورين في مساحة عربية واحدة، مع بقاء الوصول إلى المنشورات عبر تسجيل الدخول." : "On Codeex, developers can share a project or coding question, exchange knowledge with community members, and find technical groups that match their interests. The platform brings developer discussions into one Arabic-language space, while post access remains behind sign-in."}</p><ul class="visitor-seo-list"><li>${ar ? "اعرض مشاريعك وشارك الأفكار البرمجية مع مطورين عرب." : "Showcase projects and exchange software ideas with Arab developers."}</li><li>${ar ? "اطرح الأسئلة وتبادل الحلول والخبرات العملية." : "Ask questions and share practical solutions and experience."}</li><li>${ar ? "تواصل ضمن مجتمعات تقنية، مع أدوات نشر وتنسيق للكود." : "Join technical communities with tools for publishing and code formatting."}</li></ul></section><div class="visitor-actions"><button class="btn primary" data-auth="register">${ar ? "إنشاء حساب مجاني" : "Create a free account"}</button><button class="btn" data-auth="login">${ar ? "تسجيل الدخول" : "Sign in"}</button></div></section>`;
  }
  function renderVisitor() {
    document.documentElement.dataset.authState = "guest";
    const landing = document.querySelector("#visitorLanding");
    if (landing) {
      landing.style.display = "grid";
      const markup = visitorMarkup();
      /* Rebuilding identical markup (it ran every 100ms while Firebase loaded) recreated the card
         and restarted its entrance animation, so the page never finished painting. */
      if (!landing.firstElementChild || landing.__codeexMarkup !== markup) {
        landing.innerHTML = markup;
        landing.__codeexMarkup = markup;
      }
    }
  }

  function pageButton(id, label, ic, active = false) {
    return `<button data-page="${id}" class="${active ? "active" : ""}">${icon(ic)}<span>${label}</span></button>`;
  }

  function renderFrame() {
    const user = currentUser();
    if (!user) {
      renderVisitor();
      return;
    }
    document.documentElement.dataset.authState = "member";
    renderSiteFooter();
    const memberApp = document.querySelector("#memberApp");
    if (memberApp) memberApp.style.display = "block";
    const landing = document.querySelector("#visitorLanding");
    if (landing) {
      landing.innerHTML = "";
      landing.style.display = "none";
    }
    document.querySelector("#topNav").innerHTML = localizeMarkup(
      TOP.map(([ic, label, id]) => pageButton(id, label, ic, page === id)).join(""),
    );
    document.querySelector("#bottomNav").innerHTML = localizeMarkup(
      [
        ["home", "الرئيسية", "home"],
        ["plus", "نشر", "compose"],
        ["groups", "المجتمع", "groups"],
        ["user", "حسابي", "profile"],
      ]
        .map(
          ([ic, label, id]) =>
            `<button data-page="${id}" class="${page === id ? "active" : ""}">${icon(ic)}<span>${label}</span></button>`,
        )
        .join(""),
    );
    document.querySelector("#topAuth").textContent = localizeText("خروج");
    document.querySelector("#topAuth").dataset.auth = "logout";
    document.querySelector("#topName").textContent = user.name || localizeText("مطور");
    document.querySelector("#topAvatar").innerHTML = avatarContent(user);
    const brand = document.querySelector(".brand span:last-child");
    if (brand) brand.textContent = language === "en" ? "Codeex" : "Codeex";
    const search = document.querySelector("#searchInput");
    if (search) {
      search.placeholder = localizeText("ابحث في Codeex...");
      search.setAttribute("aria-label", localizeText("ابحث"));
    }
    const localPosts = cloudPosts.filter(
        (p) =>
          p.uid === user.uid && Number.isFinite(Number(p.createdAt)) && Number(p.createdAt) > 0,
      ).length,
      memberCount = Object.keys(publicProfiles).length,
      groupCount = groups.length;
    const myPosts = Math.max(ownPostCount, localPosts);
    document.querySelector("#leftCol").innerHTML = localizeMarkup(
      `<section class="panel profile-card"><div class="profile-top"><span class="avatar blue">${avatarContent(user)}</span><div><div class="profile-name">مرحباً ${esc(user.name || "")}</div><div class="profile-sub">${isAdminUid(user.uid) ? ADMIN_BADGE : "مجتمع المطورين العرب"}</div></div></div><div class="profile-stats"><div><b>${myPosts}</b><span>مساهمة</span></div><div><b>${memberCount}</b><span>أعضاء</span></div><div><b>${groupCount}</b><span>مجموعة</span></div></div><button class="outline-wide" data-page="profile">${icon("user")}ملفي الشخصي</button></section><nav class="panel side-nav">${SIDE.map(([ic, label, id]) => `<button data-page="${id}" class="${page === id ? "active" : ""}">${icon(ic)}<span>${label}</span>${id === "notifications" && noticeItems.filter((n) => !n.read).length ? `<span class="nav-count">${noticeItems.filter((n) => !n.read).length}</span>` : ""}</button>`).join("")}<button data-page="resources">${icon("resource")}<span>الموارد والمسارات</span></button></nav><section class="panel side-cta"><div class="crown">⌘</div><h3>شارك معرفتك</h3><p>شارك فكرة أو مشروعاً ليستفيد منهما المطورون.</p><button class="btn primary small" data-page="compose">ابدأ المشاركة</button></section>`,
    );
    const trendTags = [...new Set(cloudPosts.flatMap((p) => p.tags || []))].slice(0, 12);
    const groupBlock = groups.length
      ? groups
          .slice(0, 5)
          .map(
            (g) =>
              `<div class="group-row"><span class="group-icon ${esc(g.tone || "")}">${esc(g.icon || "⌘")}</span><span class="group-info"><strong>${esc(g.name)}</strong><span>مجموعة مجتمع</span></span><button class="join-btn ${Store.joined().includes(g.id) ? "joined" : ""}" data-action="join" data-id="${esc(g.id)}">${Store.joined().includes(g.id) ? "انضممت" : "انضم"}</button></div>`,
          )
          .join("")
      : `<div class="empty-state" style="padding:16px"><b>لا توجد مجموعات منشورة بعد</b></div>`;
    const tagBlock = trendTags.length
      ? `<div class="tag-cloud">${trendTags.map((t) => `<button class="tag" data-action="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>`
      : `<div class="empty-state" style="padding:14px">لا توجد وسوم رائجة بعد.</div>`;
    document.querySelector("#rightCol").innerHTML = localizeMarkup(
      `<section class="panel"><div class="panel-head"><h3>المجموعات</h3><button data-page="groups">عرض الكل</button></div>${groupBlock}</section><section class="panel"><div class="panel-head"><h3>وسوم منشورات المجتمع</h3></div>${tagBlock}</section>`,
    );
    updateNotificationIndicator();
    renderPage();
    maybeOpenChat();
  }

  function pageHeader(title, desc, button = "") {
    return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>${button}</div>`;
  }

  function composer() {
    const user = currentUser();
    return `<section class="panel composer"><div class="composer-row"><span class="avatar small blue">${avatarContent(user)}</span><button class="composer-trigger" data-page="compose">ماذا تريد أن تشارك اليوم؟</button></div><div class="composer-tools"><button data-page="compose" data-kind="article">${icon("article")} مقالة</button><button data-page="compose" data-kind="discussion">${icon("comment")} نقاش</button><button data-page="compose" data-kind="resource">${icon("link")} مورد</button></div></section>`;
  }

  /* >>> CODEEX_MEDIA_START — video embeds, per-language syntax highlighting and the code studio */

  /* ---------- Languages (VS Code "Dark+" look) ---------- */
  const LANG_ALIASES = {
    js: "javascript", ts: "typescript", py: "python", rs: "rust", sh: "bash", shell: "bash", zsh: "bash",
    cs: "csharp", "c#": "csharp", "c++": "cpp", cc: "cpp", yml: "yaml", kt: "kotlin", rb: "ruby",
    golang: "go", htm: "html", txt: "text", plaintext: "text",
  };
  const JS_KW = "var let const function class extends new this super static async get set typeof instanceof void delete in of null undefined true false NaN Infinity";
  const JS_CTRL = "if else for while do switch case default break continue return try catch finally throw with debugger import export from as await yield";
  const JS_TYPES = "Array Object String Number Boolean Map Set WeakMap Promise Date RegExp Error JSON Math Symbol BigInt console window document";
  const TS_KW = `${JS_KW} interface type enum implements namespace declare abstract readonly private public protected keyof infer is satisfies override module`;
  const TS_TYPES = `${JS_TYPES} any unknown never number string boolean object unique symbol`;
  const LANGS = {
    javascript: { label: "JavaScript", ext: "js", kind: "c", indent: 2, regex: true, cap: true, tpl: true, at: false, lc: ["//"], bc: ["/*", "*/"], q: "\"'`", kw: JS_KW, ctrl: JS_CTRL, types: JS_TYPES },
    typescript: { label: "TypeScript", ext: "ts", kind: "c", indent: 2, regex: true, cap: true, tpl: true, at: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'`", kw: TS_KW, ctrl: JS_CTRL, types: TS_TYPES },
    jsx: { label: "JSX", ext: "jsx", kind: "c", indent: 2, regex: true, cap: true, tpl: true, jsx: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'`", kw: JS_KW, ctrl: JS_CTRL, types: JS_TYPES },
    tsx: { label: "TSX", ext: "tsx", kind: "c", indent: 2, regex: true, cap: true, tpl: true, at: true, jsx: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'`", kw: TS_KW, ctrl: JS_CTRL, types: TS_TYPES },
    python: { label: "Python", ext: "py", kind: "c", indent: 4, cap: true, at: true, tq: true, pystr: true, lc: ["#"], q: "\"'", kw: "def class lambda None True False self cls and or not in is as global nonlocal pass del with async", ctrl: "if elif else for while break continue return try except finally raise import from assert match case yield await", types: "int str float bool list dict set tuple bytes object complex frozenset" },
    html: { label: "HTML", ext: "html", kind: "html", indent: 2 },
    css: { label: "CSS", ext: "css", kind: "css", indent: 2 },
    json: { label: "JSON", ext: "json", kind: "json", indent: 2 },
    yaml: { label: "YAML", ext: "yml", kind: "yaml", indent: 2 },
    java: { label: "Java", ext: "java", kind: "c", indent: 4, cap: true, at: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "public private protected static final abstract class interface enum extends implements new this super void null true false instanceof synchronized volatile transient native package throws var record sealed permits", ctrl: "if else for while do switch case default break continue return try catch finally throw import assert yield", types: "int long short byte char float double boolean String Object Integer List Map Set ArrayList HashMap Exception System" },
    kotlin: { label: "Kotlin", ext: "kt", kind: "c", indent: 4, cap: true, at: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "val var fun class object interface enum data sealed open abstract override private public protected internal companion init constructor this super null true false is as in by lateinit suspend inline typealias", ctrl: "if else when for while do break continue return try catch finally throw import package", types: "Int Long Short Byte Float Double Boolean String Char Unit Any Nothing List Map Set Array" },
    c: { label: "C", ext: "c", kind: "c", indent: 4, pre: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "struct union enum typedef static extern const volatile register inline sizeof void auto signed unsigned NULL true false", ctrl: "if else for while do switch case default break continue return goto", types: "int char short long float double bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t FILE" },
    cpp: { label: "C++", ext: "cpp", kind: "c", indent: 4, pre: true, cap: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "struct union enum typedef static extern const volatile inline sizeof void auto signed unsigned class namespace template typename public private protected virtual override final new delete this using operator friend constexpr nullptr explicit noexcept decltype true false", ctrl: "if else for while do switch case default break continue return goto try catch throw static_cast dynamic_cast reinterpret_cast const_cast", types: "int char short long float double bool size_t string vector map set unique_ptr shared_ptr std wstring array" },
    csharp: { label: "C#", ext: "cs", kind: "c", indent: 4, cap: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "class struct interface enum namespace using public private protected internal static readonly const abstract virtual override sealed new this base null true false var dynamic async await out ref in is as typeof sizeof delegate event params partial get set value record init required", ctrl: "if else for foreach while do switch case default break continue return try catch finally throw yield goto lock", types: "int long short byte char float double decimal bool string object void List Dictionary Task IEnumerable" },
    go: { label: "Go", ext: "go", kind: "c", indent: 4, lc: ["//"], bc: ["/*", "*/"], q: "\"'`", mq: true, kw: "package import func var const type struct interface map chan go defer nil true false iota make new len cap append panic recover", ctrl: "if else for switch case default break continue return goto select fallthrough range", types: "int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any" },
    rust: { label: "Rust", ext: "rs", kind: "c", indent: 4, cap: true, rust: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "fn let mut const static struct enum impl trait type mod use pub crate self Self super as where move ref dyn unsafe async await extern box true false", ctrl: "if else for while loop match break continue return in", types: "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap Some None Ok Err" },
    php: { label: "PHP", ext: "php", kind: "c", indent: 4, cap: true, php: true, dollar: true, lc: ["//", "#"], bc: ["/*", "*/"], q: "\"'", kw: "function class interface trait extends implements new public private protected static final abstract const var namespace use null true false self parent this array echo print isset unset empty global", ctrl: "if else elseif for foreach while do switch case default break continue return try catch finally throw match require include require_once include_once", types: "int float string bool array object void mixed callable iterable" },
    ruby: { label: "Ruby", ext: "rb", kind: "c", indent: 2, cap: true, ruby: true, lc: ["#"], q: "\"'", kw: "def class module end self nil true false super yield lambda proc do begin rescue ensure raise attr_accessor attr_reader attr_writer include extend require require_relative private public protected alias undef then", ctrl: "if elsif else unless case when while until for in break next redo retry return and or not", types: "" },
    swift: { label: "Swift", ext: "swift", kind: "c", indent: 4, cap: true, at: true, lc: ["//"], bc: ["/*", "*/"], q: "\"", kw: "let var func class struct enum protocol extension init deinit self super nil true false static private public internal fileprivate open final lazy weak unowned override mutating throws rethrows async await where is as in inout some any", ctrl: "if else guard switch case default for while repeat break continue return fallthrough do try catch throw import defer", types: "Int Double Float Bool String Character Array Dictionary Set Optional Void Any" },
    dart: { label: "Dart", ext: "dart", kind: "c", indent: 2, cap: true, at: true, lc: ["//"], bc: ["/*", "*/"], q: "\"'", kw: "var final const class extends implements with mixin abstract static void dynamic late required new this super null true false is as async sync enum typedef extension on get set factory", ctrl: "if else for while do switch case default break continue return try catch finally throw rethrow import export part library show hide assert await yield", types: "int double num bool String List Map Set Future Stream Object" },
    lua: { label: "Lua", ext: "lua", kind: "c", indent: 2, lc: ["--"], bc: ["--[[", "]]"], q: "\"'", kw: "local function end nil true false and or not", ctrl: "if then else elseif for while do repeat until break return in goto", types: "" },
    sql: { label: "SQL", ext: "sql", kind: "c", indent: 2, ci: true, lc: ["--"], bc: ["/*", "*/"], q: "\"'`", kw: "select from where insert into values update set delete create alter drop table database index view primary key foreign references default not null unique check constraint add column join inner left right full outer cross on group by order having limit offset union all distinct as and or in is between like exists case when then else end asc desc count sum avg min max with begin commit rollback truncate if returns function procedure trigger", ctrl: "", types: "int integer bigint smallint tinyint varchar char text boolean bool date datetime timestamp float double decimal numeric json blob serial uuid" },
    bash: { label: "Bash", ext: "sh", kind: "c", indent: 2, dollar: true, rawq: true, lc: ["#"], q: "\"'", kw: "function local export readonly declare unset alias source", ctrl: "if then else elif fi for while until do done case esac in select return break continue exit", types: "echo cd ls cat grep sed awk mkdir rm cp mv chmod chown sudo apt npm git curl wget pip python node docker" },
    text: { label: "Text", ext: "txt", kind: "text", indent: 2 },
  };
  const LANG_ORDER = ["javascript", "typescript", "jsx", "tsx", "python", "html", "css", "json", "java", "kotlin", "c", "cpp", "csharp", "go", "rust", "php", "ruby", "swift", "dart", "sql", "bash", "yaml", "lua", "text"];
  const normLang = (lang) => {
    const k = String(lang || "").toLowerCase().trim();
    const key = LANG_ALIASES[k] || k;
    return LANGS[key] ? key : "text";
  };
  const langSpec = (lang) => LANGS[normLang(lang)];
  const codeFileName = (lang) => `snippet.${langSpec(lang).ext}`;
  const wordSet = (s) => new Set(String(s || "").split(" ").filter(Boolean));
  const langSets = (spec) =>
    (spec._s ||= { kw: wordSet(spec.kw), ctrl: wordSet(spec.ctrl), types: wordSet(spec.types) });
  const DECL_FN = new Set(["function", "def", "fn", "func", "fun"]);
  const DECL_TYPE = new Set(["class", "struct", "interface", "enum", "trait", "type", "namespace", "module", "object", "impl", "record", "protocol", "extension", "union", "new", "extends", "implements"]);
  const RE_ID = /[A-Za-z_$][\w$]*/y;
  const RE_NUM = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;

  function tokenizeC(code, spec, depth = 0) {
    const S = langSets(spec), out = [], n = code.length;
    let i = 0, plain = "", prevWord = "", lineStart = true;
    const flush = () => { if (plain) { out.push(["", plain]); plain = ""; } };
    const tok = (cls, a, b) => { flush(); out.push([cls, code.slice(a, b)]); };
    const prevSig = (k) => { k--; while (k >= 0 && (code[k] === " " || code[k] === "\t")) k--; return k >= 0 ? code[k] : ""; };
    const nextSig = (k) => { while (k < n && (code[k] === " " || code[k] === "\t")) k++; return code[k] || ""; };
    const readString = (qi) => {
      const q = code[qi];
      if (spec.tq && code.startsWith(q.repeat(3), qi)) {
        const e = code.indexOf(q.repeat(3), qi + 3);
        return e < 0 ? n : e + 3;
      }
      const raw = spec.rawq && q === "'", multi = q === "`" || spec.mq;
      let j = qi + 1;
      while (j < n) {
        const c = code[j];
        if (c === "\\" && !raw) { j += 2; continue; }
        if (c === q) return j + 1;
        if (c === "\n" && !multi) return j;
        j++;
      }
      return n;
    };
    const emitTemplate = (qi) => {
      let j = qi + 1, segStart = qi;
      while (j < n) {
        const c = code[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "`") { j++; break; }
        if (c === "$" && code[j + 1] === "{") {
          flush();
          if (j > segStart) out.push(["syn-str", code.slice(segStart, j)]);
          let d = 1, k = j + 2;
          while (k < n && d > 0) { if (code[k] === "{") d++; else if (code[k] === "}") d--; k++; }
          out.push(["syn-key", "${"]);
          const innerEnd = d === 0 ? k - 1 : k;
          for (const t of tokenizeC(code.slice(j + 2, innerEnd), spec, depth + 1)) out.push(t);
          if (d === 0) out.push(["syn-key", "}"]);
          segStart = k; j = k;
          continue;
        }
        j++;
      }
      const end = Math.min(j, n);
      if (end > segStart) { flush(); out.push(["syn-str", code.slice(segStart, end)]); }
      return end;
    };
    while (i < n) {
      const ch = code[i];
      if (ch === "\n") { plain += ch; i++; lineStart = true; continue; }
      if (ch === " " || ch === "\t" || ch === "\r") { plain += ch; i++; continue; }
      const pw = prevWord;
      prevWord = "";
      const wasLineStart = lineStart;
      lineStart = false;
      if (spec.pre && ch === "#" && wasLineStart) {
        const m = /#\s*[a-zA-Z_]+/y; m.lastIndex = i;
        const r = m.exec(code);
        if (r) {
          tok("syn-ctrl", i, i + r[0].length);
          i += r[0].length;
          if (/include|import/.test(r[0])) {
            let k = i; while (code[k] === " " || code[k] === "\t") k++;
            if (code[k] === "<") { const e = code.indexOf(">", k), nl = code.indexOf("\n", k); if (e > 0 && (nl < 0 || e < nl)) { plain += code.slice(i, k); tok("syn-str", k, e + 1); i = e + 1; } }
          }
          continue;
        }
      }
      if (spec.php) {
        if (code.startsWith("<?", i)) { const m = /<\?(?:php|=)?/y; m.lastIndex = i; const r = m.exec(code); tok("syn-meta", i, i + r[0].length); i += r[0].length; continue; }
        if (code.startsWith("?>", i)) { tok("syn-meta", i, i + 2); i += 2; continue; }
      }
      if (spec.bc && code.startsWith(spec.bc[0], i)) {
        let e = code.indexOf(spec.bc[1], i + spec.bc[0].length);
        e = e < 0 ? n : e + spec.bc[1].length;
        tok("syn-comment", i, e); i = e; continue;
      }
      const lc = spec.lc && spec.lc.find((m) => code.startsWith(m, i));
      if (lc && !(spec.ruby && false)) {
        let e = code.indexOf("\n", i); if (e < 0) e = n;
        tok("syn-comment", i, e); i = e; continue;
      }
      if (ch === "`" && spec.tpl && depth < 4) { i = emitTemplate(i); continue; }
      if (spec.q.includes(ch)) {
        if (spec.rust && ch === "'") {
          const c = /'(?:\\.|[^\\'\n])'/y; c.lastIndex = i;
          const r = c.exec(code);
          if (r) { tok("syn-str", i, i + r[0].length); i += r[0].length; continue; }
          const l = /'[A-Za-z_]\w*/y; l.lastIndex = i;
          const lr = l.exec(code);
          if (lr) { tok("syn-type", i, i + lr[0].length); i += lr[0].length; continue; }
        }
        const e = readString(i);
        tok("syn-str", i, e); i = e; continue;
      }
      if (spec.regex && ch === "/" && code[i + 1] !== "/" && code[i + 1] !== "*") {
        const ps = prevSig(i);
        let ok = ps === "" || "(,=:[!&|?{};+-*%<>~^".includes(ps);
        if (!ok && ps !== "") { const w = /([A-Za-z]+)\s*$/.exec(code.slice(Math.max(0, i - 12), i)); ok = !!w && /^(return|typeof|case|in|of|delete|void|throw|yield|await)$/.test(w[1]); }
        if (ok) {
          let j = i + 1, inCls = false, closed = false;
          while (j < n) {
            const c = code[j];
            if (c === "\\") { j += 2; continue; }
            if (c === "\n") break;
            if (c === "[") inCls = true; else if (c === "]") inCls = false;
            else if (c === "/" && !inCls) { j++; closed = true; break; }
            j++;
          }
          if (closed) { while (/[a-z]/.test(code[j] || "")) j++; tok("syn-regex", i, j); i = j; continue; }
        }
      }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(code[i + 1] || ""))) {
        const before = code[i - 1] || "";
        if (!/[\w$]/.test(before)) {
          RE_NUM.lastIndex = i;
          const r = RE_NUM.exec(code);
          if (r && r[0]) { tok("syn-number", i, i + r[0].length); i += r[0].length; continue; }
        }
      }
      if (spec.at && ch === "@" && /[A-Za-z_]/.test(code[i + 1] || "")) {
        const m = /@[A-Za-z_][\w.]*/y; m.lastIndex = i;
        const r = m.exec(code); tok("syn-meta", i, i + r[0].length); i += r[0].length; continue;
      }
      if (spec.dollar && ch === "$") {
        const m = /\$(?:[A-Za-z_]\w*|\{[^}\n]*\}|[0-9@#?*!$-])/y; m.lastIndex = i;
        const r = m.exec(code);
        if (r) { tok("syn-var", i, i + r[0].length); i += r[0].length; continue; }
      }
      if (spec.ruby && (ch === "@" || (ch === ":" && code[i - 1] !== ":" && /[A-Za-z_]/.test(code[i + 1] || "")))) {
        const m = ch === "@" ? /@@?[A-Za-z_]\w*/y : /:[A-Za-z_]\w*[?!]?/y; m.lastIndex = i;
        const r = m.exec(code);
        if (r) { tok(ch === "@" ? "syn-var" : "syn-const", i, i + r[0].length); i += r[0].length; continue; }
      }
      if (spec.jsx && ch === "<" && /^<\/?[A-Za-z]/.test(code.slice(i, i + 3))) {
        const ps = prevSig(i);
        if (!/[\w$)\]]/.test(ps)) {
          const m = /<\/?[A-Za-z][\w.]*/y; m.lastIndex = i;
          const r = m.exec(code);
          plain += code[i]; if (code[i + 1] === "/") plain += "/";
          const nameStart = i + (code[i + 1] === "/" ? 2 : 1);
          tok("syn-tag", nameStart, i + r[0].length); i += r[0].length; continue;
        }
      }
      RE_ID.lastIndex = i;
      const m = RE_ID.exec(code);
      if (m) {
        const w = m[0], lower = spec.ci ? w.toLowerCase() : w;
        if (spec.pystr && /^[rRbBfFuU]{1,2}$/.test(w) && (code[i + w.length] === '"' || code[i + w.length] === "'")) {
          const e = readString(i + w.length); tok("syn-str", i, e); i = e; continue;
        }
        const after = nextSig(i + w.length);
        let cls = "";
        const isKw = S.kw.has(lower), isCtrl = S.ctrl.has(lower);
        if (!spec.ci && DECL_FN.has(pw) && !isKw && !isCtrl) cls = "syn-func";
        else if (!spec.ci && DECL_TYPE.has(pw) && !isKw && !isCtrl) cls = "syn-type";
        else if (isKw) cls = "syn-key";
        else if (isCtrl) cls = "syn-ctrl";
        else if (S.types.has(spec.ci ? lower : w)) cls = "syn-type";
        else if (spec.ci && after === "(") cls = "syn-func";
        else if (spec.ci) cls = "syn-var";
        else if (prevSig(i) === "." ) cls = after === "(" ? "syn-func" : "syn-prop";
        else if (after === "(") cls = "syn-func";
        else if (w.length > 1 && /^[A-Z][A-Z0-9_]+$/.test(w)) cls = "syn-const";
        else if (spec.cap && /^[A-Z]/.test(w)) cls = "syn-type";
        else cls = "syn-var";
        tok(cls, i, i + w.length);
        if (DECL_FN.has(w) || DECL_TYPE.has(w)) prevWord = w;
        i += w.length;
        continue;
      }
      plain += ch; i++;
    }
    flush();
    return out;
  }

  function tokenizeJson(code) {
    const out = [], n = code.length;
    let i = 0, plain = "";
    const flush = () => { if (plain) { out.push(["", plain]); plain = ""; } };
    while (i < n) {
      const ch = code[i];
      if (ch === '"') {
        let j = i + 1;
        while (j < n && code[j] !== '"' && code[j] !== "\n") { if (code[j] === "\\") j++; j++; }
        j = Math.min(j + 1, n);
        let k = j; while (code[k] === " " || code[k] === "\t") k++;
        flush(); out.push([code[k] === ":" ? "syn-prop" : "syn-str", code.slice(i, j)]); i = j; continue;
      }
      if (code.startsWith("//", i)) { let e = code.indexOf("\n", i); if (e < 0) e = n; flush(); out.push(["syn-comment", code.slice(i, e)]); i = e; continue; }
      const num = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y; num.lastIndex = i;
      const nm = /[-\d]/.test(ch) ? num.exec(code) : null;
      if (nm) { flush(); out.push(["syn-number", nm[0]]); i += nm[0].length; continue; }
      const kw = /(?:true|false|null)\b/y; kw.lastIndex = i;
      const km = /[tfn]/.test(ch) ? kw.exec(code) : null;
      if (km) { flush(); out.push(["syn-key", km[0]]); i += km[0].length; continue; }
      plain += ch; i++;
    }
    flush();
    return out;
  }

  function tokenizeYaml(code) {
    const out = [], lines = code.split("\n");
    let block = -1;
    const value = (v) => {
      if (!v) return;
      const cm = /^(.*?)(\s+#.*)$/.exec(v), body = cm ? cm[1] : v, tail = cm ? cm[2] : "";
      const lead = /^\s*/.exec(body)[0], t = body.slice(lead.length);
      if (lead) out.push(["", lead]);
      if (t) {
        if (/^["']/.test(t)) out.push(["syn-str", t]);
        else if (/^(true|false|null|yes|no|on|off|~)$/i.test(t)) out.push(["syn-key", t]);
        else if (/^-?\d+(\.\d+)?$/.test(t)) out.push(["syn-number", t]);
        else if (/^[&*]\w+/.test(t)) out.push(["syn-func", t]);
        else if (/^[|>][+-]?$/.test(t)) out.push(["", t]);
        else out.push(["syn-str", t]);
      }
      if (tail) out.push(["syn-comment", tail]);
    };
    lines.forEach((line, idx) => {
      if (idx > 0) out.push(["", "\n"]);
      const ind = /^\s*/.exec(line)[0].length;
      if (block >= 0) {
        if (line.trim() === "" || ind > block) { out.push(["syn-str", line]); return; }
        block = -1;
      }
      const cm = /^(\s*)(#.*)$/.exec(line);
      if (cm) { if (cm[1]) out.push(["", cm[1]]); out.push(["syn-comment", cm[2]]); return; }
      const km = /^(\s*(?:-\s+)*)("[^"]*"|'[^']*'|[^\s#:'"-][^#:]*?)(\s*:)(?=\s|$)(.*)$/.exec(line);
      if (km) {
        if (km[1]) out.push(["", km[1]]);
        out.push(["syn-prop", km[2]]); out.push(["", km[3]]);
        value(km[4]);
        if (/^\s*[|>][+-]?\s*$/.test(km[4])) block = ind;
        return;
      }
      const lm = /^(\s*-\s+)(.*)$/.exec(line);
      if (lm) { out.push(["", lm[1]]); value(lm[2]); return; }
      value(line);
    });
    return out;
  }

  function tokenizeCss(code) {
    const out = [], n = code.length, stack = [];
    let i = 0, plain = "", ps = 0, inValue = false, declStart = true, paren = 0;
    const flush = () => { if (plain) { out.push(["", plain]); plain = ""; } };
    const tok = (cls, a, b) => { flush(); out.push([cls, code.slice(a, b)]); };
    const mode = () => stack[stack.length - 1] || "rules";
    const sticky = (re, at) => { re.lastIndex = at; return re.exec(code); };
    while (i < n) {
      const ch = code[i];
      if (code.startsWith("/*", i)) { let e = code.indexOf("*/", i + 2); e = e < 0 ? n : e + 2; tok("syn-comment", i, e); i = e; continue; }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n && code[j] !== ch && code[j] !== "\n") { if (code[j] === "\\") j++; j++; }
        j = Math.min(j + 1, n); tok("syn-str", i, j); i = j; continue;
      }
      if (ch === "{") {
        const prelude = code.slice(ps, i).trim();
        stack.push(/^@(media|supports|layer|container|keyframes|-webkit-keyframes|document)/i.test(prelude) ? "rules" : "decl");
        plain += ch; i++; ps = i; inValue = false; declStart = true; paren = 0; continue;
      }
      if (ch === "}") { stack.pop(); plain += ch; i++; ps = i; inValue = false; declStart = true; continue; }
      if (ch === ";") { plain += ch; i++; ps = i; inValue = false; declStart = true; paren = 0; continue; }
      if (/\s/.test(ch)) { plain += ch; i++; continue; }
      if (mode() === "rules") {
        let m;
        if (ch === "@" && (m = sticky(/@[\w-]+/y, i))) { tok("syn-ctrl", i, i + m[0].length); i += m[0].length; continue; }
        if ((ch === "." || ch === "#") && (m = sticky(/[.#][\w-]+/y, i))) { tok("syn-sel", i, i + m[0].length); i += m[0].length; continue; }
        if (ch === ":" && (m = sticky(/::?[\w-]+/y, i))) { tok("syn-sel", i, i + m[0].length); i += m[0].length; continue; }
        if (ch === "[" ) { const e = code.indexOf("]", i); const end = e < 0 ? n : e + 1; tok("syn-prop", i, end); i = end; continue; }
        if (ch === "(") paren++;
        if (ch === ")") paren = Math.max(0, paren - 1);
        if ((m = sticky(/-?\d*\.?\d+(?:px|em|rem|%|vh|vw|dvh|ch|s|ms|deg|fr|pt|x)?/y, i)) && m[0] && /[\d]/.test(ch) ) { tok("syn-number", i, i + m[0].length); i += m[0].length; continue; }
        if ((m = sticky(/[A-Za-z-][\w-]*/y, i))) { tok(paren ? "syn-prop" : "syn-tag", i, i + m[0].length); i += m[0].length; continue; }
        plain += ch; i++; continue;
      }
      // declarations
      let m;
      if (!inValue) {
        if (declStart && (m = sticky(/-{0,2}[A-Za-z_][\w-]*(?=\s*:)/y, i))) { tok("syn-prop", i, i + m[0].length); i += m[0].length; declStart = false; continue; }
        if (ch === ":") { plain += ch; i++; inValue = true; continue; }
        plain += ch; i++; continue;
      }
      if (ch === "#" && (m = sticky(/#[0-9a-fA-F]{3,8}\b/y, i))) { tok("syn-number", i, i + m[0].length); i += m[0].length; continue; }
      if (ch === "!" && (m = sticky(/!\s*important/y, i))) { tok("syn-key", i, i + m[0].length); i += m[0].length; continue; }
      if ((m = sticky(/-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|dvh|svh|lvh|ch|ex|s|ms|deg|rad|turn|fr|pt|cm|mm|in|x|dppx)?/y, i)) && m[0] && /[\d.-]/.test(ch) && !/^-$/.test(m[0])) { tok("syn-number", i, i + m[0].length); i += m[0].length; continue; }
      if ((m = sticky(/--[\w-]+/y, i))) { tok("syn-prop", i, i + m[0].length); i += m[0].length; continue; }
      if ((m = sticky(/[A-Za-z_-][\w-]*/y, i))) {
        const w = m[0], isFn = code[i + w.length] === "(";
        tok(isFn ? "syn-func" : "syn-str", i, i + w.length); i += w.length; continue;
      }
      plain += ch; i++;
    }
    flush();
    return out;
  }

  function tokenizeHtml(code) {
    const out = [], n = code.length;
    let i = 0, plain = "";
    const flush = () => { if (plain) { out.push(["", plain]); plain = ""; } };
    const tok = (cls, a, b) => { flush(); out.push([cls, code.slice(a, b)]); };
    while (i < n) {
      if (code.startsWith("<!--", i)) { let e = code.indexOf("-->", i + 4); e = e < 0 ? n : e + 3; tok("syn-comment", i, e); i = e; continue; }
      if (code[i] === "<" && /^<!doctype/i.test(code.slice(i, i + 9))) { let e = code.indexOf(">", i); e = e < 0 ? n : e + 1; tok("syn-meta", i, e); i = e; continue; }
      const tm = code[i] === "<" ? /<(\/?)([A-Za-z][\w:-]*)/y : null;
      if (tm) { tm.lastIndex = i; }
      const tr = tm ? tm.exec(code) : null;
      if (tr) {
        tok("syn-punc", i, i + 1 + tr[1].length);
        const nameStart = i + 1 + tr[1].length;
        tok("syn-tag", nameStart, i + tr[0].length);
        i += tr[0].length;
        while (i < n && code[i] !== ">") {
          const c = code[i];
          if (/\s/.test(c)) { plain += c; i++; continue; }
          if (c === "/") { tok("syn-punc", i, i + 1); i++; continue; }
          if (c === "=") { tok("syn-punc", i, i + 1); i++; continue; }
          if (c === '"' || c === "'") { let j = code.indexOf(c, i + 1); j = j < 0 ? n : j + 1; tok("syn-str", i, j); i = j; continue; }
          const am = /[^\s=>/"']+/y; am.lastIndex = i;
          const ar = am.exec(code);
          if (!ar) { plain += c; i++; continue; }
          const afterEq = /\s*=/y; afterEq.lastIndex = i + ar[0].length;
          if (afterEq.test(code)) tok("syn-prop", i, i + ar[0].length);
          else if (code[i - 1] === "=" ) tok("syn-str", i, i + ar[0].length);
          else tok("syn-prop", i, i + ar[0].length);
          i += ar[0].length;
        }
        if (i < n) { tok("syn-punc", i, i + 1); i++; }
        const name = tr[2].toLowerCase();
        if (!tr[1] && (name === "script" || name === "style")) {
          const close = code.toLowerCase().indexOf(`</${name}`, i);
          const end = close < 0 ? n : close;
          flush();
          const inner = code.slice(i, end);
          for (const t of name === "script" ? tokenizeC(inner, LANGS.javascript) : tokenizeCss(inner)) out.push(t);
          i = end;
        }
        continue;
      }
      plain += code[i]; i++;
    }
    flush();
    return out;
  }

  function tokensToLines(tokens) {
    const lines = [];
    let cur = "";
    for (const [cls, text] of tokens) {
      const parts = text.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) { lines.push(cur); cur = ""; }
        if (part) cur += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
      });
    }
    lines.push(cur);
    return lines;
  }

  /* Returns one HTML string per source line (multi-line comments/strings keep their colour on every line). */
  function highlightToLines(code, lang) {
    const text = String(code || "").replace(/\r\n?/g, "\n");
    const spec = langSpec(lang);
    if (spec.kind === "text" || text.length > 200000) return text.split("\n").map(esc);
    try {
      const tokens =
        spec.kind === "html" ? tokenizeHtml(text)
        : spec.kind === "css" ? tokenizeCss(text)
        : spec.kind === "json" ? tokenizeJson(text)
        : spec.kind === "yaml" ? tokenizeYaml(text)
        : tokenizeC(text, spec);
      return tokensToLines(tokens);
    } catch (error) {
      return text.split("\n").map(esc);
    }
  }

  /* ---------- Video links ---------- */
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const isValidVideoId = (provider, id) =>
    provider === "youtube" ? YT_ID.test(String(id || "")) : provider === "archive" ? ARCHIVE_ID.test(String(id || "")) : false;
  const safeVideo = (p) => {
    const provider = String(p?.videoProvider || ""), id = String(p?.videoId || "");
    return isValidVideoId(provider, id) ? { provider, id } : null;
  };
  const videoEmbedUrl = (provider, id, autoplay) =>
    provider === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${autoplay ? "&autoplay=1" : ""}`
      : `https://archive.org/embed/${encodeURIComponent(id)}`;
  const videoThumbUrl = (provider, id) =>
    provider === "youtube" ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : `https://archive.org/services/img/${encodeURIComponent(id)}`;

  function parseVideoUrl(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    let u;
    try { u = new URL(s); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/")[1] || "";
      return YT_ID.test(id) ? { provider: "youtube", id } : null;
    }
    if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v") || "";
        return YT_ID.test(id) ? { provider: "youtube", id } : null;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
      return m ? { provider: "youtube", id: m[1] } : null;
    }
    if (host === "archive.org") {
      const m = u.pathname.match(/^\/(?:details|embed|download)\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:[/?]|$)/);
      return m ? { provider: "archive", id: m[1] } : null;
    }
    return null;
  }

  async function fetchWithTimeout(url, ms = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    } finally {
      clearTimeout(timer);
    }
  }
  function imageLoads(url, ms = 7000) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(false), ms);
      img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 120); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.referrerPolicy = "no-referrer";
      img.src = url;
    });
  }

  /* Checks that the video exists and may be embedded. Resolves { ok, title?, reason?, soft? } and never throws. */
  async function verifyVideo(provider, id) {
    if (!isValidVideoId(provider, id)) return { ok: false, reason: "رابط الفيديو غير صالح." };
    if (provider === "youtube") {
      try {
        const res = await fetchWithTimeout(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: true, title: String(data.title || "").slice(0, 140) };
        }
        if (res.status === 401 || res.status === 403) return { ok: false, reason: "صاحب الفيديو لا يسمح بتضمينه في المواقع الأخرى." };
        if (res.status === 404 || res.status === 400) return { ok: false, reason: "الفيديو غير موجود، أو هو خاص أو محذوف." };
        return { ok: false, reason: "تعذر التحقق من الفيديو الآن. حاول مرة أخرى." };
      } catch {
        // The oEmbed endpoint may be unreachable (network/CORS): fall back to checking the public thumbnail.
        const exists = await imageLoads(videoThumbUrl("youtube", id));
        return exists ? { ok: true, title: "", soft: true } : { ok: false, reason: "تعذر الوصول إلى الفيديو؛ تأكد من الرابط ومن اتصالك بالإنترنت." };
      }
    }
    try {
      const res = await fetchWithTimeout(`https://archive.org/metadata/${encodeURIComponent(id)}`);
      if (!res.ok) return { ok: false, reason: "تعذر الوصول إلى مصدر الفيديو الآن. حاول مرة أخرى." };
      const data = await res.json();
      const meta = data && data.metadata;
      if (!meta || !Object.keys(meta).length) return { ok: false, reason: "هذا الفيديو غير موجود." };
      if (data.is_dark || String(meta["access-restricted-item"]) === "true") return { ok: false, reason: "هذا العنصر مقيّد أو غير متاح للعرض." };
      if (String(meta.mediatype) !== "movies") return { ok: false, reason: "هذا الرابط ليس فيديو." };
      const playable = (data.files || []).some((f) => /\.(mp4|webm|ogv|mkv|m4v|mov|avi|mpg|mpeg)$/i.test(String(f.name || "")) || /MPEG4|h\.264|Ogg Video|WebM|Matroska/i.test(String(f.format || "")));
      if (!playable) return { ok: false, reason: "لا يحتوي هذا العنصر على ملف فيديو قابل للتشغيل." };
      const title = Array.isArray(meta.title) ? meta.title[0] : meta.title;
      return { ok: true, title: String(title || "").slice(0, 140) };
    } catch {
      return { ok: false, reason: "تعذر التحقق من الفيديو؛ تأكد من اتصالك بالإنترنت ثم أعد المحاولة." };
    }
  }

  const PLAY_ICON = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z" fill="currentColor"/></svg>';
  /* Lazy "facade": a thumbnail + play button. The real player is only created when the visitor presses play. */
  function videoBlock(p) {
    const v = safeVideo(p);
    if (!v) return "";
    return `<figure class="video-card" data-provider="${v.provider}"><div class="video-frame"><button type="button" class="video-play" data-action="play-video" data-provider="${v.provider}" data-vid="${esc(v.id)}" aria-label="${esc(localizeText("تشغيل الفيديو"))}"><img src="${esc(videoThumbUrl(v.provider, v.id))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="video-btn">${PLAY_ICON}</span></button></div></figure>`;
  }
  function playVideo(button) {
    const provider = button.dataset.provider, id = button.dataset.vid;
    if (!isValidVideoId(provider, id)) return;
    const frame = button.closest(".video-frame");
    if (!frame) return;
    const iframe = document.createElement("iframe");
    iframe.src = videoEmbedUrl(provider, id, true);
    iframe.title = localizeText("مشغل الفيديو");
    iframe.dataset.vid = id; // marks a running player so re-renders keep it alive (see morphInto)
    iframe.dataset.provider = provider;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    frame.replaceChildren(iframe);
  }
  document.addEventListener("error", (e) => {
    if (e.target?.matches?.(".video-play img")) e.target.remove();
  }, true);

  /* ---------- Composer: video field ---------- */
  let videoCheckSeq = 0, videoCheckTimer = 0, videoLastReason = "";
  function setVideoStatus(state, text) {
    const el = document.querySelector("#videoStatus");
    if (!el) return;
    el.className = `video-status ${state}`;
    el.textContent = text ? localizeText(text) : "";
    videoLastReason = state === "error" ? text : "";
  }
  function setVideoValue(provider, id) {
    const p = document.querySelector("#videoProvider"), i = document.querySelector("#videoId");
    if (p) p.value = provider || "";
    if (i) i.value = id || "";
  }
  async function checkVideoInput() {
    const input = document.querySelector("#publishVideo");
    if (!input) return null;
    const preview = document.querySelector("#videoPreview");
    const raw = input.value.trim();
    const seq = ++videoCheckSeq;
    setVideoValue("", "");
    if (!raw) {
      setVideoStatus("", "");
      if (preview) preview.innerHTML = "";
      syncMediaExclusivity();
      return null;
    }
    const parsed = parseVideoUrl(raw);
    if (!parsed) {
      setVideoStatus("error", "الرابط غير مدعوم. تأكد من أنه رابط فيديو صحيح من مصدر مدعوم.");
      if (preview) preview.innerHTML = "";
      return null;
    }
    setVideoStatus("loading", "جارٍ التحقق من أن الفيديو يعمل…");
    const res = await verifyVideo(parsed.provider, parsed.id);
    if (seq !== videoCheckSeq) return null;
    if (!res.ok) {
      setVideoStatus("error", res.reason);
      if (preview) preview.innerHTML = "";
      syncMediaExclusivity();
      return null;
    }
    setVideoValue(parsed.provider, parsed.id);
    setVideoStatus("ok", `✓ الفيديو يعمل${res.title ? ` — ${res.title}` : ""}`);
    if (preview) preview.innerHTML = videoBlock({ videoProvider: parsed.provider, videoId: parsed.id });
    syncMediaExclusivity();
    return parsed;
  }
  function scheduleVideoCheck() {
    clearTimeout(videoCheckTimer);
    videoCheckTimer = setTimeout(checkVideoInput, 450);
  }
  function clearVideoField() {
    clearTimeout(videoCheckTimer);
    videoCheckSeq++;
    const input = document.querySelector("#publishVideo");
    if (input) input.value = "";
    setVideoValue("", "");
    setVideoStatus("", "");
    const preview = document.querySelector("#videoPreview");
    if (preview) preview.innerHTML = "";
    syncMediaExclusivity();
  }
  function prefillVideoFields(p) {
    const v = safeVideo(p);
    if (!v || !document.querySelector("#publishVideo")) return;
    setVideoValue(v.provider, v.id);
    setVideoStatus("ok", "✓ الفيديو الحالي في المنشور");
    const preview = document.querySelector("#videoPreview");
    if (preview) preview.innerHTML = videoBlock(p);
    syncMediaExclusivity();
  }

  /* A post can hold a video OR code/a file — never both. */
  function syncMediaExclusivity() {
    const input = document.querySelector("#publishVideo");
    if (!input) return;
    const hasCode = !!(document.querySelector("#publishCode")?.value.trim()) || !!selectedCodeFileBase64;
    const hasVideo = !!document.querySelector("#videoId")?.value;
    input.disabled = hasCode;
    const clear = document.querySelector("#videoClear");
    if (clear) clear.hidden = !(input.value.trim() || hasVideo) || hasCode;
    const lock = document.querySelector("#videoLock");
    if (lock) {
      lock.hidden = !hasCode;
      lock.textContent = localizeText("أزل الكود أو الملف أولاً لتتمكن من إضافة فيديو.");
    }
    document.querySelector("#videoAttach")?.classList.toggle("locked", hasCode);
    document.querySelector("#codeAttach")?.classList.toggle("locked", hasVideo);
    refreshCodeAttach();
  }

  /* ---------- Composer: code attachment card ---------- */
  const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
  function refreshCodeAttach() {
    const host = document.querySelector("#codeAttachBody");
    if (!host) return;
    const T = localizeText;
    const codeEl = document.querySelector("#publishCode");
    const code = (codeEl?.value || "").trim();
    const lang = document.querySelector("#publishLanguage")?.value || "javascript";
    const fname = document.querySelector("#codeFilename")?.value.trim() || "";
    const hasVideo = !!document.querySelector("#videoId")?.value;
    const article = document.querySelector("#publishKind")?.value === "مقالة";
    if (hasVideo) {
      host.innerHTML = `<div class="code-locked">${esc(T("تمت إضافة فيديو، لذلك لا يمكن إرفاق كود أو ملف. أزل الفيديو إن أردت إضافة كود."))}</div>`;
      return;
    }
    if (code) {
      const lines = code.split("\n").length;
      host.innerHTML = `${codeWindow(code, lang, fname)}<div class="code-actions"><button type="button" class="btn small primary" data-action="open-code-studio">✎ ${esc(T("تعديل في المحرر"))}</button><button type="button" class="btn small danger ghost" data-action="remove-code">${esc(T("إزالة الكود"))}</button><span class="muted">${lines} ${language === "en" ? "lines" : "سطر"} · ${fmtBytes(utf8Bytes(code))} · ${esc(langSpec(lang).label)}</span></div>`;
      return;
    }
    host.innerHTML = `<div class="code-empty"><span class="code-empty-ic">&lt;/&gt;</span><div class="code-empty-t"><b>${esc(T("أضف مقطع كود"))}</b><span>${esc(T("اكتب أو الصق الكود في محرر مخصص بتلوين حسب لغة البرمجة."))}</span></div><div class="code-empty-a"><button type="button" class="btn small primary" data-action="open-code-studio">✎ ${esc(T("كتابة الكود"))}</button>${article ? "" : `<label class="btn small" id="codeFileLabel" for="codeFile">📄 ${esc(T("رفع ملف"))}</label>`}</div></div>`;
  }
  function removeCode() {
    const code = document.querySelector("#publishCode");
    if (code) code.value = "";
    clearSelectedCodeFile(false);
    refreshCodeAttach();
    syncMediaExclusivity();
  }

  /* ---------- Code studio: a full-screen, VS Code-style editor ---------- */
  let studio = null;
  function studioClose(apply) {
    if (!studio) return;
    const { root, ta, getLang, original, startLang, viewportHandler } = studio;
    if (apply) {
      const text = ta.value.replace(/\r\n?/g, "\n").replace(/\s+$/g, "");
      const kind = document.querySelector("#publishKind")?.value || "نقاش";
      const cap = maxCodeBytes(kind);
      if (utf8Bytes(text) > cap) {
        toast(language === "en" ? `The code is too large (limit ${fmtBytes(cap)}).` : `الكود كبير جداً (الحد ${fmtBytes(cap)}).`, "error");
        return;
      }
      const codeEl = document.querySelector("#publishCode"), langEl = document.querySelector("#publishLanguage");
      if (codeEl) codeEl.value = text;
      if (langEl) langEl.value = getLang();
      if (selectedCodeFileBase64 && text !== selectedCodeFileText) clearSelectedCodeFile(false);
    } else if (ta.value !== original || getLang() !== startLang) {
      if (!window.confirm(localizeText("تجاهل التعديلات على الكود؟"))) return;
    }
    if (window.visualViewport && viewportHandler) {
      window.visualViewport.removeEventListener("resize", viewportHandler);
      window.visualViewport.removeEventListener("scroll", viewportHandler);
    }
    root.remove();
    document.documentElement.classList.remove("studio-open");
    studio = null;
    refreshCodeAttach();
    syncMediaExclusivity();
  }

  function openCodeStudio() {
    if (studio) return;
    if (document.querySelector("#videoId")?.value) {
      toast("تمت إضافة فيديو؛ أزله أولاً لتتمكن من إضافة كود.", "error");
      return;
    }
    const T = localizeText;
    const codeEl = document.querySelector("#publishCode"), langEl = document.querySelector("#publishLanguage");
    if (!codeEl || !langEl) return;
    const kind = document.querySelector("#publishKind")?.value || "نقاش";
    const cap = maxCodeBytes(kind);
    const article = kind === "مقالة";
    const startText = codeEl.value, startLang = normLang(langEl.value);
    let lang = startLang;
    const root = document.createElement("div");
    root.className = "code-studio";
    root.id = "codeStudio";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", T("محرر الكود"));
    const chips = LANG_ORDER.map((k) => `<button type="button" class="cs-chip${k === lang ? " active" : ""}" data-lang="${k}" role="tab" aria-selected="${k === lang}">${esc(LANGS[k].label)}</button>`).join("");
    const keys = [["⇥", "\t", "Tab"], ["{ }", "{}"], ["( )", "()"], ["[ ]", "[]"], ["< >", "<>"], ['" "', '""'], ["' '", "''"], ["`", "`"], [";", ";"], [":", ":"], ["=", "="], ["=>", "=> "], ["/", "/"], ["\\", "\\"], ["$", "$"], ["#", "#"]]
      .map(([label, ins, aria]) => `<button type="button" class="cs-key" data-ins="${esc(ins)}"${aria ? ` aria-label="${aria}"` : ""}>${esc(label)}</button>`).join("");
    root.innerHTML = `<div class="cs-bar" dir="rtl"><div class="cs-bar-start"><span class="vs-dots"><i></i><i></i><i></i></span><span class="cs-title">${esc(T("محرر الكود"))}</span></div><div class="cs-tab" dir="ltr"><span class="vs-file-icon">◆</span><span id="csFile"></span></div><div class="cs-bar-end">${article ? "" : `<label class="cs-btn" for="codeFile">📄 ${esc(T("فتح ملف"))}</label>`}<button type="button" class="cs-btn" data-cs="cancel">${esc(T("إلغاء"))}</button><button type="button" class="cs-btn primary" data-cs="apply">${esc(T("إرفاق الكود"))}</button></div></div><div class="cs-langs" dir="rtl" role="tablist" aria-label="${esc(T("لغة البرمجة"))}">${chips}</div><div class="cs-main" dir="ltr"><pre class="cs-gutter" aria-hidden="true"></pre><div class="cs-stage"><pre class="cs-hl" aria-hidden="true"><code></code></pre><textarea class="cs-ta" id="csInput" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="${esc(T("اكتب الكود هنا"))}" placeholder="${esc(T("اكتب أو الصق الكود هنا…"))}"></textarea></div></div><div class="cs-keys" dir="ltr" aria-label="${esc(T("اختصارات الكتابة"))}">${keys}</div><div class="cs-status" dir="rtl"><span id="csPos">Ln 1, Col 1</span><span id="csIndent"></span><span>UTF-8</span><span id="csLang"></span><span class="cs-size" id="csSize"></span></div>`;
    document.body.appendChild(root);
    document.documentElement.classList.add("studio-open");

    const ta = root.querySelector("#csInput"), hl = root.querySelector(".cs-hl code"), hlPre = root.querySelector(".cs-hl"), gutter = root.querySelector(".cs-gutter");
    ta.value = startText;
    const unit = () => " ".repeat(LANGS[lang].indent || 2);
    let raf = 0;
    const paint = () => {
      raf = 0;
      const text = ta.value;
      const count = text.split("\n").length;
      let nums = "";
      for (let i = 1; i <= count; i++) nums += (i > 1 ? "\n" : "") + i;
      gutter.textContent = nums;
      gutter.style.minWidth = `${String(count).length + 2}ch`;
      hl.innerHTML = highlightToLines(text, lang).join("\n") + "\n";
      const bytes = utf8Bytes(text);
      const size = root.querySelector("#csSize");
      size.textContent = `${fmtBytes(bytes)} / ${fmtBytes(cap)}`;
      size.classList.toggle("over", bytes > cap);
      hlPre.scrollTop = ta.scrollTop; hlPre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop;
    };
    const schedulePaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const pos = () => {
      const before = ta.value.slice(0, ta.selectionStart).split("\n");
      root.querySelector("#csPos").textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
    };
    const meta = () => {
      const fileLabel = selectedCodeFileName && lang === startLang ? selectedCodeFileName : codeFileName(lang);
      root.querySelector("#csFile").textContent = fileLabel;
      root.querySelector("#csLang").textContent = LANGS[lang].label;
      root.querySelector("#csIndent").textContent = `${language === "en" ? "Spaces" : "مسافات"}: ${LANGS[lang].indent || 2}`;
      root.querySelectorAll(".cs-chip").forEach((c) => { const on = c.dataset.lang === lang; c.classList.toggle("active", on); c.setAttribute("aria-selected", String(on)); });
    };
    const insert = (text) => {
      ta.focus();
      if (!document.execCommand || !document.execCommand("insertText", false, text)) {
        const s = ta.selectionStart;
        ta.setRangeText(text, s, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    const wordChar = /[\w$]/;
    const insertPair = (open) => {
      const close = PAIRS[open], s = ta.selectionStart, e = ta.selectionEnd;
      if (e > s) { const sel = ta.value.slice(s, e); insert(open + sel + close); ta.setSelectionRange(s + 1, s + 1 + sel.length); return; }
      insert(open + close);
      ta.setSelectionRange(s + 1, s + 1);
    };
    const lineRange = () => {
      const v = ta.value, s = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
      let e = v.indexOf("\n", ta.selectionEnd); if (e < 0) e = v.length;
      return [s, e];
    };
    const reindent = (outdent) => {
      const [s, e] = lineRange();
      const block = ta.value.slice(s, e), u = unit();
      const changed = block.split("\n").map((line) => (outdent ? (line.startsWith(u) ? line.slice(u.length) : line.replace(/^\t| {1,3}/, "")) : (line ? u + line : line))).join("\n");
      const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
      ta.setSelectionRange(s, e);
      insert(changed);
      const delta = changed.length - block.length, firstDelta = (changed.split("\n")[0].length - block.split("\n")[0].length);
      ta.setSelectionRange(Math.max(s, selStart + firstDelta), selEnd + delta);
    };

    ta.addEventListener("input", () => { schedulePaint(); pos(); });
    ta.addEventListener("scroll", () => { hlPre.scrollTop = ta.scrollTop; hlPre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; });
    ta.addEventListener("keyup", pos);
    ta.addEventListener("click", pos);
    ta.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Tab" && !mod) {
        e.preventDefault();
        if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes("\n") || e.shiftKey) reindent(e.shiftKey);
        else insert(unit());
        return;
      }
      if (e.key === "Enter" && !mod && !e.shiftKey) {
        const v = ta.value, s = ta.selectionStart, e2 = ta.selectionEnd;
        const ls = v.lastIndexOf("\n", s - 1) + 1, line = v.slice(ls, s);
        const base = /^[ \t]*/.exec(line)[0];
        const before = v[s - 1] || "", after = v[e2] || "";
        const opener = "{[(".includes(before) || (langSpec(lang).kind === "c" && lang === "python" && before === ":");
        e.preventDefault();
        if (opener && "}])".includes(after) && "{[(".indexOf(before) === "}])".indexOf(after) && before !== ":") {
          insert(`\n${base}${unit()}\n${base}`);
          const p = s + 1 + base.length + unit().length;
          ta.setSelectionRange(p, p);
        } else insert(`\n${base}${opener ? unit() : ""}`);
        return;
      }
      if (!mod && !e.altKey) {
        const k = e.key, s = ta.selectionStart, v = ta.value, next = v[s] || "", prev = v[s - 1] || "";
        if (PAIRS[k] !== undefined) {
          const quote = k === '"' || k === "'" || k === "`";
          if (quote && next === k && ta.selectionStart === ta.selectionEnd) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
          if (quote && wordChar.test(prev) && ta.selectionStart === ta.selectionEnd) return;
          if (ta.selectionStart !== ta.selectionEnd || !next || /[\s)\]}>,;:]/.test(next)) { e.preventDefault(); insertPair(k); return; }
        }
        if ((k === ")" || k === "]" || k === "}") && next === k && ta.selectionStart === ta.selectionEnd) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
        if ((k === ")" || k === "]" || k === "}") && ta.selectionStart === ta.selectionEnd) {
          const lineStart = v.lastIndexOf("\n", s - 1) + 1, lead = v.slice(lineStart, s);
          if (lead && /^[ \t]+$/.test(lead)) {
            e.preventDefault();
            const u = unit();
            ta.setSelectionRange(s - (lead.endsWith(u) ? u.length : 1), s);
            insert(k);
            return;
          }
        }
        if (k === "Backspace" && ta.selectionStart === ta.selectionEnd && PAIRS[prev] !== undefined && PAIRS[prev] === next) {
          e.preventDefault(); ta.setSelectionRange(s - 1, s + 1); insert(""); return;
        }
      }
    });
    root.addEventListener("click", (e) => {
      const chip = e.target.closest(".cs-chip");
      if (chip) { lang = normLang(chip.dataset.lang); meta(); schedulePaint(); ta.focus(); return; }
      const key = e.target.closest(".cs-key");
      if (key) {
        const ins = key.dataset.ins;
        if (ins === "\t") insert(unit());
        else if (ins.length === 2 && PAIRS[ins[0]] === ins[1]) insertPair(ins[0]);
        else insert(ins);
        return;
      }
      const act = e.target.closest("[data-cs]")?.dataset.cs;
      if (act === "apply") studioClose(true);
      if (act === "cancel") studioClose(false);
    });
    /* Keep the editor above the on-screen keyboard on phones. */
    const vv = window.visualViewport;
    const viewportHandler = vv ? () => { root.style.height = `${vv.height}px`; root.style.top = `${vv.offsetTop}px`; } : null;
    if (vv) { vv.addEventListener("resize", viewportHandler); vv.addEventListener("scroll", viewportHandler); viewportHandler(); }
    studio = { root, ta, getLang: () => lang, original: startText, startLang, viewportHandler, reload: () => { ta.value = codeEl.value; if (selectedCodeFileName) { const ext = (selectedCodeFileName.split(".").pop() || "").toLowerCase(); const hit = LANG_ORDER.find((k) => LANGS[k].ext === ext); if (hit) lang = hit; } meta(); schedulePaint(); pos(); } };
    meta(); paint(); pos();
    setTimeout(() => ta.focus(), 30);
  }


  /* ---------- Re-render without killing a running video ----------
     Any DOM replacement reloads an <iframe>, which restarts the video. When a player is running, the page is
     patched in place (keyed by post) instead of being rebuilt, and the running player is never touched. */
  const morphKey = (n) => (n.nodeType === 1 ? n.getAttribute("data-post") || n.id || "" : "");
  function morphAttrs(from, to) {
    for (const a of Array.from(from.attributes)) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    for (const a of Array.from(to.attributes)) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  }
  function morphNode(oldNode, newNode) {
    if (oldNode.nodeType !== 1) {
      if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
      return;
    }
    if (oldNode.classList.contains("video-card")) {
      const running = oldNode.querySelector("iframe[data-vid]"), button = newNode.querySelector?.(".video-play");
      if (running && button && button.dataset.vid === running.dataset.vid) return; // same video: leave the player alone
    }
    morphAttrs(oldNode, newNode);
    morphChildren(oldNode, newNode);
  }
  function morphChildren(oldParent, newParent) {
    const newKids = Array.from(newParent.childNodes);
    const newKeys = new Set(newKids.map(morphKey).filter(Boolean));
    for (const n of Array.from(oldParent.childNodes)) {
      const k = morphKey(n);
      if (k && !newKeys.has(k)) oldParent.removeChild(n);
    }
    const used = new Set();
    let cursor = oldParent.firstChild;
    for (const nn of newKids) {
      while (cursor && used.has(cursor)) cursor = cursor.nextSibling;
      const k = morphKey(nn);
      let match = null;
      if (k) match = Array.from(oldParent.childNodes).find((x) => !used.has(x) && morphKey(x) === k) || null;
      else {
        let c = cursor;
        while (c && (used.has(c) || morphKey(c))) c = c.nextSibling;
        if (c && c.nodeType === nn.nodeType && c.nodeName === nn.nodeName) match = c;
      }
      if (match) {
        used.add(match);
        if (match === cursor) cursor = cursor.nextSibling;
        else {
          // Moving a node that contains a running player would reload it, so first try to just drop the stale
          // unkeyed nodes (usually whitespace) that sit in front of the match; move only as a last resort.
          let c = cursor;
          while (c && c !== match && !used.has(c) && !morphKey(c)) c = c.nextSibling;
          if (c === match) {
            while (cursor !== match) { const next = cursor.nextSibling; oldParent.removeChild(cursor); cursor = next; }
            cursor = match.nextSibling;
          } else oldParent.insertBefore(match, cursor);
        }
        morphNode(match, nn);
      } else {
        const fresh = document.importNode(nn, true);
        oldParent.insertBefore(fresh, cursor);
        used.add(fresh);
      }
    }
    for (const n of Array.from(oldParent.childNodes)) if (!used.has(n)) oldParent.removeChild(n);
  }
  function morphInto(root, html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    morphChildren(root, tpl.content);
  }

  /* >>> CODEEX_MEDIA_END */

  function codeWindow(code, language = "javascript", filename = "", postId = "") {
    const key = normLang(language), spec = LANGS[key];
    const file = filename || `snippet.${spec.ext}`;
    const lines = highlightToLines(String(code || "").split("\n").slice(0, 180).join("\n"), key);
    return `<section class="vscode-window" aria-label="مقطع كود ${esc(file)}"><div class="vs-head"><span class="vs-dots"><i></i><i></i><i></i></span><div class="vs-tab"><span class="vs-file-icon">◆</span>${esc(file)}</div><span class="vs-lang">${esc(spec.label)}</span>${postId ? `<button class="vs-copy" data-action="copy-code" data-id="${esc(postId)}">نسخ الكود</button>` : ""}</div><div class="vs-code">${lines.map((line, i) => `<div class="vs-line"><span class="vs-no">${i + 1}</span><span class="vs-src">${line || "&nbsp;"}</span></div>`).join("")}</div></section>`;
  }

  function renderPostTextWithLinks(value) {
    const text = String(value || "");
    const urlPattern = /https?:\/\/[^\s<>"']+/giu;
    const trailingPunctuation = /[.,!?،؛؟:]+$/u;
    let output = "", cursor = 0, match;
    while ((match = urlPattern.exec(text))) {
      const raw = match[0];
      const url = raw.replace(trailingPunctuation, "");
      output += esc(text.slice(cursor, match.index));
      let safeUrl = "";
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") safeUrl = parsed.href;
      } catch {}
      if (safeUrl) {
        output += `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer nofollow">${esc(url)}</a>${esc(raw.slice(url.length))}`;
      } else {
        output += esc(raw);
      }
      cursor = match.index + raw.length;
    }
    return output + esc(text.slice(cursor));
  }

  function postTextPreview(p) {
    const text = String(p.text || "");
    const lines = text.split(/\r\n|\r|\n/).length;
    const collapsed = lines > 3 || text.length > 180;
    return `<p class="post-text${collapsed ? " collapsed" : ""}">${renderPostTextWithLinks(text)}</p>${collapsed ? '<button type="button" class="post-text-toggle" data-action="toggle-post-text" aria-expanded="false">عرض المزيد</button>' : ""}`;
  }

  function postCard(p) {
    const author = { ...p, ...(publicProfiles[p.uid] || {}) };
    const user = currentUser();
    const liked = (p.likedBy || []).includes(user?.uid || "guest");
    const saved = Store.saved().includes(p.id);
    return `<article class="panel post" data-post="${esc(p.id)}"><div class="post-header"><span class="avatar ${esc(p.tone || "blue")}"${p.uid ? ` data-action="open-profile" data-uid="${esc(p.uid)}"` : ""}>${avatarContent(author)}</span><div class="post-ident"><strong>${profileLink(p.uid, author.name || p.name)}</strong> <span class="kind-pill ${p.kind === "سؤال" ? "question" : p.kind === "مقالة" ? "article" : ""}">${esc(p.kind || "نقاش")}</span><div class="post-meta" dir="rtl">@${esc(author.handle || p.handle || "member")} · ${timeAgo(p.createdAt || Date.now())}</div></div><button class="post-menu" data-action="post-menu" data-id="${esc(p.id)}" title="المزيد">${icon("dots")}</button></div>${p.title ? `<h3 class="post-title">${esc(p.title)}</h3>` : ""}${postTextPreview(p)}${videoBlock(p)}${p.code ? codeWindow(p.code, p.codeLanguage, p.fileName, p.id) : ""}<div class="post-tags">${(p.tags || []).map((t) => `<button class="tag" data-action="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div><div class="post-footer"><button class="post-action like ${liked ? "active" : ""}" data-action="like" data-id="${esc(p.id)}">${icon("heart")}<span>${Number(p.likes || 0)}</span></button><button class="post-action" data-action="comment" data-id="${esc(p.id)}">${icon("comment")}<span>${(p.comments || []).length}</span></button><button class="post-action ${saved ? "active" : ""}" data-action="save" data-id="${esc(p.id)}">${icon("bookmark")}<span>${saved ? "محفوظ" : "حفظ"}</span></button><button class="post-action" data-action="share" data-id="${esc(p.id)}">${icon("share")}<span>مشاركة</span></button><button class="post-action more" data-action="expand" data-id="${esc(p.id)}">عرض المزيد ${icon("arrow")}</button></div></article>`;
  }

  function findPost(id) {
    return [...cloudPosts, ...Object.values(privateGroupPosts || {}).flat()].find(
      (p) => p.id === id,
    );
  }

  async function openSharedPostWhenReady() {
    const postId = pendingSharedPostId;
    if (!postId || !/^[A-Za-z0-9_-]{1,128}$/.test(postId) || !currentUser() || !database || !sharedAuthReady || sharedPostHandled || sharedPostLookupBusy) return;
    let post = findPost(postId);
    if (post) {
      sharedPostHandled = true;
      openModal("تفاصيل المشاركة", postCard(post));
      return;
    }
    if (!postsReady) return;
    sharedPostLookupBusy = true;
    try {
      const groupId = pendingSharedGroupId;
      if (groupId && !/^[A-Za-z0-9_-]{1,128}$/.test(groupId)) throw new Error("invalid group id");
      const path = groupId ? `groupPosts/${groupId}/${postId}` : `posts/${postId}`;
      const snapshot = await database.ref(path).once("value");
      const record = snapshot.val();
      if (!record?.data) throw new Error("post missing or unauthorized");
      const reactions = record.reactions || {};
      const comments = Object.entries(record.comments || {})
        .map(([commentId, comment]) => ({ ...comment, id: commentId }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      post = {
        ...record.data,
        id: postId,
        tags: Array.isArray(record.data.tags) ? record.data.tags : Object.values(record.data.tags || {}),
        comments,
        likedBy: Object.keys(reactions).filter((uid) => reactions[uid] === true),
        likes: Object.values(reactions).filter((liked) => liked === true).length,
        ...(groupId ? { privateGroupId: groupId } : {}),
      };
      if (groupId) privateGroupPosts[groupId] = [post, ...(privateGroupPosts[groupId] || []).filter((item) => item.id !== postId)];
      else cloudPosts = [post, ...cloudPosts.filter((item) => item.id !== postId)];
      sharedPostHandled = true;
      openModal("تفاصيل المشاركة", postCard(post));
    } catch (error) {
      sharedPostHandled = true;
      toast("لم يتم العثور على المنشور أو لا تملك صلاحية عرضه.", "error");
    } finally {
      sharedPostLookupBusy = false;
    }
  }
  function allPosts() {
    return Store.posts().filter(
      (p) =>
        !searchTerm ||
        `${p.name} ${p.title || ""} ${p.text} ${(p.tags || []).join(" ")}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
    );
  }

  function filteredPosts(filter = "") {
    let arr = allPosts();
    if (filter === "مقالات") arr = arr.filter((p) => p.kind === "مقالة");
    if (filter === "موارد") arr = arr.filter((p) => ["مورد", "مشروع"].includes(p.kind));
    if (filter === "الأكثر تفاعلاً") return arr.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function feedSkeleton() {
    const bar = (w) => `<div style="height:13px;width:${w};background:rgba(127,127,127,.18);border-radius:6px;margin:9px 0"></div>`;
    return [0, 1, 2].map(() => `<div class="panel post skeleton" aria-hidden="true">${bar("38%")}${bar("92%")}${bar("84%")}${bar("60%")}</div>`).join("");
  }

  function feed() {
    const filters = ["الأحدث", "الأكثر تفاعلاً", "المقالات", "الموارد"];
    const map = { المقالات: "مقالات", الموارد: "موارد" };
    let selected = map[feedFilter] || feedFilter;
    let items = filteredPosts(selected);
    const toolbar = `<div class="feed-toolbar"><div class="tabs">${filters.map((f) => `<button class="${feedFilter === f ? "active" : ""}" data-action="filter" data-filter="${f}">${f}</button>`).join("")}</div><span class="sort-label">${searchTerm ? "نتائج البحث" : "الأحدث أولاً"}</span></div>`;
    if (!items.length && !postsReady) return `${composer()}${toolbar}${feedSkeleton()}`;
    if (!items.length && postsLoadError)
      return `${composer()}${toolbar}<div class="panel empty-state"><b>تعذّر تحميل المنشورات</b><p>تحقق من اتصالك ثم أعد تحميل الصفحة.</p></div>`;
    return `${composer()}${toolbar}${items.length ? items.map(postCard).join("") : `<div class="panel empty-state"><b>لا توجد نتائج هنا بعد</b>جرّب اختيار تصنيف آخر أو اكتب أول منشور.</div>`}${feedSentinel()}`;
  }


  /* ---------- Group members manager (owner, group admins and the site admin) ---------- */
  async function openGroupMembers(gid) {
    const g = groups.find((x) => x.id === gid);
    if (!g || !canManageGroup(g)) return;
    try {
      const [members, admins, kicked] = await Promise.all(
        ["groupMembers", "groupAdmins", "groupKicked"].map((n) => database.ref(`${n}/${gid}`).once("value").then((x) => x.val() || {})),
      );
      const me = activeUser.uid, iAmOwner = g.ownerUid === me, iAmSiteAdmin = isAdminUid(me);
      const person = (uid) => publicProfiles[uid] || { uid, name: "عضو", handle: "" };
      const rows = Object.keys(members)
        .filter((uid) => members[uid] === true)
        .sort((a, b) => (a === g.ownerUid ? -1 : b === g.ownerUid ? 1 : String(person(a).name).localeCompare(String(person(b).name), "ar")))
        .map((uid) => {
          const u = person(uid), isOwnerRow = uid === g.ownerUid, isAdminRow = admins[uid] === true, isSite = isAdminUid(uid);
          const badges = `${isOwnerRow ? '<span class="gm-badge owner">المالك</span>' : ""}${isAdminRow ? '<span class="gm-badge mod">مشرف</span>' : ""}${isSite ? ADMIN_BADGE : ""}`;
          const canKick = uid !== me && !isOwnerRow && !isSite && (iAmOwner || iAmSiteAdmin || !isAdminRow);
          const actions = [
            iAmOwner && !isOwnerRow && !isSite ? `<button type="button" class="btn small" data-action="${isAdminRow ? "demote-admin" : "promote-admin"}" data-group="${esc(gid)}" data-user="${esc(uid)}">${isAdminRow ? "إزالة الإشراف" : "تعيين مشرفاً"}</button>` : "",
            canKick ? `<button type="button" class="btn small danger ghost" data-action="kick-member" data-group="${esc(gid)}" data-user="${esc(uid)}">طرد</button>` : "",
          ].join("");
          return `<div class="gm-row"><span class="avatar small">${avatarContent(u)}</span><span class="gm-who"><strong>${esc(u.name || "عضو")}${badges}</strong><small>@${esc(u.handle || "member")}</small></span><span class="gm-actions">${actions}</span></div>`;
        })
        .join("");
      const bannedRows = Object.keys(kicked)
        .filter((uid) => kicked[uid] === true)
        .map((uid) => `<div class="gm-row"><span class="avatar small">${avatarContent(person(uid))}</span><span class="gm-who"><strong>${esc(person(uid).name || "عضو")}</strong><small>@${esc(person(uid).handle || "member")}</small></span><span class="gm-actions"><button type="button" class="btn small" data-action="unkick-member" data-group="${esc(gid)}" data-user="${esc(uid)}">السماح بالعودة</button></span></div>`)
        .join("");
      openModal(`أعضاء ${g.name}`, `<div class="gm-list">${rows || '<p class="muted">لا يوجد أعضاء.</p>'}</div>${bannedRows ? `<h4 class="gm-title">المطرودون</h4><div class="gm-list">${bannedRows}</div>` : ""}<p class="muted gm-note">لا يمكن طرد المالك أو أدمن الموقع.</p>`);
    } catch (error) {
      handleError(error);
    }
  }
  async function groupMemberAction(action, gid, uid) {
    const g = groups.find((x) => x.id === gid);
    if (!g || !uid || !canManageGroup(g)) return;
    try {
      if (action === "promote-admin") await database.ref(`groupAdmins/${gid}/${uid}`).set(true);
      else if (action === "demote-admin") await database.ref(`groupAdmins/${gid}/${uid}`).remove();
      else if (action === "kick-member") {
        if (isAdminUid(uid) || uid === g.ownerUid) return;
        const name = publicProfiles[uid]?.name || "العضو";
        if (!window.confirm(language === "en" ? `Remove ${name} from the group?` : `طرد ${name} من المجموعة؟ لن يستطيع الانضمام مجدداً حتى تسمح له.`)) return;
        await database.ref().update({ [`groupMembers/${gid}/${uid}`]: null, [`groupKicked/${gid}/${uid}`]: true, [`groupAdmins/${gid}/${uid}`]: null });
        toast("تم طرد العضو من المجموعة");
      } else if (action === "unkick-member") {
        await database.ref(`groupKicked/${gid}/${uid}`).remove();
        toast("يمكن للعضو الانضمام مجدداً");
      }
      closeModal();
      openGroupMembers(gid);
    } catch (error) {
      handleError(error);
    }
  }

  function renderGroups() {
    return `${pageHeader("المجتمع والمجموعات", "عامّة للجميع، أو خاصة بطلب موافقة المشرف.", '<button class="btn primary" data-action="new-group">' + icon("plus") + " إنشاء مجموعة</button>")}${
      groups.length
        ? `<div class="grid-cards">${groups
            .map((g) => {
              const member = isGroupMember(g),
                pending = !!groupPendingStatus[g.id],
                requests = Object.values(groupRequestData[g.id] || {});
              const button = member
                ? `<button class="btn primary" data-action="group-open" data-id="${esc(g.id)}">دخول المجموعة</button><button class="btn ghost" data-action="leave-group" data-id="${esc(g.id)}">مغادرة</button>`
                : needsApproval(g)
                  ? `<button class="btn ${pending ? "soft" : ""}" data-action="join" data-id="${esc(g.id)}" ${pending ? "disabled" : ""}>${pending ? "طلبك قيد المراجعة" : "طلب الانضمام"}</button>`
                  : `<button class="btn" data-action="join" data-id="${esc(g.id)}">انضمام إلى المجموعة</button>`;
              return `<article class="panel feature-card group-card"><div class="group-card-head"><div class="feature-icon">${icon("groups")}</div><span class="group-visibility ${g.visibility}">${g.visibility === "private" ? icon("lock") + " خاصة" : "عامّة"}</span></div><h3>${esc(g.name)}</h3><p>${esc(g.description || "مجموعة أنشأها عضو في المجتمع.")}</p><div class="metric-row"><span>${icon("user")} ${esc(publicProfiles[g.ownerUid]?.name || "عضو")}</span><span>${g.visibility === "public" ? "تظهر منشوراتها في الرئيسية" : "منشوراتها للأعضاء فقط"}</span></div><div class="group-buttons">${button}${canManageGroup(g) ? `<button class="btn small" data-action="group-members" data-id="${esc(g.id)}">${icon("user")} الأعضاء</button>` : ""}</div>${groupAdminMap[g.id] === true && g.ownerUid !== activeUser?.uid ? '<span class="group-role">أنت مشرف في هذه المجموعة</span>' : ""}${g.ownerUid === activeUser?.uid && g.visibility === "private" ? `<div class="group-requests"><strong>طلبات الانضمام ${requests.length ? `(${requests.length})` : ""}</strong>${requests.length ? requests.map((r) => `<div class="group-request-row"><span>${esc(r.name || "عضو")}</span><div><button class="btn small primary" data-action="approve-group" data-group="${esc(g.id)}" data-user="${esc(r.uid)}">قبول</button> <button class="btn small ghost" data-action="reject-group" data-group="${esc(g.id)}" data-user="${esc(r.uid)}">رفض</button></div></div>`).join("") : '<p class="muted">لا توجد طلبات معلّقة.</p>'}</div>` : ""}</article>`;
            })
            .join("")}</div>`
        : '<div class="panel empty-state"><b>لا توجد مجموعات بعد</b><p>أنشئ مجموعة عامّة أو خاصة. تبقى منشورات المجموعة الخاصة مرئية للأعضاء فقط.</p><button class="btn primary" data-action="new-group">إنشاء أول مجموعة</button></div>'
    }`;
  }

  function renderGroupDetail() {
    const g = groups.find((x) => x.id === selectedGroupId);
    if (!g) return '<div class="panel empty-state">لم تعد هذه المجموعة متاحة.</div>';
    const member = isGroupMember(g);
    if (g.visibility !== "private") syncExtraWatchers([["data/groupId", g.id]]);
    if (g.visibility === "private" && member) subscribePrivateGroup(g);
    const posts =
      g.visibility === "private"
        ? privateGroupPosts[g.id] || []
        : cloudPosts.filter((p) => p.groupId === g.id);
    const intro = member
      ? `<button class="btn primary" data-page="compose" data-group-id="${esc(g.id)}">${icon("plus")} اكتب منشوراً للمجموعة</button>`
      : !needsApproval(g)
        ? `<button class="btn primary" data-action="join" data-id="${esc(g.id)}">انضم لرؤية منشورات المجموعة</button>`
        : `<button class="btn primary" data-action="join" data-id="${esc(g.id)}" ${groupPendingStatus[g.id] ? "disabled" : ""}>${groupPendingStatus[g.id] ? "طلبك قيد المراجعة" : "اطلب الانضمام"}</button>`;
    return `${pageHeader(g.name, `${g.visibility === "private" ? "مجموعة خاصة — المنشورات للأعضاء المقبولين فقط" : "مجموعة عامة — منشوراتها تظهر في الرئيسية"}`, `${canManageGroup(g) ? `<button class="btn" data-action="group-members" data-id="${esc(g.id)}">${icon("user")} الأعضاء</button>` : ""}<button class="btn ghost" data-page="groups">العودة للمجموعات</button>`)}<section class="panel group-detail-intro"><div class="group-card-head"><span class="feature-icon">${icon("groups")}</span><span class="group-visibility ${g.visibility}">${g.visibility === "private" ? "خاصة" : "عامّة"}</span></div><p>${esc(g.description || "")}</p>${intro}</section>${member ? (posts.length ? posts.map(postCard).join("") : '<div class="panel empty-state">لا توجد منشورات في هذه المجموعة بعد.</div>') : `<div class="panel empty-state"><b>${g.visibility === "private" ? "محتوى المجموعة خاص" : "انضم إلى المجموعة"}</b><p>${g.visibility === "private" ? "لا تظهر منشورات المجموعة الخاصة قبل قبول طلبك." : "انضم لعرض المشاركات وكتابتها."}</p>${intro}</div>`}`;
  }

  function renderArticles() {
    const arr = filteredPosts("").filter((p) => p.kind === "مقالة");
    return `${pageHeader("المقالات", "معرفة عملية وتجارب موثقة من المطورين العرب.", '<button class="btn primary" data-page="compose" data-kind="article">' + icon("plus") + " اكتب مقالة</button>")}<div class="grid-cards">${arr.map((p) => `<article class="panel feature-card"><span class="pill">مقالة تقنية</span><h3>${esc(p.title || "مقالة جديدة")}</h3><p>${esc(p.text.slice(0, 160))}${p.text.length > 160 ? "…" : ""}</p><div class="metric-row"><span>${profileLink(p.uid, personName(p))}</span><span>${timeAgo(p.createdAt)}</span><span>♥ ${p.likes || 0}</span></div><button class="btn soft" style="margin-top:13px" data-action="read-post" data-id="${esc(p.id)}">اقرأ المقالة ${icon("arrow")}</button></article>`).join("")}</div>${arr.length || !postsExhausted ? "" : '<div class="panel empty-state"><b>المقالات القادمة تبدأ منك</b>اكتب مقالة تقنية وشارك تجربتك.</div>'}${feedSentinel()}`;
  }

  function renderProjects() {
    const arr = filteredPosts("").filter((p) => p.kind === "مشروع");
    return `${pageHeader("المشاريع", "اكتشف مشاريع المجتمع، شارك مشروعك، واحصل على ملاحظات مفيدة.", '<button class="btn primary" data-page="compose" data-kind="project">' + icon("plus") + " أضف مشروعاً</button>")}<div class="grid-cards">${arr.map((p) => `<article class="panel feature-card"><div class="feature-icon">${icon("project")}</div><h3>${esc(p.title || "مشروع")}</h3><p>${esc(p.text)}</p><div class="post-tags">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div><div class="metric-row"><span>${profileLink(p.uid, personName(p))}</span><span>★ ${p.likes || 0}</span></div><button class="btn" style="margin-top:12px" data-action="save" data-id="${esc(p.id)}">☆ أضف إلى المحفوظات</button></article>`).join("")}</div>${arr.length || !postsExhausted ? "" : '<div class="panel empty-state"><b>لا توجد مشاريع منشورة</b>شارك مشروعك الأول مع المجتمع.</div>'}${feedSentinel()}`;
  }

  function renderResources() {
    const arr = filteredPosts("").filter((p) => p.kind === "مورد");
    return `${pageHeader("الموارد والمسارات", "موارد يشاركها المطورون فعلياً مع المجتمع.", '<button class="btn primary" data-page="compose" data-kind="resource">' + icon("plus") + " أضف مورداً</button>")}${arr.length ? arr.map(postCard).join("") : postsExhausted ? '<section class="panel empty-state"><b>لا توجد موارد منشورة بعد</b><p>انشر أول مورد أو مسار تعليمي للمجتمع.</p></section>' : ""}${feedSentinel()}`;
  }

  function renderNotifications() {
    const notes = Store.notices();
    const empty = language === "en" ? "You have no notifications yet." : "لم تصلك إشعارات بعد.";
    return `${pageHeader(language === "en" ? "Notifications" : "إشعاراتي", language === "en" ? "New activity and messages from the community." : "تابع التفاعلات والرسائل الجديدة في مجتمعك.", '<button class="btn" data-action="read-all">' + (language === "en" ? "Mark all read" : "تحديد الكل كمقروء") + '</button>')}<section class="panel">${notes.length ? notes.map((n) => `<div class="notice-item" role="button" tabindex="0" data-action="notification-click" data-id="${esc(n.id || "")}" style="${n.read ? "opacity:.68" : ""}"><span class="notice-icon">${icon(n.type === "heart" || n.type === "like" ? "heart" : n.type === "comment" || n.type === "message" ? "comment" : String(n.type || "").startsWith("follow") ? "user" : "bell")}</span><div><p>${esc(n.text)}</p><small>${timeAgo(n.time)} ${n.read ? "" : "· جديد"}</small></div></div>`).join("") : `<div class="empty-state">${empty}</div>`}</section>`;
  }

  function chatDayLabel(ms) {
    const d = new Date(ms), now = new Date(), en = language === "en";
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return en ? "Today" : "اليوم";
    if (diff === 1) return en ? "Yesterday" : "أمس";
    return d.toLocaleDateString(en ? "en" : "ar-u-nu-latn", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  const chatClock = (ms) => new Date(ms).toLocaleTimeString(language === "en" ? "en" : "ar-u-nu-latn", { hour: "2-digit", minute: "2-digit" });

  function renderMessages() {
    const user = currentUser();
    if (!user)
      return `${pageHeader("الرسائل", "سجّل الدخول للتواصل مع أعضاء المجتمع.", "")}<div class="panel empty-state"><b>المحادثات خاصة بأصحاب الحسابات</b><button class="btn primary" data-auth="login">تسجيل الدخول</button></div>`;
    const people = connectionUids().map((id) => publicProfiles[id]).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
    const chat = people.find((x) => x.uid === activeConversation) || people[0] || null;
    const requests = Object.entries(incomingFollowReqs || {})
      .filter(([uid]) => uid !== user.uid)
      .map(([uid, r]) => ({ uid, ...(publicProfiles[uid] || {}), name: publicProfiles[uid]?.name || r?.name || "عضو" }));
    const reqHtml = requests.length
      ? `<div class="msg-requests"><div class="msg-section-title">طلبات المتابعة <span class="msg-count">${requests.length}</span></div>${requests
          .map(
            (r) =>
              `<div class="msg-request"><button type="button" class="msg-req-user" data-action="open-profile" data-uid="${esc(r.uid)}"><span class="avatar small">${avatarContent(r)}</span><span><strong>${esc(r.name)}</strong><small>@${esc(r.handle || "member")}</small></span></button><div class="msg-req-actions"><button type="button" class="btn small primary" data-action="accept-follow" data-uid="${esc(r.uid)}">قبول المتابعة</button><button type="button" class="btn small ghost" data-action="decline-follow" data-uid="${esc(r.uid)}">رفض المتابعة</button></div></div>`,
          )
          .join("")}</div>`
      : "";
    const list = people.length
      ? people
          .map(
            (c) =>
              `<button type="button" class="msg-item${chat && c.uid === chat.uid ? " active" : ""}" data-action="conversation" data-id="${esc(c.uid)}" data-search="${esc(`${c.name || ""} ${c.handle || ""}`.toLowerCase())}"><span class="avatar small teal">${avatarContent(c)}</span><span class="msg-item-text"><strong>${esc(c.name || "مطور")}${isAdminUid(c.uid) ? ADMIN_BADGE : ""}</strong><small>@${esc(c.handle || "member")}</small></span></button>`,
          )
          .join("")
      : "";
    const side = `<aside class="msg-side"><div class="msg-side-head"><h3>المحادثات</h3>${people.length > 4 ? '<input class="field msg-search" id="msgSearch" type="search" placeholder="ابحث في المحادثات…" autocomplete="off">' : ""}</div>${reqHtml}<div class="msg-list">${list || (requests.length ? "" : '<div class="msg-empty-list">لا توجد محادثات بعد</div>')}</div></aside>`;
    let main;
    if (!chat) {
      main = `<section class="msg-chat msg-chat-empty"><div class="msg-empty"><span class="msg-empty-ic">${icon("comment")}</span><b>ابدأ بمتابعة الأعضاء</b><p>تظهر المحادثة هنا بعد أن يقبل العضو طلب متابعتك. افتح ملف أي عضو واضغط «متابعة العضو».</p></div></section>`;
    } else {
      const messages = chat.uid === activeConversation ? activeMessages : [];
      let lastDay = "", rows = "";
      for (const m of messages) {
        const label = chatDayLabel(m.createdAt || Date.now());
        if (label !== lastDay) { rows += `<div class="msg-day"><span>${esc(label)}</span></div>`; lastDay = label; }
        rows += `<div class="msg-row${m.uid === user.uid ? " own" : ""}"><div class="msg-bubble">${esc(m.text)}<time>${esc(chatClock(m.createdAt || Date.now()))}</time></div></div>`;
      }
      main = `<section class="msg-chat"><header class="msg-chat-head"><button type="button" class="msg-back" data-action="chat-back" aria-label="رجوع إلى المحادثات">${icon("arrow")}</button><span class="avatar small blue">${avatarContent(chat)}</span><div class="msg-chat-who"><strong>${profileLink(chat.uid, chat.name || "مطور")}</strong><small dir="ltr">@${esc(chat.handle || "member")}</small></div><button type="button" class="btn small ghost" data-action="open-profile" data-uid="${esc(chat.uid)}">الملف الشخصي</button></header><div class="msg-body" id="chatBody">${rows || '<div class="msg-hello">ابدأ المحادثة برسالة ترحيب 👋</div>'}</div><form class="msg-form" id="chatForm" data-to="${esc(chat.uid)}"><input class="field" id="chatInput" maxlength="1000" placeholder="اكتب رسالة..." autocomplete="off" required><button class="msg-send" type="submit" aria-label="إرسال">${icon("arrow")}</button></form></section>`;
    }
    return `${pageHeader("الرسائل", "محادثات مباشرة بين الأعضاء المتابِعين لبعضهم.", "")}<section class="panel msg-shell" data-mobile="${chat && mobileChat ? "chat" : "list"}">${side}${main}</section>`;
  }

  function renderSaved() {
    ensureSavedLoaded();
    const ids = Store.saved();
    const arr = Store.posts().filter((p) => ids.includes(p.id));
    return `${pageHeader("المحفوظات", "المنشورات والمقالات التي حفظتها للرجوع إليها.", "")} ${arr.length ? arr.map(postCard).join("") : '<div class="panel empty-state"><b>لم تحفظ أي منشور بعد</b>اضغط على زر الحفظ في أي منشور لإضافته هنا.</div>'}`;
  }

  function profileProjectCard(p) {
    return `<article class="panel profile-project-card"><span class="pill">${esc((p.tags || [])[0] || "مشروع")}</span><h3>${esc(p.title || "مشروع بدون عنوان")}</h3><p>${esc(p.text)}</p>${p.code ? codeWindow(p.code, p.codeLanguage, p.fileName, p.id) : ""}<div class="metric-row"><span>${icon("heart")} ${Number(p.likes || 0)} إعجاب</span><span>${timeAgo(p.createdAt || Date.now())}</span></div></article>`;
  }

  function renderProfile() {
    const own = currentUser(),
      user =
        viewedProfileUid && viewedProfileUid !== own?.uid ? publicProfiles[viewedProfileUid] : own;
    if (!user)
      return `${pageHeader("الملف الشخصي", "تعذر العثور على الملف المطلوب.", "")}<section class="panel empty-state"><b>هذا الملف غير متاح</b><button class="btn" data-page="home">العودة للرئيسية</button></section>`;
    syncExtraWatchers([["data/uid", user.uid]]);
    const mine = [...Store.posts(), ...Object.values(privateGroupPosts || {}).flat()].filter(
      (p, i, a) =>
        p.uid === user.uid &&
        Number.isFinite(Number(p.createdAt)) &&
        Number(p.createdAt) > 0 &&
        a.findIndex((x) => x.id === p.id) === i,
    );
    const projects = mine.filter((p) => p.kind === "مشروع");
    const articles = mine.filter((p) => p.kind === "مقالة");
    const isOwn = own?.uid === user.uid;
    if (isOwn && profileTab === "saved") ensureSavedLoaded();
    const savedPosts = [...Store.posts(), ...Object.values(privateGroupPosts || {}).flat()].filter(
      (p, i, a) => Store.saved().includes(p.id) && a.findIndex((x) => x.id === p.id) === i,
    );
    const joined =
      Number.isFinite(Number(user.joinedAt)) && Number(user.joinedAt) > 0
        ? new Date(Number(user.joinedAt)).toLocaleDateString("ar", {
            year: "numeric",
            month: "long",
          })
        : "";
    let content;
    if (isOwn && profileTab === "saved")
      content = savedPosts.length
        ? savedPosts.map(postCard).join("")
        : '<div class="panel empty-state"><b>لا توجد منشورات محفوظة بعد</b><p>استخدم زر الحفظ على أي منشور للرجوع إليه لاحقًا.</p></div>';
    else if (profileTab === "projects")
      content = projects.length
        ? `<div class="profile-project-grid">${projects.map(profileProjectCard).join("")}</div>`
        : `<div class="panel empty-state"><b>لا توجد مشاريع منشورة بعد</b>${own?.uid === user.uid ? '<button class="btn primary" data-page="compose" data-kind="project">أضف مشروعاً</button>' : ""}</div>`;
    else if (profileTab === "articles")
      content = articles.length
        ? articles.map(postCard).join("")
        : `<div class="panel empty-state"><b>لا توجد مقالات بعد</b>${own?.uid === user.uid ? '<button class="btn" data-page="compose" data-kind="article">اكتب مقالتك الأولى</button>' : ""}</div>`;
    else {
      const posts = mine.filter((p) => p.kind !== "مشروع" && p.kind !== "مقالة");
      content = posts.length
        ? posts.map(postCard).join("")
        : `<div class="panel empty-state"><b>لا توجد منشورات بعد</b>${own?.uid === user.uid ? '<button class="btn" data-page="compose">ابدأ أول مشاركة</button>' : ""}</div>`;
    }
    return `<section class="panel profile-cover"><div class="profile-cover-content"><div class="profile-avatar-wrap"><span class="avatar blue profile-avatar">${avatarContent(user)}</span>${isOwn ? '<label for="profileAvatar" class="avatar-edit" title="تغيير صورة الملف">✎</label><input id="profileAvatar" type="file" accept="image/png,image/jpeg,image/webp" hidden>' : ""}</div><div class="profile-details"><span class="pill${isAdminUid(user.uid) ? " admin-pill" : ""}">${isAdminUid(user.uid) ? "أدمن الموقع" : "مطور في مجتمع Codeex"}</span><h1>${esc(user.name || "مطور")}</h1><div class="profile-handle">@${esc(user.handle || "developer")}</div><p class="profile-bio">${esc(user.bio || "لم يضف نبذة شخصية بعد.")}</p><div class="profile-meta">${joined ? `<span>${icon("calendar")} عضو منذ ${joined}</span>` : ""}</div></div>${isOwn ? `<button class="btn profile-cover-action" data-page="settings">${icon("settings")} تعديل الملف</button>` : `${profileFollowActions(user)}`}</div></section><section class="panel profile-summary"><div class="profile-stat"><b>${projects.length}</b><span>مشروع</span></div><div class="profile-stat"><b>${mine.length}</b><span>مساهمة</span></div><div class="profile-stat"><b>${articles.length}</b><span>مقالة</span></div></section><div class="profile-tabs"><button class="profile-tab ${profileTab === "projects" ? "active" : ""}" data-action="profile-tab" data-tab="projects">${icon("project")} المشاريع (${projects.length})</button><button class="profile-tab ${profileTab === "posts" ? "active" : ""}" data-action="profile-tab" data-tab="posts">${icon("file")} المنشورات</button><button class="profile-tab ${profileTab === "articles" ? "active" : ""}" data-action="profile-tab" data-tab="articles">${icon("article")} المقالات (${articles.length})</button>${isOwn ? `<button class="profile-tab ${profileTab === "saved" ? "active" : ""}" data-action="profile-tab" data-tab="saved">${icon("bookmark")} المحفوظات (${savedPosts.length})</button>` : ""}</div><div id="profileContent">${content}</div>`;
  }

  function renderSettings() {
    const user = currentUser();
    const verified = !!auth.currentUser?.emailVerified;
    return `${pageHeader("الإعدادات", "تحكم في الملف الشخصي والأمان.", "")}<section class="panel"><div class="panel-head"><h3>المعلومات الشخصية</h3></div><div class="profile-edit-image"><span class="avatar blue" style="width:56px;height:56px">${avatarContent(user)}</span><div><strong style="font-size:13px">صورة الملف الشخصي</strong><div class="profile-photo-help">اختر صورة PNG أو JPG أو WebP.</div></div><label class="btn small" for="settingsAvatar" style="margin-inline-start:auto">تغيير الصورة</label><input id="settingsAvatar" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><form class="form-grid" id="profileForm"><label>الاسم الظاهر<input class="field" id="settingsName" value="${esc(user?.name || "")}" placeholder="اسمك" maxlength="50" required autocomplete="name"><small class="field-hint">بدون إيموجي.</small></label><label>اسم المستخدم<input class="field" id="settingsHandle" value="${esc(user?.handle || "")}" placeholder="username" maxlength="40" dir="ltr" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"><small class="field-hint">اسم مستخدم فريد: أحرف إنجليزية صغيرة وأرقام و _ و - فقط (3–40 خانة).</small></label><label>نبذة قصيرة<textarea class="field" id="settingsBio" maxlength="300" placeholder="عرّف المجتمع بنفسك...">${esc(user?.bio || "")}</textarea></label><button class="btn primary" type="submit" style="justify-self:start">حفظ التغييرات</button></form></section><section class="panel" style="margin-top:13px"><div class="panel-head"><h3>المظهر</h3></div><div class="setting-row"><span><strong>الوضع الحالي</strong><small>يتذكر Codeex اختيارك على هذا المتصفح.</small></span><button class="btn soft" id="themeSettingButton" data-action="toggle-theme">التبديل إلى الوضع الليلي</button></div></section><section class="panel" style="margin-top:13px"><div class="panel-head"><h3>الأمان والحساب</h3></div><div class="setting-row"><span><strong>حالة البريد الإلكتروني</strong><small>${verified ? "البريد الإلكتروني موثّق" : "البريد الإلكتروني غير موثّق"}</small></span>${!verified && user?.email ? '<button class="btn small" data-action="verify-email">إرسال رسالة توثيق</button>' : ""}</div><div class="setting-row"><span><strong>كلمة المرور</strong><small>أرسل رابطاً آمناً لإعادة تعيين كلمة المرور.</small></span><button class="btn small" data-action="reset-password">إعادة تعيين كلمة المرور</button></div><div class="setting-row"><span><strong>الجلسة الحالية</strong><small>إنهاء تسجيل الدخول على هذا الجهاز.</small></span><button class="btn small danger" data-auth="logout">تسجيل الخروج من هذا الجهاز</button></div><div class="notice-box">لا تشارك كلمة المرور أو رموز التحقق مع أي شخص، وسجّل الخروج دائماً من الأجهزة المشتركة.</div></section>`;
  }

  function clearSelectedCodeFile(clearCode = true) {
    const code = document.querySelector("#publishCode"), name = document.querySelector("#codeFilename"), input = document.querySelector("#codeFile");
    if (clearCode && code && selectedCodeFileText && code.value === selectedCodeFileText) code.value = "";
    if (name) name.value = "";
    if (input) input.value = "";
    selectedCodeFileBase64 = "";
    selectedCodeFileName = "";
    selectedCodeFileBytes = 0;
    selectedCodeFileText = "";
  }

  function updateComposePolicyUI() {
    const kindEl = document.querySelector("#publishKind");
    if (!kindEl) return;
    const kind = kindEl.value, article = kind === "مقالة", discussion = kind === "نقاش";
    const label = document.querySelector("#codeFileLabel"), input = document.querySelector("#codeFile"), hint = document.querySelector("#publishPolicyHint"), code = document.querySelector("#publishCode");
    if (editingPostId) kindEl.disabled = true;
    if (label) label.hidden = article;
    if (input) input.disabled = article;
    const cap = maxCodeBytes(kind);
    if (code) code.maxLength = cap;
    if (hint) hint.textContent = article
      ? (language === "en" ? "Articles: up to 1,000 words; file uploads are disabled." : "المقالة: حتى 1000 كلمة؛ رفع الملفات غير متاح.")
      : !isProjectResourceKind(kind)
        ? (language === "en" ? "Text and code together: up to 1 MB." : "مجموع النص والكود حتى 1 ميجابايت.")
        : (language === "en" ? `Project/resource code: up to 2 MB; one uploaded file every 7 days; 10 minutes between posts.` : "المشروع/المورد: كود حتى 2 ميجابايت، ملف واحد كل 7 أيام، وفاصل 10 دقائق بين المنشورات.");
    if (hint && isAdminUid(activeUser?.uid))
      hint.textContent += language === "en" ? " As the site admin you have no limit on how many posts you publish or when." : " بصفتك أدمن الموقع: لا توجد حدود على عدد منشوراتك أو على توقيت النشر.";
    if (article && selectedCodeFileBase64) clearSelectedCodeFile(true);
    else if (selectedCodeFileBytes > 0 && selectedCodeFileBytes > cap) clearSelectedCodeFile(true);
    syncMediaExclusivity();
  }

  function updatePublishVisibilityUI() {
    const group = document.querySelector("#publishGroup"),
      visibility = document.querySelector("#publishVisibility"),
      hint = document.querySelector("#publishVisibilityHint");
    if (!group || !visibility) return;
    const inGroup = !!group.value;
    if (inGroup && visibility.value === "public") visibility.value = "members";
    visibility.disabled = inGroup;
    if (hint) hint.textContent = inGroup
      ? "منشورات المجموعات تبقى داخل المجموعة؛ لا تُعرض دون تسجيل الدخول أو خارج صلاحياتها."
      : visibility.value === "public"
        ? "عام (سيظهر في كل محركات البحث ولا يتطلب تسجيل دخول). سيتم إنشاء رابط مستقل وصورة مشاركة."
        : "خاص بأعضاء Codeex المسجلين؛ لا يظهر في صفحات المشاركة العامة أو محركات البحث.";
  }
  function renderCompose() {
    const user = currentUser();
    if (!user)
      return `${pageHeader("المشاركة في Codeex", "سجّل الدخول أولاً لتتمكن من النشر.", "")}<div class="panel empty-state"><b>تحتاج إلى حساب للمشاركة</b><button class="btn primary" data-auth="register">إنشاء حساب</button></div>`;
    return `${pageHeader("إنشاء مشاركة", "شارك فكرة أو مقالة أو مشروعاً مع المطورين العرب.", "")}<section class="panel"><form class="form-grid" id="publishForm"><label>نوع المشاركة<select class="field" id="publishKind"><option>نقاش</option><option>مقالة</option><option>مورد</option><option>مشروع</option></select></label><label>مكان النشر<select class="field" id="publishGroup"><option value="">المجتمع العام — يظهر المنشور في الرئيسية</option>${groups
      .filter((g) => g.visibility === "public" || isGroupMember(g))
      .map((g) => `<option value="${esc(g.id)}">${esc(g.name)} — ${g.visibility === "private" ? "خاص" : "عام"}</option>`).join("")}</select></label><label>ظهور المنشور<select class="field" id="publishVisibility" aria-describedby="publishVisibilityHint"><option value="members">أعضاء Codeex فقط</option><option value="public">عام (سيظهر في كل محركات البحث ولا يتطلب تسجيل دخول)</option></select><small class="muted" id="publishVisibilityHint">خاص بأعضاء Codeex المسجلين؛ لا يظهر في صفحات المشاركة العامة أو محركات البحث.</small></label><label>العنوان (اختياري للنقاش)<input class="field" id="publishTitle" maxlength="140" placeholder="عنوان واضح ومفيد"></label><label>التفاصيل<textarea class="field" id="publishText" maxlength="307200" placeholder="اكتب ما تريد مشاركته..." required></textarea></label><div class="video-attach" id="videoAttach"><strong class="attach-title">فيديو (اختياري)</strong><div class="video-input-row"><input class="field" id="publishVideo" type="text" inputmode="url" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ألصق رابط الفيديو هنا"><button type="button" class="btn small ghost" id="videoClear" data-action="clear-video" hidden>إزالة الفيديو</button></div><div class="video-status" id="videoStatus" role="status" aria-live="polite"></div><div id="videoPreview"></div><small class="field-hint" id="videoLock" hidden></small><small class="field-hint">نتحقق من أن الفيديو يعمل قبل النشر، وإذا أضفت فيديو فلا يمكن إرفاق كود أو ملف معه.</small><input type="hidden" id="videoProvider"><input type="hidden" id="videoId"></div><div class="code-attach" id="codeAttach"><strong class="attach-title">مقطع كود (اختياري)</strong><div id="codeAttachBody"></div><input id="codeFile" type="file" accept=".js,.jsx,.ts,.tsx,.py,.html,.css,.json,.java,.php,.go,.rs,.c,.cpp,.cs,.sql,.sh,.txt" hidden><textarea id="publishCode" hidden maxlength="2097152"></textarea><input id="publishLanguage" type="hidden" value="javascript"><input id="codeFilename" type="hidden"><small class="muted" id="publishPolicyHint"></small></div><label>وسوم مفصولة بفاصلة<input class="field" id="publishTags" placeholder="React, JavaScript"></label><div class="modal-actions"><button class="btn" type="button" data-page="home">إلغاء</button><button class="btn primary" type="submit">نشر المشاركة</button></div></form></section>`;
  }

  const searchHit = (text) => !!searchTerm && String(text || "").toLowerCase().includes(searchTerm.toLowerCase());
  const groupOfPost = (p) => groups.find((g) => g.id === (p.privateGroupId || p.groupId));
  /* Searches every post the member can see: the community feed plus the private groups they belong to. */
  function searchPosts() {
    if (!searchTerm) return [];
    const seen = new Set();
    return [...Store.posts(), ...Object.values(privateGroupPosts || {}).flat()]
      .filter((p) => {
        if (!p || seen.has(p.id)) return false;
        seen.add(p.id);
        return searchHit(`${p.name} ${p.title || ""} ${p.text} ${(p.tags || []).join(" ")} ${groupOfPost(p)?.name || ""}`);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderSearch() {
    const arr = searchPosts();
    const joined = groups.filter((g) => isGroupMember(g) && searchHit(`${g.name} ${g.description || ""}`));
    const groupHtml = joined.length
      ? `<h3 class="search-section">مجموعاتك المطابقة (${joined.length})</h3><div class="search-group-list">${joined
          .map(
            (g) =>
              `<article class="panel search-group"><div class="search-group-info"><strong>${esc(g.name)}</strong><span class="group-visibility ${esc(g.visibility)}">${g.visibility === "private" ? icon("lock") + " خاصة" : "عامّة"}</span><p>${esc(g.description || "مجموعة أنشأها عضو في المجتمع.")}</p></div><button type="button" class="btn small primary" data-action="group-open" data-id="${esc(g.id)}">دخول المجموعة</button></article>`,
          )
          .join("")}</div>`
      : "";
    const postsHtml = arr.length
      ? `<h3 class="search-section">المنشورات المطابقة (${arr.length})</h3>${arr.map(postCard).join("")}`
      : joined.length
        ? ""
        : '<div class="panel empty-state"><b>لم نجد نتائج</b>جرّب كلمات بحث مختلفة.</div>';
    return `${pageHeader(`نتائج البحث: ${esc(searchTerm)}`, "المنشورات والمجموعات المطابقة، بما فيها مجموعاتك العامة والخاصة.", "")} ${groupHtml}${postsHtml}`;
  }

  function renderPage() {
    const view = document.querySelector("#pageView");
    if (!currentUser()) {
      renderVisitor();
      return;
    }
    if (!PUBLIC_PAGES.has(page)) setPublicMetadata("مجتمع المطورين العرب", "مجتمع عربي للمطورين لمشاركة الأفكار والمشاريع البرمجية.");
    const wantExtras = page === "profile" || page === "group-detail" || page === "saved";
    if (!wantExtras && extraWatches.size) syncExtraWatchers([]);
    if (wantExtras !== extrasApplied) {
      extrasApplied = wantExtras;
      normalizePosts(lastWindowRaw, true);
    }
    let html;
    if (PUBLIC_PAGES.has(page)) html = renderPublicPage(page);
    else if (page === "home") html = feed();
    else if (page === "articles") html = renderArticles();
    else if (page === "groups") html = renderGroups();
    else if (page === "group-detail") html = renderGroupDetail();
    else if (page === "projects") html = renderProjects();
    else if (page === "resources") html = renderResources();
    else if (page === "notifications") html = renderNotifications();
    else if (page === "messages") html = renderMessages();
    else if (page === "saved") html = renderSaved();
    else if (page === "profile") html = renderProfile();
    else if (page === "settings") html = renderSettings();
    else if (page === "compose") html = renderCompose();
    else if (page === "search") html = renderSearch();
    else html = feed();
    const markup = localizeMarkup(html);
    const samePage = lastRenderedPage === page;
    lastRenderedPage = page;
    if (samePage && view.querySelector(".video-card iframe[data-vid]")) morphInto(view, markup);
    else view.innerHTML = markup;
    if (page === "messages") {
      const body = document.querySelector("#chatBody");
      if (body) body.scrollTop = body.scrollHeight;
    }
    setupFeedObserver();
    if (page === "compose") updateComposePolicyUI();
  }

  function navigate(id) {
    if (!currentUser() && !PUBLIC_PAGES.has(id) && id !== "home") {
      authForm("login");
      return;
    }
    page = id;
    if (id === "search") ensurePostWindow(300);
    if (id === "groups" && database)
      database
        .ref("groups")
        .once("value")
        .then((s) => replaceGroups(s.val()))
        .catch(handleError);
    renderFrame();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function authForm(mode) {
    const isRegister = mode === "register";
    openModal(
      isRegister ? "إنشاء حساب في Codeex" : "تسجيل الدخول",
      `<div class="form-grid" style="padding:0"><div class="auth-social"><button type="button" class="btn" data-auth="google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.54c2.07-1.91 3.25-4.72 3.25-8.09Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.54-2.75c-.98.66-2.24 1.05-3.74 1.05-2.87 0-5.3-1.94-6.17-4.54H2.17v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.83 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.17a11 11 0 0 0 0 9.88l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.36c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.17 7.06l3.66 2.84C6.7 7.3 9.13 5.36 12 5.36Z"/></svg>المتابعة باستخدام Google</button><button type="button" class="btn" data-auth="github"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a10.9 10.9 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>المتابعة باستخدام GitHub</button></div><div class="divider"></div><form id="authForm" class="form-grid" style="padding:0">${isRegister ? '<label>الاسم الظاهر<input class="field" id="authName" required minlength="2" maxlength="50"></label>' : ""}<label>البريد الإلكتروني<input class="field" id="authEmail" type="email" required autocomplete="email"></label><label>كلمة المرور<input class="field" id="authPassword" type="password" required minlength="8" autocomplete="${isRegister ? "new-password" : "current-password"}"></label><p class="muted" style="font-size:11px;margin:0">سنرسل رابط التفعيل إلى بريدك الإلكتروني بعد إنشاء الحساب.</p><div id="authInfo" role="status" style="color:var(--green);font-size:12px"></div><div id="authError" style="color:var(--red);font-size:12px">${auth ? "" : "الخدمة غير متاحة بعد؛ سنحاول الاتصال تلقائياً."}</div>${isRegister ? "" : '<button type="button" class="btn ghost" data-action="reset-password">نسيت كلمة المرور؟ أرسل رابط إعادة التعيين</button><button type="button" class="btn ghost hidden" id="resendBtn" data-action="resend-verification">إعادة إرسال رسالة التفعيل</button>'}<button class="btn primary" type="submit">${isRegister ? "إنشاء الحساب" : "دخول"}</button><button type="button" class="btn ghost" data-auth="${isRegister ? "login" : "register"}">${isRegister ? "لديك حساب؟ سجّل الدخول" : "مستخدم جديد؟ أنشئ حساباً"}</button></form></div>`,
    );
    document.querySelector("#modalBackdrop .modal")?.classList.add("auth-modal");
  }

  function requireUser() {
    if (!currentUser()) {
      authForm("login");
      return false;
    }
    return true;
  }

  async function savePost(p) {
    const g = p.groupId ? groups.find((x) => x.id === p.groupId) : null;
    if (g?.visibility === "private") {
      const prior = privateGroupPosts[g.id] || [];
      privateGroupPosts[g.id] = [p, ...prior.filter((x) => x.id !== p.id)];
      try {
        await publishPost(p);
        return true;
      } catch (e) {
        privateGroupPosts[g.id] = prior;
        handleError(e);
        return false;
      }
    }
    const prior = cloudPosts;
    cloudPosts = [p, ...cloudPosts.filter((x) => x.id !== p.id)];
    try {
      await publishPost(p);
      return true;
    } catch (e) {
      cloudPosts = prior;
      handleError(e);
      return false;
    }
  }

  /* ==========================================================================
   Event handlers
   ========================================================================== */
  document.addEventListener("click", async (e) => {
    const pageEl = e.target.closest("[data-page]");
    if (pageEl) {
      const id = pageEl.dataset.page;
      if (id === "login" || id === "register") {
        authForm(id);
        return;
      }
      if (!currentUser() && !PUBLIC_PAGES.has(id) && id !== "home") {
        authForm("login");
        return;
      }
      if (id === "profile") viewedProfileUid = "";
      if (id === "compose" && !editingPostId) clearSelectedCodeFile(false);
      if (id === "compose" && pageEl.dataset.kind) pendingKind = pageEl.dataset.kind;
      if (id === "compose" && pageEl.dataset.groupId) pendingGroupId = pageEl.dataset.groupId;
      navigate(id);
      if (id === "compose" && pendingGroupId) {
        const groupSelect = document.querySelector("#publishGroup");
        if (groupSelect) {
          groupSelect.value = pendingGroupId;
          updatePublishVisibilityUI();
        }
        pendingGroupId = "";
      }
      if (id === "compose" && pendingKind) {
        const sel = document.querySelector("#publishKind");
        if (sel)
          sel.value =
            pendingKind === "project"
              ? "مشروع"
              : pendingKind === "article"
                ? "مقالة"
                : pendingKind === "resource"
                  ? "مورد"
                  : "نقاش";
        pendingKind = "";
      }
      return;
    }
    const authEl = e.target.closest("[data-auth]");
    if (authEl) {
      if (authEl.dataset.auth === "logout") {
        firebase.auth().signOut().catch(handleError);
      } else if (authEl.dataset.auth === "google") signInGoogle();
      else if (authEl.dataset.auth === "github") signInGithub();
      else authForm(authEl.dataset.auth);
      return;
    }
    if (e.target.closest("[data-close-modal]")) {
      closeModal();
      return;
    }
    const act = e.target.closest("[data-action]");
    if (!act) return;
    const action = act.dataset.action;
    if (action === "play-video") { playVideo(act); return; }
    if (action === "open-code-studio") { openCodeStudio(); return; }
    if (action === "remove-code") { removeCode(); return; }
    if (action === "clear-video") { clearVideoField(); return; }
    if (action === "toggle-post-text") {
      const card = act.closest("[data-post]");
      const text = card?.querySelector(".post-text");
      if (!text) return;
      const expanded = text.classList.toggle("collapsed") === false;
      act.setAttribute("aria-expanded", String(expanded));
      act.textContent = expanded ? "عرض أقل" : "عرض المزيد";
      return;
    }
    if (action === "toggle-theme") {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      toast(
        document.documentElement.dataset.theme === "dark"
          ? "تم تفعيل الوضع الليلي"
          : "تم تفعيل الوضع الفاتح",
      );
      return;
    }
    if (action === "resend-verification") {
      const email = document.querySelector("#authEmail")?.value.trim().toLowerCase(),
        password = document.querySelector("#authPassword")?.value;
      if (!email || !password) {
        toast("أدخل البريد وكلمة المرور أولاً.");
        return;
      }
      authBusy = true;
      try {
        const s = await auth.signInWithEmailAndPassword(email, password);
        if (!s.user.emailVerified) {
          try {
            await s.user.sendEmailVerification(verifyActionSettings());
          } catch {
            await s.user.sendEmailVerification();
          }
          await auth.signOut();
          setAuthInfo("أُعيد إرسال رسالة التفعيل. تحقق من بريدك.");
        }
      } catch (err) {
        handleError(err);
      } finally {
        authBusy = false;
      }
      return;
    }
    if (action === "verify-email") {
      if (auth.currentUser && !auth.currentUser.emailVerified)
        auth.currentUser
          .sendEmailVerification(verifyActionSettings())
          .then(() => toast("أُرسلت رسالة التوثيق إلى بريدك."))
          .catch(handleError);
      return;
    }
    if (action === "reset-password") {
      const email =
        auth.currentUser?.email || document.querySelector("#authEmail")?.value.trim().toLowerCase();
      if (!email) {
        toast("أدخل بريدك الإلكتروني أولاً.");
        return;
      }
      auth
        .sendPasswordResetEmail(email)
        .then(() => toast("أُرسل رابط إعادة تعيين كلمة المرور."))
        .catch(handleError);
      return;
    }
    if (action === "open-profile") {
      const uid = act.dataset.uid;
      if (!uid || !publicProfiles[uid]) {
        toast("بيانات الملف الشخصي غير متاحة حالياً.");
        return;
      }
      closeModal();
      viewedProfileUid = uid;
      profileTab = "projects";
      navigate("profile");
      return;
    }
    if (action === "message-user") {
      if (!requireUser()) return;
      const uid = act.dataset.uid;
      if (!uid || uid === currentUser().uid || !publicProfiles[uid]) {
        toast("تعذّر فتح المحادثة مع هذا العضو.");
        return;
      }
      if (!canMessage(uid)) {
        toast("تظهر المراسلة بعد أن يقبل العضو طلب متابعتك.");
        return;
      }
      mobileChat = true;
      closeModal();
      subscribeConversation(uid);
      navigate("messages");
      return;
    }
    if (action === "load-more") {
      loadMorePosts();
      return;
    }
    if (action === "profile-tab") {
      profileTab = act.dataset.tab;
      renderPage();
      return;
    }
    if (action === "filter") {
      feedFilter = act.dataset.filter;
      renderPage();
      return;
    }
    if (action === "tag") {
      searchTerm = act.dataset.tag;
      document.querySelector("#searchInput").value = searchTerm;
      navigate("search");
      return;
    }
    if (action === "join") {
      if (!requireUser()) return;
      const g = groups.find((x) => x.id === act.dataset.id);
      if (!g) return;
      if (needsApproval(g)) {
        if (isGroupMember(g) || groupPendingStatus[g.id]) return;
        database
          .ref(`groupRequests/${g.id}/${activeUser.uid}`)
          .set({ uid: activeUser.uid, name: activeUser.name || "عضو", requestedAt: Date.now() })
          .then(() => {
            groupPendingStatus[g.id] = true;
            renderFrame();
            toast("أُرسل طلبك إلى مشرف المجموعة");
          })
          .catch(handleError);
        return;
      }
      database
        .ref(`groupKicked/${g.id}/${activeUser.uid}`)
        .once("value")
        .then((kicked) => {
          if (kicked.val() === true) throw new AppError("تم إبعادك من هذه المجموعة ولا يمكنك الانضمام إليها مجدداً.");
          return database.ref(`groupMembers/${g.id}/${activeUser.uid}`).set(true);
        })
        .then(() => {
          groupMembershipOverrides[g.id] = true;
          groupMembersMap[g.id] = groupMembersMap[g.id] || {};
          groupMembersMap[g.id][activeUser.uid] = true;
          joinedIds = remoteGroups.filter((x) => isGroupMember(x)).map((x) => x.id);
          syncGroupWatchers();
          renderFrame();
          toast("انضممت إلى المجموعة");
        })
        .catch((err) => {
          delete groupMembershipOverrides[g.id];
          if (groupMembersMap[g.id]) {
            delete groupMembersMap[g.id][activeUser.uid];
            if (!Object.keys(groupMembersMap[g.id]).length) delete groupMembersMap[g.id];
          }
          joinedIds = remoteGroups.filter((x) => isGroupMember(x)).map((x) => x.id);
          renderFrame();
          handleError(err);
        });
      return;
    }
    if (action === "leave-group") {
      if (!requireUser()) return;
      const g = groups.find((x) => x.id === act.dataset.id);
      if (!g || g.ownerUid === activeUser.uid) return;
      database
        .ref(`groupMembers/${g.id}/${activeUser.uid}`)
        .remove()
        .then(() => {
          groupMembershipOverrides[g.id] = false;
          joinedIds = Store.joined().filter((id) => id !== g.id);
          if (groupMembersMap[g.id]) delete groupMembersMap[g.id][activeUser.uid];
          syncGroupWatchers();
          if (selectedGroupId === g.id) {
            stopPrivateGroupWatchers();
            navigate("groups");
          } else renderFrame();
          toast("غادرت المجموعة");
        })
        .catch(handleError);
      return;
    }
    if (action === "approve-group" || action === "reject-group") {
      if (!requireUser()) return;
      const g = groups.find((x) => x.id === act.dataset.group);
      if (!g || g.ownerUid !== activeUser.uid) return;
      const reqUid = act.dataset.user,
        reqRef = database.ref(`groupRequests/${g.id}/${reqUid}`);
      if (action === "approve-group") {
        database
          .ref(`groupMembers/${g.id}/${reqUid}`)
          .set(true)
          .then(() => reqRef.remove())
          .then(() => toast("قُبل طلب الانضمام"))
          .catch(handleError);
      } else
        reqRef
          .remove()
          .then(() => toast("رُفض الطلب"))
          .catch(handleError);
      return;
    }
    if (action === "group-members") { openGroupMembers(act.dataset.id); return; }
    if (["promote-admin", "demote-admin", "kick-member", "unkick-member"].includes(action)) {
      groupMemberAction(action, act.dataset.group, act.dataset.user);
      return;
    }
    if (action === "group-open") {
      if (!requireUser()) return;
      const g = groups.find((x) => x.id === act.dataset.id);
      if (!g) return;
      if (!isGroupMember(g)) {
        toast("انضم إلى المجموعة أولاً");
        return;
      }
      selectedGroupId = g.id;
      if (g.visibility === "private") subscribePrivateGroup(g);
      navigate("group-detail");
      return;
    }
    if (action === "like") {
      if (!requireUser()) return;
      if (!allowAction("like", 400, true)) return;
      const p = findPost(act.dataset.id);
      if (!p) return;
      const who = currentUser().uid;
      if (!p.privateGroupId && !remoteRawPosts[p.id]?.data) {
        toast("تعذّر التفاعل مع هذا المنشور حالياً.");
        return;
      }
      const was = (p.likedBy || []).includes(who);
      database
        .ref(`${postRootPath(p)}/reactions/${who}`)
        .set(was ? null : true)
        .then(() => {
          if (!was && p.uid !== who)
            addNotification(p.uid, {
              postId: p.id,
              type: "like",
              text: `أعجب ${currentUser().name} بمنشورك.`,
            }).catch(handleError);
        })
        .catch(handleError);
      p.likedBy = p.likedBy || [];
      was ? (p.likedBy = p.likedBy.filter((x) => x !== who)) : p.likedBy.push(who);
      p.likes = p.likedBy.length;
      renderPage();
      return;
    }
    if (action === "save") {
      if (!requireUser()) return;
      const p = findPost(act.dataset.id);
      if (!p) return;
      let ids = Store.saved();
      const i = ids.indexOf(p.id);
      i >= 0 ? ids.splice(i, 1) : ids.push(p.id);
      Store.setSaved(ids);
      renderPage();
      toast(i >= 0 ? "أزل من المحفوظات" : "أضيف إلى المحفوظات");
      return;
    }
    if (action === "more-comments") {
      const p = findPost(act.dataset.id);
      const list = document.querySelector("#modalBackdrop .comments-list");
      if (!p || !list) return;
      commentsLimit += COMMENT_PAGE;
      list.innerHTML = localizeMarkup(commentsListHtml(p, commentsLimit));
      return;
    }
    if (action === "comment") {
      if (!requireUser()) return;
      const p = findPost(act.dataset.id);
      if (!p) return;
      commentsLimit = COMMENT_PAGE;
      openModal("التعليقات", `<div class="comments-list" aria-live="polite">${commentsListHtml(p, commentsLimit)}</div>${commentComposerHtml(p)}`);
      document.querySelector("#modalBackdrop .modal").classList.add("comments-modal");
      return;
    }
    if (action === "expand" || action === "read-post") {
      const p = findPost(act.dataset.id);
      if (!p) return;
      openModal(
        p.title || "تفاصيل المشاركة",
        `<div class="post-header"><span class="avatar ${esc(p.tone || "blue")}"${p.uid ? ` data-action="open-profile" data-uid="${esc(p.uid)}"` : ""}>${avatarContent({ ...p, ...(publicProfiles[p.uid] || {}) })}</span><div class="post-ident"><strong>${profileLink(p.uid, personName(p))}</strong><div class="post-meta">${timeAgo(p.createdAt)}</div></div></div><p class="post-text">${renderPostTextWithLinks(p.text)}</p>${videoBlock(p)}${p.code ? codeWindow(p.code, p.codeLanguage, p.fileName, p.id) : ""}<div class="post-tags">${(p.tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join("")}</div><div class="divider"></div><p class="muted">${(p.comments || []).length} تعليق · ${p.likes || 0} إعجاب</p>`,
      );
      return;
    }
    if (action === "edit-post") {
      closeModal();
      const p = findPost(act.dataset.id);
      if (!p || p.uid !== currentUser()?.uid) return;
      editingPostId = p.id;
      page = "compose";
      renderFrame();
      setTimeout(() => {
        const v = (id, val) => {
          const el = document.querySelector(id);
          if (el) el.value = val || "";
        };
        v(
          "#publishKind",
          p.kind === "مشروع"
            ? "مشروع"
            : p.kind === "مقالة"
              ? "مقالة"
              : p.kind === "مورد"
                ? "مورد"
                : "نقاش",
        );
        v("#publishGroup", p.groupId);
        v("#publishVisibility", p.isPublic === true ? "public" : "members");
        updatePublishVisibilityUI();
        v("#publishTitle", p.title);
        v("#publishText", p.text);
        v("#publishLanguage", p.codeLanguage);
        v("#publishCode", p.code);
        v("#codeFilename", p.fileName);
        v("#publishTags", (p.tags || []).join(", "));
        prefillVideoFields(p);
        refreshCodeAttach();
        syncMediaExclusivity();
        const submit = document.querySelector("#publishForm button[type=submit]");
        if (submit) submit.textContent = "حفظ التعديلات";
      }, 0);
      return;
    }
    if (action === "copy-code") {
      const post = findPost(act.dataset.id);
      if (!post?.code) return;
      try {
        await navigator.clipboard.writeText(post.code);
        toast("تم نسخ الكود");
      } catch {
        const area = document.createElement("textarea");
        area.value = post.code;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        toast("تم نسخ الكود");
      }
      return;
    }
    if (action === "share") {
      const post = findPost(act.dataset.id);
      const shareUrl = post?.isPublic === true
        ? new URL(`/post/${encodeURIComponent(post.id)}`, location.origin)
        : new URL("/", location.origin);
      if (post?.isPublic !== true) {
        shareUrl.searchParams.set("post", act.dataset.id);
        if (post?.privateGroupId) shareUrl.searchParams.set("group", post.privateGroupId);
      }
      const u = shareUrl.toString();
      if (navigator.clipboard)
        navigator.clipboard
          .writeText(u)
          .then(() => toast("تم نسخ رابط المشاركة"))
          .catch(() => toast("انسخ رابط الصفحة للمشاركة"));
      else toast("تم تجهيز رابط المشاركة");
      return;
    }
    if (action === "post-menu") {
      openModal(
        "خيارات المنشور",
        `<div class="form-grid" style="padding:0"><button class="btn" data-action="save" data-id="${esc(act.dataset.id)}">${icon("bookmark")} حفظ المنشور</button>${findPost(act.dataset.id)?.uid === currentUser()?.uid ? `<button class="btn" data-action="edit-post" data-id="${esc(act.dataset.id)}">${icon("file")} تعديل المنشور</button>` : ""}<button class="btn danger" data-action="report" data-id="${esc(act.dataset.id)}">الإبلاغ عن المنشور</button></div>`,
      );
      return;
    }
    if (action === "report") {
      if (!requireUser()) return;
      const postId = act.dataset.id;
      if (!allowAction("report", 10000)) return;
      database
        .ref("reports")
        .push({ reporterUid: currentUser().uid, postId, createdAt: Date.now() })
        .then(() => {
          closeModal();
          toast("تم إرسال البلاغ للمراجعة");
        })
        .catch(handleError);
      return;
    }
    if (action === "new-group") {
      if (!requireUser()) return;
      openModal(
        "إنشاء مجموعة",
        `<form id="groupForm" class="form-grid" style="padding:0"><label>اسم المجموعة<input class="field" id="groupName" required maxlength="60"></label><label>وصف مختصر<textarea class="field" id="groupDesc" maxlength="250"></textarea></label><label>نوع المجموعة<select class="field" id="groupVisibility"><option value="public">عامّة — الانضمام متاح للجميع والمنشورات تظهر في الرئيسية</option><option value="private">خاصة — المشرف يوافق على طلب الانضمام والمنشورات للأعضاء فقط</option></select></label><button class="btn primary" type="submit">إنشاء المجموعة</button></form>`,
      );
      return;
    }
    if (action === "notification-click") {
      if (!requireUser()) return;
      const note = Store.notices().find((x) => x.id === act.dataset.id);
      if (!note) return;
      if (!note.read) database.ref(`users/${activeUser.uid}/notifications/${note.id}`).update({ read: true, readAt: Date.now() }).catch(handleError);
      if (note.type === "message" && note.actorUid && publicProfiles[note.actorUid]) {
        mobileChat = true;
        subscribeConversation(note.actorUid);
        navigate("messages");
      } else if (note.type === "follow_request") {
        mobileChat = false;
        navigate("messages");
      } else if (note.type === "follow_accepted" && note.actorUid && publicProfiles[note.actorUid]) {
        viewedProfileUid = note.actorUid;
        profileTab = "projects";
        navigate("profile");
      }
      return;
    }
    if (action === "read-all") {
      if (!requireUser()) return;
      Store.setNotices(Store.notices().map((n) => (n.read ? n : { ...n, read: true, readAt: Date.now() })));
      renderPage();
      toast("تم تحديد الإشعارات كمقروءة");
      return;
    }
    if (action === "conversation") {
      mobileChat = true;
      subscribeConversation(act.dataset.id);
      renderPage();
      return;
    }
    if (action === "chat-back") {
      mobileChat = false;
      renderPage();
      return;
    }
    if (["follow", "cancel-follow", "unfollow", "accept-follow", "decline-follow", "remove-follower"].includes(action)) {
      if (!requireUser()) return;
      followAction(action, act.dataset.uid);
      return;
    }
    if (action === "resource") {
      toast("ستتوفر تفاصيل المسار قريباً.");
      return;
    }
    if (action === "support") {
      openModal(
        "ادعم Codeex",
        '<p class="muted">شكراً لاهتمامك بدعم المجتمع. خيارات الدعم ستتاح عند اكتمال إعداد المنصة.</p>',
      );
      return;
    }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id === "authForm") {
      e.preventDefault();
      if (!auth || !database) {
        handleError(new AppError("الخدمة غير جاهزة بعد؛ أعد المحاولة بعد قليل."));
        return;
      }
      const email = document.querySelector("#authEmail").value.trim().toLowerCase(),
        password = document.querySelector("#authPassword").value;
      authBusy = true;
      try {
        if (document.querySelector("#authName")) {
          const name = document.querySelector("#authName").value.trim();
          const nameProblem = validateName(name);
          if (nameProblem) throw new AppError(nameProblem);
          if (!isStrongPassword(password)) throw new AppError(ERROR_BY_CODE["auth/weak-password"]);
          const credential = await auth.createUserWithEmailAndPassword(email, password);
          try {
            await credential.user.updateProfile({ displayName: name });
            try {
              await credential.user.sendEmailVerification(verifyActionSettings());
            } catch {
              await credential.user.sendEmailVerification();
            }
          } finally {
            await auth.signOut();
          }
          showVerificationSent(email);
          return;
        }
        if (loginLockRemaining())
          throw new AppError("محاولات دخول كثيرة؛ انتظر قليلاً ثم أعد المحاولة.");
        const signed = await auth.signInWithEmailAndPassword(email, password);
        resetLoginGuard();
        if (signed.user.email && !signed.user.emailVerified) {
          await auth.signOut();
          showUnverified();
          return;
        }
        closeModal();
        renderFrame();
        toast("تم تسجيل الدخول بنجاح");
      } catch (err) {
        if (
          !document.querySelector("#authName") &&
          /credential|password|user-not-found/.test(err?.code || "")
        )
          recordLoginFailure();
        handleError(err);
      } finally {
        authBusy = false;
      }
    }
    if (e.target.id === "publishForm") {
      e.preventDefault();
      if (!requireUser()) return;
      const user = currentUser(),
        kind = document.querySelector("#publishKind").value,
        text = document.querySelector("#publishText").value.trim(),
        groupId = document.querySelector("#publishGroup").value;
      if (!text) return;
      const id = editingPostId || uid(),
        existing = editingPostId ? findPost(editingPostId) : null;
      const draft = {
        id,
        uid: user.uid,
        name: user.name,
        handle: user.handle,
        avatar: user.name[0],
        avatarUrl: user.avatarUrl || "",
        tone: "blue",
        groupId,
        isPublic: !groupId && document.querySelector("#publishVisibility").value === "public",
        previouslyPublic: existing?.isPublic === true,
        kind,
        title: document.querySelector("#publishTitle").value.trim(),
        text,
        code: document.querySelector("#publishCode").value.trim(),
        codeLanguage: document.querySelector("#publishLanguage").value,
        fileName: document.querySelector("#codeFilename").value.trim(),
        fileSize: selectedCodeFileBytes,
        videoProvider: document.querySelector("#videoProvider")?.value || "",
        videoId: document.querySelector("#videoId")?.value || "",
        tags: document
          .querySelector("#publishTags")
          .value.split(/[,،]/)
          .map((x) => x.trim().replace(/^#/, ""))
          .filter(Boolean)
          .slice(0, 5),
        likes: existing?.likes || 0,
        comments: existing?.comments || [],
        likedBy: existing?.likedBy || [],
        savedBy: [],
        createdAt: existing?.createdAt || Date.now(),
      };
      try {
        const typedVideo = document.querySelector("#publishVideo")?.value.trim();
        if (typedVideo) {
          toast("جارٍ التحقق من الفيديو…");
          const checked = await checkVideoInput();
          if (!checked) throw new AppError(videoLastReason || "تحقق من رابط الفيديو قبل النشر.");
          draft.videoProvider = checked.provider;
          draft.videoId = checked.id;
          draft.code = "";
          draft.fileName = "";
          draft.fileSize = 0;
        } else if (draft.videoId) {
          // Editing a post that already has a video: check that it still works.
          const res = await verifyVideo(draft.videoProvider, draft.videoId);
          if (!res.ok) throw new AppError(res.reason);
          draft.code = "";
          draft.fileName = "";
          draft.fileSize = 0;
        }
        validatePublishDraft(draft, existing);
        if (!(await savePost(draft))) return;
        clearSelectedCodeFile(false);
        editingPostId = "";
        closeModal();
        searchTerm = "";
        feedFilter = "الأحدث";
        navigate("home");
        toast(existing ? "تم حفظ تعديلات المنشور" : "تم نشر المشاركة");
      } catch (err) {
        handleError(err);
      }
    }
    if (e.target.id === "commentForm") {
      e.preventDefault();
      const id = document.querySelector("#commentPostId").value,
        text = document.querySelector("#commentText").value.trim();
      if (!text) return;
      if (!allowAction("comment", 5000)) return;
      try {
        if (text.length > 400) throw new AppError("التعليق طويل؛ الحد الأقصى 400 حرف.");
        await addComment(id, text);
        closeModal();
        toast("تم نشر التعليق");
      } catch (err) {
        handleError(err);
      }
    }
    if (e.target.id === "groupForm") {
      e.preventDefault();
      const name = document.querySelector("#groupName").value.trim();
      if (!currentUser()) return;
      if (name.length < 2) {
        handleError(new AppError("اسم المجموعة قصير جداً."));
        return;
      }
      if (!allowAction("group", 30000)) return;
      const id = uid(),
        description = document.querySelector("#groupDesc").value.trim().slice(0, 250),
        g = {
          id,
          name,
          description,
          visibility:
            document.querySelector("#groupVisibility").value === "private" ? "private" : "public",
          ownerUid: currentUser().uid,
          createdAt: Date.now(),
        };
      try {
        await database.ref(`groups/${id}`).set(g);
        await database.ref(`groupMembers/${id}/${currentUser().uid}`).set(true);
        const ownerUid = currentUser().uid;
        groupMembersMap[id] = { [ownerUid]: true };
        joinedIds = [...new Set([...Store.joined(), id])];
        if (!publicProfiles[ownerUid]) publicProfiles[ownerUid] = activeUser;
        rawGroupData[id] = g;
        replaceGroups(rawGroupData);
        closeModal();
        navigate("groups");
        toast("تم إنشاء المجموعة وإضافتك كمسؤول وعضو");
      } catch (err) {
        handleError(err);
      }
    }
    if (e.target.id === "resetForm") {
      e.preventDefault();
      const pw = document.querySelector("#newPassword").value;
      if (!isStrongPassword(pw) || !pendingResetCode) {
        handleError({ code: "auth/weak-password" });
        return;
      }
      try {
        await auth.confirmPasswordReset(pendingResetCode, pw);
        pendingResetCode = "";
        authForm("login");
        setAuthInfo("✓ تم تغيير كلمة المرور. سجّل الدخول الآن.");
      } catch (err) {
        handleError(err);
      }
    }
    if (e.target.id === "chatForm") {
      e.preventDefault();
      const field = document.querySelector("#chatInput"), text = field.value.trim(), other = e.target.dataset.to;
      if (!requireUser() || !text || !other) return;
      if (!canMessage(other)) {
        toast("تظهر المراسلة بعد أن يقبل العضو طلب متابعتك.");
        return;
      }
      if (text.length > 1000) {
        handleError(new AppError("الرسالة طويلة؛ الحد الأقصى 1000 حرف."));
        return;
      }
      if (!allowAction("chat", 1200, true)) return;
      try {
        const ref = conversationMessagesRef(other).push();
        await ref.set({ uid: currentUser().uid, text, createdAt: Date.now() });
        field.value = "";
        try {
          await addNotification(other, {
            type: "message",
            messageId: ref.key,
            text: language === "en" ? `You received a message from ${currentUser().name}.` : `أرسل لك ${currentUser().name} رسالة.`
          });
        } catch (notificationError) {
          log.warn("Codeex: message delivered, but notification could not be saved.", notificationError);
        }
      } catch (err) {
        handleError(err);
      }
    }
    if (e.target.id === "profileForm") {
      e.preventDefault();
      const user = currentUser();
      if (!user) {
        authForm("login");
        return;
      }
      const name = document.querySelector("#settingsName").value.trim(),
        rawHandle = document.querySelector("#settingsHandle").value.trim().replace(/^@+/, ""),
        bio = document.querySelector("#settingsBio").value.trim();
      const handle = rawHandle ? normalizeHandle(rawHandle) : user.handle;
      /* Only validate what actually changed, so an admin-set name/emoji never blocks saving the bio. */
      if (name !== user.name) {
        const problem = validateName(name);
        if (problem) {
          handleError(new AppError(problem));
          return;
        }
      }
      if (rawHandle && rawHandle.toLowerCase() !== handle) {
        handleError(
          new AppError(
            "اسم المستخدم يقبل أحرفاً إنجليزية وأرقاماً و _ و - فقط، ولا يقبل الإيموجي أو المسافات.",
          ),
        );
        return;
      }
      if (handle !== user.handle) {
        const problem = validateHandle(handle);
        if (problem) {
          handleError(new AppError(problem));
          return;
        }
        if (!allowAction("handle-change", 3000)) return;
      }
      try {
        await updateProfile({ name, handle, bio });
        toast("تم حفظ الملف الشخصي");
      } catch (err) {
        handleError(err);
      }
    }
  });

  document.querySelector("#pageView").addEventListener("input", (e) => {
    if (e.target.id === "msgSearch") {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll(".msg-item").forEach((el) => { el.hidden = !!q && !String(el.dataset.search || "").includes(q); });
      return;
    }
    if (e.target.id === "publishVideo") { scheduleVideoCheck(); return; }
    if (e.target.id !== "publishCode" || !selectedCodeFileBase64) return;
    if (e.target.value !== selectedCodeFileText) {
      clearSelectedCodeFile(false);
      const name = document.querySelector("#codeFilename");
      if (name) name.value = "";
      toast(language === "en" ? "Code edited; select the file again to publish it as an upload." : "عدّلت الكود؛ أعد اختيار الملف إن أردت نشره كمرفق.");
    }
  });

  document.querySelector("#pageView").addEventListener("paste", (e) => {
    if (e.target.id === "publishVideo") setTimeout(checkVideoInput, 0);
  });
  document.querySelector("#pageView").addEventListener("change", async (e) => {
    if (e.target.id === "publishVideo") { clearTimeout(videoCheckTimer); checkVideoInput(); return; }
    if (e.target.id === "publishKind") {
      updateComposePolicyUI();
      return;
    }
    if (e.target.id === "publishGroup" || e.target.id === "publishVisibility") {
      updatePublishVisibilityUI();
      return;
    }
    const input = e.target;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (input.id === "codeFile") {
      const kind = document.querySelector("#publishKind")?.value || "نقاش";
      const maxBytes = kind === "مقالة" ? 0 : maxCodeBytes(kind);
      if (kind === "مقالة") {
        toast(language === "en" ? "Articles cannot include an uploaded file." : "لا يمكن إرفاق ملف بالمقالة.");
        input.value = "";
        return;
      }
      if (file.size > maxBytes) {
        toast(!isProjectResourceKind(kind)
          ? (language === "en" ? "This kind of post cannot include a file larger than 1 MB." : "لا يمكن أن يتجاوز الملف 1 ميجابايت لهذا النوع من المنشورات.")
          : (language === "en" ? "Project/resource files cannot exceed 2 MB." : "لا يمكن أن يتجاوز ملف المشروع أو المورد 2 ميجابايت."));
        input.value = "";
        return;
      }
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const langs = { js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", py: "python", html: "html", css: "css", json: "json", java: "java", php: "php", go: "go", rs: "rust", c: "c", cpp: "cpp", cs: "csharp", sql: "sql", sh: "bash" };
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const base64 = btoa(binary);
        const content = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/u, "");
        document.querySelector("#publishCode").value = content;
        document.querySelector("#codeFilename").value = file.name;
        selectedCodeFileBase64 = base64;
        selectedCodeFileName = file.name;
        selectedCodeFileBytes = file.size;
        selectedCodeFileText = content;
        const select = document.querySelector("#publishLanguage");
        if (langs[ext]) select.value = langs[ext];
        if (studio) studio.reload();
        refreshCodeAttach();
        syncMediaExclusivity();
        toast(language === "en" ? `${file.name} loaded (${file.size} bytes).` : `تم تحميل ${file.name} (${file.size} بايت).`);
        input.value = "";
      } catch {
        clearSelectedCodeFile(false);
        toast(language === "en" ? "The selected file could not be read." : "تعذر قراءة الملف المحدد");
      }
      return;
    }
    if (input.id === "profileAvatar" || input.id === "settingsAvatar") {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) &&
        !/\.(png|jpe?g|webp)$/i.test(file.name)
      ) {
        toast("اختر صورة PNG أو JPG أو WebP");
        input.value = "";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast("حجم الصورة يجب أن يكون أقل من 5 ميغابايت");
        input.value = "";
        return;
      }
      const user = currentUser();
      if (!user) {
        authForm("login");
        input.value = "";
        return;
      }
      try {
        const avatarData = await makeAvatarDataUrl(file);
        await updateProfile({ avatarData, avatarUrl: "" });
        toast("تم حفظ صورة الملف الشخصي");
      } catch (err) {
        handleError(
          err instanceof AppError || err?.code
            ? err
            : new AppError("تعذّر حفظ الصورة؛ جرّب صورة JPG أو PNG أصغر."),
        );
      } finally {
        input.value = "";
      }
    }
  });

  document.querySelector("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      searchTerm = e.target.value.trim();
      navigate("search");
    }
  });

  document.querySelector("#searchInput").addEventListener("input", (e) => {
    if (!e.target.value.trim() && page === "search") {
      searchTerm = "";
      navigate("home");
    }
  });

  document.querySelector("#modalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  /* ==========================================================================
   Translations
   ========================================================================== */
  const EN = {
    مراسلة: "Message",
    "جارٍ تحميل المزيد…": "Loading more…",
    "وصلت إلى نهاية المنشورات": "You've reached the end",
    "بدون إيموجي.": "No emoji.",
    "اسم مستخدم فريد: أحرف إنجليزية صغيرة وأرقام و _ و - فقط (3–40 خانة).":
      "Unique username: lowercase English letters, numbers and _ . - only (3–40 characters).",
    "لا يمكن استخدام الإيموجي في الاسم.": "Emoji are not allowed in names.",
    "اسم المستخدم هذا مستخدم من عضو آخر؛ اختر اسماً مختلفاً.":
      "This username is already taken; choose a different one.",
    "تعذّر فتح المحادثة مع هذا العضو.": "Couldn't open a chat with this member.",
    جاهز: "Ready",
    الرئيسية: "Home",
    الرئيسية: "Home",
    المقالات: "Articles",
    المجتمع: "Community",
    المشاريع: "Projects",
    "الصفحة الرئيسية": "Home",
    إشعاراتي: "Notifications",
    الرسائل: "Messages",
    المحفوظات: "Saved",
    مساهماتي: "My contributions",
    الإعدادات: "Settings",
    "الموارد والمسارات": "Learning resources",
    دخول: "Sign in",
    خروج: "Sign out",
    زائر: "Visitor",
    "ابحث في Codeex...": "Search Codeex...",
    ابحث: "Search",
    "المجموعات الشائعة": "Community groups",
    المجموعات: "Groups",
    "وسوم منشورات المجتمع": "Post tags",
    "وسوم مستخدمة": "Used tags",
    "شارك معرفتك": "Share your knowledge",
    "شارك فكرة أو مشروعاً ليستفيد منهما المطورون.":
      "Share an idea or project with the developer community.",
    "ابدأ المشاركة": "Start sharing",
    نشر: "Post",
    حسابي: "My profile",
    "عرض الكل": "View all",
    "الوسوم الرائجة": "Trending tags",
    انضم: "Join",
    انضممت: "Joined",
    Codeex: "Codeex",
    "تبادل الخبرات، شارك معرفتك، واعرض ما تبنيه مع أعضاء مجتمع Codeex.":
      "Learn together, share what you know, and showcase what you build with the Arab developer community.",
    "ابدأ المشاركة": "Start sharing",
    "اكتشف المجتمعات": "Explore communities",
    مطوّرون: "Developers",
    أفكار: "Ideas",
    مجتمع: "Community",
    "معاً نبني": "Building together",
    "مستقبلاً أفضل": "a better future",
    "للتقنية العربية": "for Arabic technology",
    "ماذا تريد أن تشارك اليوم؟": "What would you like to share today?",
    مقالة: "Article",
    سؤال: "Question",
    نقاش: "Discussion",
    مورد: "Resource",
    الأحدث: "Latest",
    "الأكثر تفاعلاً": "Most active",
    الموارد: "Resources",
    "ستظهر هنا الموارد التعليمية التي تُنشر فعلياً للمجتمع.":
      "Published learning resources will appear here.",
    "لا توجد موارد منشورة بعد": "No learning resources have been published yet.",
    "لا توجد حالياً موارد تعليمية منشورة.": "There are currently no published learning resources.",
    "نتائج البحث": "Search results",
    "الأحدث أولاً": "Newest first",
    "لا توجد نتائج هنا بعد": "No posts yet",
    "جرّب اختيار تصنيف آخر أو اكتب أول منشور.": "Choose another filter or publish the first post.",
    "لم تحفظ أي منشور بعد": "No saved posts yet",
    "لا توجد مشاريع منشورة": "No projects published yet",
    "لا توجد مجموعات منشورة بعد": "No groups have been created yet.",
    "لا توجد وسوم رائجة بعد": "No trending tags yet.",
    "هذا المجتمع جديد": "This community is just getting started",
    "انضم إلى مجتمع المطورين العرب": "Join the Arab developer community",
    "مساحة عربية للتعلّم والتعاون ومشاركة الأفكار والمشاريع البرمجية.":
      "A welcoming space to learn, collaborate, and share ideas and software projects.",
    "شارك المعرفة": "Share knowledge",
    "تعلّم مع المطورين": "Learn with developers",
    "اعرض مشاريعك": "Showcase your projects",
    "إنشاء حساب مجاني": "Create a free account",
    "تسجيل الدخول": "Sign in",
    "أهلاً بك في Codeex": "Welcome to Codeex",
    "مجتمع المطورين العرب": "A community for Arab developers",
    "ابدأ رحلتك مع المطورين العرب": "Start your journey with Arab developers",
    "غيّر اللغة": "Language",
    العربية: "Arabic",
    الإنجليزية: "English",
    اللغة: "Language",
    "حفظ التغييرات": "Save changes",
    "تفضيلات اللغة": "Language preferences",
    "اختر لغة واجهة الموقع.": "Choose the interface language.",
    "المعلومات الشخصية": "Profile information",
    "صورة الملف الشخصي": "Profile photo",
    "تغيير الصورة": "Change photo",
    "الاسم الظاهر": "Display name",
    "اسم المستخدم": "Username",
    "نبذة قصيرة": "Short bio",
    "عرّف المجتمع بنفسك...": "Tell the community about yourself...",
    المظهر: "Appearance",
    "الوضع الحالي": "Current theme",
    "يتذكر Codeex اختيارك على هذا المتصفح.": "Your preference is saved in this browser.",
    "التبديل إلى الوضع الليلي": "Switch to dark mode",
    "التبديل إلى الوضع الفاتح": "Switch to light mode",
    "الأمان والحساب": "Security & account",
    "حالة البريد الإلكتروني": "Email status",
    "البريد الإلكتروني موثّق": "Email verified",
    "البريد الإلكتروني غير موثّق": "Email not verified",
    "إرسال رسالة توثيق": "Send verification email",
    "إعادة تعيين كلمة المرور": "Reset password",
    "نسيت كلمة المرور؟ أرسل رابط إعادة التعيين": "Forgot your password? Send a reset link",
    "أدخل بريدك الإلكتروني أولاً.": "Enter your email address first.",
    "تسجيل الخروج من هذا الجهاز": "Sign out on this device",

    "تفضيلات الإشعارات": "Notification preferences",
    "إشعارات التفاعل": "Interaction notifications",
    "رسائل المجتمع": "Community messages",
    "ملفي الشخصي عام": "My profile is visible to members",

    "المتابعة باستخدام Google": "Continue with Google",
    "المتابعة باستخدام GitHub": "Continue with GitHub",
    "البريد الإلكتروني": "Email address",
    "كلمة المرور": "Password",
    "إنشاء الحساب": "Create account",
    "لديك حساب؟ سجّل الدخول": "Already have an account? Sign in",
    "مستخدم جديد؟ أنشئ حساباً": "New here? Create an account",
    "خيارات المنشور": "Post options",
    "حفظ المنشور": "Save post",
    "الإبلاغ عن المنشور": "Report post",
    إرسال: "Send",
    "إرسال التعليق": "Post comment",
    التعليقات: "Comments",
    "لا توجد تعليقات بعد.": "No comments yet.",
    "أضف تعليقاً...": "Add a comment...",
    "اقرأ المقالة": "Read article",
    "اكتب مقالة": "Write an article",
    "أضف مشروعاً": "Add a project",
    "المشاريع القادمة": "Projects",
    السؤال: "Question",
    "نوع المشاركة": "Post type",
    "العنوان (اختياري للنقاش)": "Title (optional for discussions)",
    "عنوان واضح ومفيد": "A clear, useful title",
    التفاصيل: "Details",
    "اكتب ما تريد مشاركته...": "Write what you would like to share...",
    "مقطع كود (اختياري)": "Code snippet (optional)",
    "اختيار ملف كود": "Choose a code file",
    "الصق الكود هنا أو اختر ملفاً من جهازك": "Paste code here or choose a file",
    "": "Code will appear in a VS Code-style viewer.",
    "وسوم مفصولة بفاصلة": "Tags separated by commas",
    إلغاء: "Cancel",
    "نشر المشاركة": "Publish post",
    "إنشاء مشاركة": "Create a post",
    "ابدأ أول مشاركة": "Publish the first post",
    "بدون إجابة": "Unanswered",
    "المقالات القادمة تبدأ منك": "The first article can start with you",
    "شارك مشروعك الأول مع المجتمع.": "Share your first project with the community.",
    "المجتمع والمجموعات": "Community groups",
    "اعثر على مطورين يشاركونك الاهتمام، وانضم إلى النقاشات المناسبة.":
      "Find developers with shared interests and join relevant discussions.",
    "إنشاء مجموعة": "Create a group",
    "مجموعة جديدة": "New group",
    "اسم المجموعة": "Group name",
    "وصف مختصر": "Short description",
    "أنشئ مجموعة": "Create group",
    "مجموعة مجتمع": "Community group",
    "الرسائل خاصة بأصحاب الحسابات": "Messaging is available to signed-in members",
    "لا يوجد أعضاء مسجلون بعد": "No members have registered yet",
    "محادثات مباشرة بين أعضاء Codeex المسجلين.":
      "Private conversations between registered Codeex members.",
    "اكتب رسالة...": "Write a message...",
    "ابدأ المحادثة برسالة ترحيب.": "Start the conversation with a message.",
    "الموارد والمسارات": "Learning resources",
    "مصادر تعليمية ومسارات تساعدك على تطوير مهاراتك البرمجية.":
      "Learning resources to help develop your programming skills.",
    "نتائج البحث:": "Search results:",
    "لم نجد نتائج": "No results found",
    "جرّب كلمات بحث مختلفة.": "Try different search terms.",
    "ملفك الشخصي": "Your profile",
    "سجّل الدخول": "Sign in",
    منشوراتي: "My posts",
    مشاريعي: "My projects",
    مقالاتي: "My articles",
    مشروع: "Project",
    مساهمة: "Contribution",
    "مجموعة منضم إليها": "Joined groups",
    متابع: "Followers",
    متابعون: "Followers",
    حفظ: "Save",
    محفوظ: "Saved",
    مشاركة: "Share",
    "عرض المزيد": "Read more",
    "نسخ الكود": "Copy code",
    المزيد: "More",
    "اقرأ المزيد": "Read more",
    مطور: "Developer",
    "مطور جديد": "New developer",
    "لم يضف نبذة شخصية بعد. شارك ما تبنيه وما تتعلمه مع مجتمع المطورين العرب.":
      "No bio yet. Share what you build and learn with the developer community.",
    "عضو منذ": "Member since",
    "المجتمع العربي": "Arab developer community",
    "يبني ويشارك": "Building and sharing",
    "لا توجد مشاريع منشورة بعد": "No projects published yet",
    "لا توجد مقالات بعد": "No articles yet",
    "لا توجد منشورات بعد": "No posts yet",
    "الإشعارات القادمة ستظهر هنا": "Notifications will appear here",
    "تابع التفاعلات والأنشطة الجديدة في مجتمعك.": "Keep up with new activity in your community.",
    "تحديد الكل كمقروء": "Mark all as read",
    "تحديد الكل كمقروء": "Mark all as read",
    "الوضع الداكن": "Dark mode",
    ملفك: "Your profile",
    إشعارات: "Notifications",
    "تسجيل الدخول بنجاح": "Signed in successfully",
    "تم تسجيل الدخول باستخدام Google": "Signed in with Google",
    "احصل على حساب": "Create your account",
    "أضف إلى المفضلة": "Add to favorites",
    "تم نسخ الكود": "Code copied",
    "تم نسخ رابط المشاركة": "Share link copied",
    "تسجيل الدخول إلى Codeex": "Sign in to Codeex",
    "إنشاء حساب في Codeex": "Create your Codeex account",
    "فيديو (اختياري)": "Video (optional)",
    "أزل الكود أو الملف أولاً لتتمكن من إضافة فيديو.": "Remove the code or file first to add a video.",
    "جارٍ التحقق من أن الفيديو يعمل…": "Checking that the video works…",
    "جارٍ التحقق من الفيديو…": "Checking the video…",
    "تحقق من رابط الفيديو قبل النشر.": "Check the video link before publishing.",
    "رابط الفيديو غير صالح.": "The video link is not valid.",
    "الفيديو غير موجود، أو هو خاص أو محذوف.": "The video does not exist, or it is private or deleted.",
    "تعذر التحقق من الفيديو الآن. حاول مرة أخرى.": "Could not check the video right now. Try again.",
    "تعذر الوصول إلى الفيديو؛ تأكد من الرابط ومن اتصالك بالإنترنت.": "Could not reach the video; check the link and your connection.",
    "هذا العنصر مقيّد أو غير متاح للعرض.": "This item is restricted or unavailable for viewing.",
    "لا يحتوي هذا العنصر على ملف فيديو قابل للتشغيل.": "This item has no playable video file.",
    "تعذر التحقق من الفيديو؛ تأكد من اتصالك بالإنترنت ثم أعد المحاولة.": "Could not check the video; check your connection and try again.",
    "تشغيل الفيديو": "Play video",
    "مشغل الفيديو": "Video player",
    "تمت إضافة فيديو، لذلك لا يمكن إرفاق كود أو ملف. أزل الفيديو إن أردت إضافة كود.": "A video was added, so code or files cannot be attached. Remove the video to add code.",
    "تمت إضافة فيديو؛ أزله أولاً لتتمكن من إضافة كود.": "A video was added; remove it first to add code.",
    "تعديل في المحرر": "Edit in editor",
    "إزالة الكود": "Remove code",
    "أضف مقطع كود": "Add a code snippet",
    "اكتب أو الصق الكود في محرر مخصص بتلوين حسب لغة البرمجة.": "Write or paste your code in a dedicated editor with per-language syntax colouring.",
    "كتابة الكود": "Write code",
    "رفع ملف": "Upload a file",
    "محرر الكود": "Code editor",
    "فتح ملف": "Open file",
    "إلغاء": "Cancel",
    "إرفاق الكود": "Attach code",
    "لغة البرمجة": "Programming language",
    "اكتب الكود هنا": "Write code here",
    "اكتب أو الصق الكود هنا…": "Write or paste your code here…",
    "اختصارات الكتابة": "Typing shortcuts",
    "إزالة الفيديو": "Remove video",
    "تجاهل التعديلات على الكود؟": "Discard the changes to the code?",
    "أدمن الموقع": "Site admin",
    "عرض المزيد": "Show more",
    "وصلت إلى الحد الأقصى: تعليقان لكل شخص على المنشور الواحد.": "Limit reached: each person can comment twice on a post.",
    "يمكنك التعليق مرتين فقط على المنشور الواحد.": "You can comment only twice on the same post.",
    "مجموعاتك المطابقة": "Matching groups you joined",
    "المنشورات المطابقة": "Matching posts",
    "المنشورات والمجموعات المطابقة، بما فيها مجموعاتك العامة والخاصة.": "Matching posts and groups, including your public and private groups.",
    "نتحقق من أن الفيديو يعمل قبل النشر، وإذا أضفت فيديو فلا يمكن إرفاق كود أو ملف معه.": "We check that the video works before publishing; a post with a video cannot include code or a file.",
    "الرابط غير مدعوم. تأكد من أنه رابط فيديو صحيح من مصدر مدعوم.": "Unsupported link. Make sure it is a valid video link from a supported source.",
    "صاحب الفيديو لا يسمح بتضمينه في المواقع الأخرى.": "The video owner does not allow embedding it on other sites.",
    "تعذر الوصول إلى مصدر الفيديو الآن. حاول مرة أخرى.": "Could not reach the video source right now. Try again.",
    "هذا الفيديو غير موجود.": "This video does not exist.",
    "هذا الرابط ليس فيديو.": "This link is not a video.",
    "ألصق رابط الفيديو هنا": "Paste the video link here",
    "✓ الفيديو الحالي في المنشور": "✓ The post's current video",
    "طلبات المتابعة": "Follow requests",
    "قبول المتابعة": "Accept",
    "رفض المتابعة": "Decline",
    "المحادثات": "Conversations",
    "ابحث في المحادثات…": "Search conversations…",
    "ابدأ بمتابعة الأعضاء": "Start by following members",
    "تظهر المحادثة هنا بعد أن يقبل العضو طلب متابعتك. افتح ملف أي عضو واضغط «متابعة العضو».": "The conversation appears here once the member accepts your follow request. Open any member's profile and press “Follow”.",
    "ابدأ المحادثة برسالة ترحيب 👋": "Start the conversation with a hello 👋",
    "رجوع إلى المحادثات": "Back to conversations",
    "الملف الشخصي": "Profile",
    "محادثات مباشرة بين الأعضاء المتابِعين لبعضهم.": "Direct conversations between members who follow each other.",
    "متابعة العضو": "Follow",
    "✓ تتابع هذا العضو": "✓ Following",
    "طلب المتابعة قيد الانتظار · إلغاء": "Request pending · Cancel",
    "قبول طلب المتابعة": "Accept follow request",
    "رفض طلب المتابعة": "Decline follow request",
    "أُرسل طلب المتابعة. ستظهر المراسلة عند قبوله.": "Follow request sent. Messaging appears once it is accepted.",
    "رُفض طلب المتابعة": "Follow request declined",
    "أُلغي طلب المتابعة": "Follow request cancelled",
    "قبلت طلب المتابعة. يمكنكما الآن المراسلة.": "Request accepted. You can now message each other.",
    "ألغيت متابعة هذا العضو": "You unfollowed this member",
    "أُزيل المتابع": "Follower removed",
    "تظهر المراسلة بعد أن يقبل العضو طلب متابعتك.": "Messaging is available after the member accepts your follow request.",
    "لا توجد محادثات بعد": "No conversations yet",
    "أنت مشرف في هذه المجموعة": "You are a moderator of this group",
    "تم إبعادك من هذه المجموعة ولا يمكنك الانضمام إليها مجدداً.": "You were removed from this group and cannot join it again.",
    "إزالة الإشراف": "Remove moderator",
    "تعيين مشرفاً": "Make moderator",
    "المطرودون": "Removed members",
    "السماح بالعودة": "Allow to rejoin",
    "لا يمكن طرد المالك أو أدمن الموقع.": "The owner and the site admin cannot be removed.",
    "تم طرد العضو من المجموعة": "Member removed from the group",
    "يمكن للعضو الانضمام مجدداً": "The member can join again",
    "لا يوجد أعضاء.": "No members.",
  };

  Object.assign(EN, {
    "ستظهر المحادثات هنا بعد انضمام الأعضاء.": "Conversations will appear here once members join.",
    "الصلاحيات محمية على الخادم وليس في الواجهة فقط":
      "Permissions are enforced on the server, not just in the UI",
    "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.":
      "Could not reach the server. Check your internet connection and try again.",
    "حدث خطأ في معالجة البيانات. حاول مرة أخرى بعد قليل.":
      "A data error occurred. Please try again in a moment.",
    "لا تملك صلاحية تنفيذ هذا الإجراء.": "You do not have permission to do this.",
    "انتهت جلستك. سجّل الدخول مجدداً ثم أعد المحاولة.":
      "Your session has expired. Sign in again and retry.",
    "تعذّر التحقق من الطلب. أعد تحميل الصفحة ثم حاول مجدداً.":
      "The request could not be verified. Reload the page and try again.",
    "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.":
      "Too many attempts in a short time. Please wait a moment and try again.",
    "الخدمة غير متاحة حالياً. حاول مرة أخرى لاحقاً.":
      "The service is currently unavailable. Please try again later.",
    "البريد الإلكتروني أو كلمة المرور غير صحيحة.": "The email or password is incorrect.",
    "لم يكتمل تسجيل الدخول. أعد المحاولة.": "Sign-in was not completed. Please try again.",
    "هذا البريد مسجّل بالفعل.": "This email is already registered.",
    "صيغة البريد الإلكتروني غير صحيحة.": "The email address is not valid.",
    "كلمة المرور ضعيفة؛ استخدم 8 أحرف على الأقل تتضمن أحرفاً وأرقاماً.":
      "Weak password: use at least 8 characters including letters and numbers.",
    "هذا الحساب غير متاح حالياً.": "This account is currently unavailable.",
    "رابط التفعيل غير صالح أو سبق استخدامه؛ إن كان حسابك مفعلاً فسجّل الدخول مباشرة.":
      "The link is invalid or was already used. If your account is verified, just sign in.",
    "انتهت صلاحية الرابط؛ سجّل الدخول واطلب رسالة تفعيل جديدة.":
      "The link has expired. Sign in and request a new verification email.",
    "يوجد حساب بهذا البريد عبر طريقة دخول أخرى؛ سجّل بالطريقة الأصلية أولاً.":
      "An account with this email exists with another sign-in method. Use the original method first.",
    "تم حظر النافذة المنبثقة؛ اسمح بها في المتصفح ثم أعد المحاولة.":
      "The pop-up was blocked. Allow pop-ups and try again.",
    "المتصفح يمنع التخزين المطلوب لتسجيل الدخول؛ فعّل ملفات الارتباط ثم أعد المحاولة.":
      "Your browser blocks the storage needed to sign in. Enable cookies and try again.",
    "هذا المتصفح لا يدعم تسجيل الدخول بهذه الطريقة؛ افتح الموقع في المتصفح مباشرة.":
      "This browser does not support this sign-in method. Open the site directly in your browser.",
    "الرجاء التمهّل قليلاً قبل إعادة المحاولة.": "Please slow down a little before trying again.",
    "محاولات دخول كثيرة؛ انتظر قليلاً ثم أعد المحاولة.":
      "Too many sign-in attempts. Please wait a moment and try again.",
    "اكتب اسماً من 2 إلى 50 حرفاً.": "Enter a name between 2 and 50 characters.",
    "اكتب اسماً من حرفين على الأقل.": "Enter a name with at least 2 characters.",
    "التعليق طويل؛ الحد الأقصى 400 حرف.": "The comment is too long (400 characters max).",
    "الرسالة طويلة؛ الحد الأقصى 1000 حرف.": "The message is too long (1000 characters max).",
    "اسم المجموعة قصير جداً.": "The group name is too short.",
    "الخدمة غير جاهزة بعد؛ أعد المحاولة بعد قليل.":
      "The service is not ready yet. Try again shortly.",
    "الصورة كبيرة جداً؛ جرّب صورة أصغر.": "The image is too large. Try a smaller one.",
    "تعذّر حفظ الصورة؛ جرّب صورة JPG أو PNG أصغر.":
      "Could not save the image. Try a smaller JPG or PNG.",
    "المنشور غير متاح حالياً.": "This post is not available right now.",
    "تعذّر التفاعل مع هذا المنشور حالياً.": "You cannot interact with this post right now.",
    "ستتوفر تفاصيل المسار قريباً.": "Path details are coming soon.",
    "تم نشر المشاركة": "Your post has been published",
    "تم نشر التعليق": "Your comment has been posted",
    "تم حفظ الملف الشخصي": "Profile saved",
    "تم حفظ صورة الملف الشخصي": "Profile photo saved",
    "جارٍ تحميل خدمات الموقع…": "Loading site services…",
    "تعذّر تحميل الموقع. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.":
      "The site could not be loaded. Check your connection and reload the page.",
    "سنرسل رابط التفعيل إلى بريدك الإلكتروني بعد إنشاء الحساب.":
      "We will send a verification link to your email after you create the account.",
    "الخدمة غير متاحة بعد؛ سنحاول الاتصال تلقائياً.":
      "The service is not available yet; we will keep trying to connect.",
    "لا تشارك كلمة المرور أو رموز التحقق مع أي شخص، وسجّل الخروج دائماً من الأجهزة المشتركة.":
      "Never share your password or verification codes, and always sign out on shared devices.",
    "✓ تم تفعيل بريدك الإلكتروني بنجاح. سجّل الدخول الآن.":
      "✓ Your email has been verified. Sign in now.",
    "✓ تم تفعيل بريدك الإلكتروني. سجّل الدخول الآن.":
      "✓ Your email has been verified. Sign in now.",
    "✓ تم تغيير كلمة المرور. سجّل الدخول الآن.": "✓ Your password was changed. Sign in now.",
    "أُعيد إرسال رسالة التفعيل. تحقق من بريدك.": "Verification email sent again. Check your inbox.",
    "بريدك الإلكتروني غير مفعّل بعد. افتح رسالة التفعيل المرسلة إليك ثم سجّل الدخول.":
      "Your email is not verified yet. Open the verification email we sent you, then sign in.",
    "إعادة إرسال رسالة التفعيل": "Resend verification email",
    "تحقق من بريدك الإلكتروني": "Check your email",
    "أرسلنا رابط التفعيل إلى": "We sent a verification link to",
    "افتح الرسالة واضغط على الرابط لتفعيل حسابك، وبعدها ستصل إلى صفحة تسجيل الدخول.":
      "Open the email and click the link to verify your account, then you will reach the sign-in page.",
    "لم تصلك الرسالة؟ راجع مجلد الرسائل غير المرغوب فيها (Spam).":
      "Didn't get it? Check your spam folder.",
    "الذهاب إلى تسجيل الدخول": "Go to sign in",
    "حفظ كلمة المرور": "Save password",
    "تحكم في الملف الشخصي واللغة والأمان.": "Manage your profile, language, and security.",
    "اختر صورة PNG أو JPG أو WebP.": "Choose a PNG, JPG, or WebP image.",
    مجموعة: "Group",
    مرحباً: "Welcome",
    منشور: "Post",
    "مجموعة منضم إليها": "Joined groups",
    "الملف الشخصي": "Profile",
    "تعلّم وتواصل وشارك ما تبنيه مع المطورين العرب.":
      "Learn, connect, and share what you build with Arab developers.",
    "ابدأ رحلتك": "Get started",
    "منشورات المجتمع": "Community posts",
    "الصفحة الرئيسية": "Home",
    "آخر المنشورات": "Latest posts",
    "الأكثر شيوعاً": "Most popular",
    "المقالات التقنية": "Technical articles",
    "كل المنشورات": "All posts",
    "مساهمات المجتمع": "Community contributions",
    "لا توجد نتائج": "No results",
    "اكتب أول منشور": "Write the first post",
    "شارك مشروعك": "Share your project",
    "انضم إلى المجموعة": "Join group",
    "انضممت إلى المجموعة": "Joined group",
    المجموعات: "Groups",
    مجموعات: "Groups",
    الأعضاء: "Members",
    أعضاء: "Members",
    "لا توجد مجموعات منشورة بعد": "No groups have been created yet",
    "ستظهر هنا المجموعات الحقيقية التي ينشئها أعضاء المجتمع.":
      "Groups created by real community members will appear here.",
    "أنشأها عضو في المجتمع.": "Created by a community member.",
    "المجتمع والمجموعات": "Community groups",
    "عن المجتمع": "About the community",
    "تفاصيل الحساب": "Account details",
    "حالة الحساب": "Account status",
    "تحديث الملف الشخصي": "Update profile",
    "احفظ المعلومات": "Save details",
    "اكتب نبذة عنك": "Write a short bio",
    "البريد الإلكتروني غير موثّق": "Email not verified",
    "أُرسلت رسالة التوثيق إلى بريدك.": "Verification email sent.",
    "أُرسل رابط إعادة تعيين كلمة المرور.": "Password reset link sent.",
    "لا يوجد بريد إلكتروني لهذا الحساب.": "This account has no email address.",
    "إشعارات قادمة": "Recent notifications",
    "لم تصلك إشعارات بعد": "You have no notifications yet",
    "لا توجد محادثات بعد": "No conversations yet",
    "ابدأ محادثة جديدة": "Start a new conversation",
    "ابدأ المحادثة برسالة ترحيب.": "Start the conversation with a greeting.",
    "إرسال رسالة": "Send a message",
    المحادثة: "Conversation",
    "محتوى المنشور": "Post content",
    "عدد التعليقات": "Comments",
    إعجاب: "Like",
    إعجابات: "Likes",
    تعليق: "Comment",
    تعليقات: "Comments",
    "أضف تعليقاً": "Add a comment",
    "أضف وسوماً": "Add tags",
    "مقطع كود": "Code snippet",
    "لغة البرمجة": "Programming language",
    "اسم الملف": "File name",
    "رفع الملف": "Upload file",
    "اختر ملفاً": "Choose a file",
    "مقالات تقنية": "Technical articles",
    "مشاريع المجتمع": "Community projects",
    مشاريعك: "Your projects",
    المساهمات: "Contributions",
    "عرض الملف الشخصي": "View profile",
    "تعديل الملف الشخصي": "Edit profile",
    "نبذة عني": "About me",
    "لم يضف نبذة شخصية بعد.": "No bio added yet.",
    "إعدادات الأمان": "Security settings",
    الحماية: "Security",
    "التحقق بخطوتين": "Two-step verification",
    "المصادقة متعددة العوامل": "Multi-factor authentication",
    تفعيل: "Enable",
    حفظ: "Save",
    "تم الحفظ": "Saved",
    "جاري التحميل": "Loading",
    "تعذر التحميل": "Could not load",
    "لا يوجد محتوى حتى الآن": "Nothing here yet",
    "معلومات المجتمع": "Community information",
    "دليل تعليمي": "Learning guide",
    "ابدأ المسار": "Explore guide",
    "ابدأ التعلم": "Start learning",
    "تشغيل تجريبي": "Demo run",
    تشغيل: "Run",
    مسح: "Clear",
    النتيجة: "Output",
    "ستظهر النتيجة هنا بعد الضغط على تشغيل.": "Output will appear here after you run the demo.",
    "نسخ الكود": "Copy code",
    "عرض المزيد": "Read more",
    "تم نسخ الكود": "Code copied",
    "تم نسخ رابط المشاركة": "Share link copied",
    الإبلاغ: "Report",
    "الإبلاغ عن المنشور": "Report post",
    "حفظ المنشور": "Save post",
    "إزالة من المحفوظات": "Remove from saved",
    المحفوظات: "Saved",
    المحادثات: "Conversations",
    التفاصيل: "Details",
    "عنوان المنشور": "Post title",
    "بدون عنوان": "Untitled",
    الوسوم: "Tags",
    المنشورات: "Posts",
    "ماذا تريد أن تشارك اليوم؟": "What would you like to share today?",
    "مجتمع للمطورين العرب": "A community for Arab developers",
    "أهلاً بك": "Welcome",
    اسمك: "Your name",
    "اسم المستخدم": "Username",
    "مشاركة جديدة": "New post",
    "أضف وصفاً": "Add a description",
    "إدارة الحساب": "Manage account",
    "تسجيل الخروج": "Sign out",
    "تسجيل الخروج من هذا الجهاز": "Sign out on this device",
    "البريد الإلكتروني": "Email address",
    "كلمة المرور": "Password",
    "كلمة مرور جديدة": "New password",
    العودة: "Back",
    موافق: "OK",
    التالي: "Next",
    إغلاق: "Close",
    حذف: "Delete",
    إلغاء: "Cancel",
    "تسجيل الدخول": "Sign in",
    "إنشاء حساب": "Create account",
    "إنشاء حساب مجاني": "Create a free account",
    اللغة: "Language",
    "اختر لغة واجهة الموقع.": "Choose the interface language.",
    العربية: "Arabic",
    الإنجليزية: "English",
    "تفضيلات اللغة": "Language preferences",
    "الموارد التعليمية": "Learning resources",
    "وسوم رائجة": "Trending tags",
    "لا توجد وسوم رائجة بعد.": "No trending tags yet.",
    "وسوم المجتمع": "Community tags",
    "ترتيب حسب الأحدث": "Sort by newest",
    "بدون إجابة": "Unanswered",
    "الأكثر تفاعلاً": "Most active",
    "عرض الكل": "View all",
    "تابع معنا": "Follow along",
    "البحث في المجتمع": "Search the community",
    "لم يتم العثور على نتائج": "No matching results",
    "المشاركة في Codeex": "Share on Codeex",
    "سجّل الدخول أولاً لتتمكن من النشر.": "Sign in to publish.",
    "تحتاج إلى حساب للمشاركة": "You need an account to contribute",
    "إنشاء الحساب": "Create account",
    "تسجيل الدخول باستخدام Google": "Sign in with Google",
    "متابعة باستخدام Google": "Continue with Google",
    "المتابعة باستخدام Google": "Continue with Google",
    Codeex: "Codeex",
    عضو: "Member",
    "مجموعة مجتمع": "Community group",
    "عضو في مجتمع Codeex": "Codeex member",
    "مطور في مجتمع Codeex": "Developer on Codeex",
    "يبني ويشارك": "Building and sharing",
    "المجتمع العربي": "Arab developer community",
    مساهمة: "Contribution",
    مشاريع: "Projects",
    المشاريع: "Projects",
    مقالاتي: "My articles",
    منشوراتي: "My posts",
    "ملفي الشخصي": "My profile",
    ملفي: "My profile",
    "تعديل الملف": "Edit profile",
    "كن جزءاً من التغيير": "Be part of the change",
    "ساهم في بناء محتوى تقني عربي أفضل وادعم المجتمع.":
      "Help build better Arabic tech content and support the community.",
    "ادعم Codeex": "Support Codeex",
    "شكراً لاهتمامك بدعم المجتمع. خيارات الدعم ستتاح عند اكتمال إعداد المنصة.":
      "Thank you for supporting the community. Support options will be announced when available.",
    "إنشاء أول مجموعة": "Create the first group",
    "اكتب مقالة تقنية وشارك تجربتك.": "Write a technical article and share your experience.",
    "شارك مشروعك الأول مع المجتمع.": "Share your first project with the community.",
    "لا توجد مقالات بعد": "No articles yet",
    "لا توجد منشورات بعد": "No posts yet",
    "لا توجد مشاريع منشورة": "No projects have been published yet",
    "لم تحفظ أي منشور بعد": "You have not saved any posts yet",
    "لا توجد نتائج هنا بعد": "No results here yet",
    "اختر تصنيفاً آخر أو اكتب أول منشور.": "Choose another category or write the first post.",
    "التبديل إلى الوضع الليلي": "Switch to dark mode",
    "التبديل إلى الوضع الفاتح": "Switch to light mode",
    "الوضع الحالي": "Current theme",
    "المعلومات الشخصية": "Personal information",
    "الأمان والحساب": "Security and account",
    "صورة الملف الشخصي": "Profile picture",
    "تغيير الصورة": "Change picture",
    "حالة البريد الإلكتروني": "Email verification",
    "البريد الإلكتروني موثّق": "Email verified",
    "إرسال رسالة توثيق": "Send verification email",
    "إعادة تعيين كلمة المرور": "Reset password",
    "نسيت كلمة المرور؟ أرسل رابط إعادة التعيين": "Forgot your password? Send a reset link",
    "أدخل بريدك الإلكتروني أولاً.": "Enter your email address first.",
    "الجلسة الحالية": "Current session",
    "إشعارات التفاعل": "Interaction notifications",
    "رسائل المجتمع": "Community messages",
    "ملفي الشخصي عام": "My profile is visible to signed-in members",
    المظهر: "Appearance",
    "حفظ التغييرات": "Save changes",
    الإعدادات: "Settings",
    "تفضيلات الإشعارات": "Notification preferences",
    المساهمات: "Contributions",
    "الموارد والمسارات": "Learning resources",
  });

  /* ==========================================================================
   Startup
   ========================================================================== */
  setTheme(read("codna_html_theme_v1", "light"), false);

  setLanguage(language, false);

  if (location.hash.slice(1))
    setTimeout(() => {
      const id = location.hash.slice(1);
      if (currentUser() && findPost(id)) openModal("تفاصيل المشاركة", postCard(findPost(id)));
    }, 0);

  renderFrame();

  /* ==========================================================================
   Lazy Firebase loading
   --------------------------------------------------------------------------
   The Firebase SDKs and App Check (reCAPTCHA) are the heaviest part of the page and a
   first-time visitor sees a static landing screen that does not need them. They now load
   immediately only when they are needed right away (returning member, email/deep links,
   pending sign-in redirect) and otherwise on the first user interaction.
   ========================================================================== */
  const SDK_VERSION = "11.10.0";
  const SDK_FILES = ["app", "app-check", "auth", "database"]; /* functions SDK was never used */
  const SESSION_HINT = "codeex_session_hint_v1";
  let sdkRequested = false,
    sdkAttempts = 0;
  function startFirebaseSdk() {
    if (sdkRequested) return;
    sdkRequested = true;
    const ready = () => {
      if (connectServices()) return;
      let tries = 0;
      const poll = setInterval(() => {
        if (connectServices() || ++tries >= 100) clearInterval(poll);
      }, 100);
    };
    if (typeof firebase !== "undefined" && firebase.apps) {
      ready();
      return;
    }
    let remaining = SDK_FILES.length,
      failed = false;
    SDK_FILES.forEach((name) => {
      const el = document.createElement("script");
      el.src = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${name}-compat.js`;
      el.async = false; /* dynamically inserted scripts keep their order only with async=false */
      el.onload = () => {
        if (--remaining === 0 && !failed) ready();
      };
      el.onerror = () => {
        if (failed) return;
        failed = true;
        sdkRequested = false;
        if (++sdkAttempts < 3) setTimeout(startFirebaseSdk, 2500);
      };
      document.head.appendChild(el);
    });
  }
  const needsFirebaseNow = (() => {
    try {
      if (localStorage.getItem(SESSION_HINT) === "1") return true;
    } catch {}
    try {
      if (Object.keys(sessionStorage).some((k) => k.indexOf("firebase:") === 0)) return true;
    } catch {}
    return /[?&](mode|oobCode)=/.test(location.search) || (location.hash.length > 1 && location.hash !== "#home");
  })();
  if (needsFirebaseNow || (typeof firebase !== "undefined" && firebase.apps)) startFirebaseSdk();
  else {
    ["pointerdown", "keydown", "touchstart", "wheel", "scroll"].forEach((ev) =>
      window.addEventListener(ev, startFirebaseSdk, { once: true, passive: true, capture: true }),
    );
    setTimeout(startFirebaseSdk, 12000);
  }

  /* Analytics loads after the page is interactive so it never delays startup. */
  const loadAnalytics = () => {
    if (location.protocol === "file:" || !firebaseApp || (window.firebase && firebase.analytics)) return;
    const el = document.createElement("script");
    el.src = "https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics-compat.js";
    el.onload = () => { try { firebase.analytics(firebaseApp); } catch {} };
    document.head.appendChild(el);
  };
  if (document.readyState === "complete") setTimeout(loadAnalytics, 1500);
  else window.addEventListener("load", () => setTimeout(loadAnalytics, 1500), { once: true });
});
