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
  const profileLink = (uid, name, cls = "author-profile-link") =>
    uid
      ? `<button type="button" class="${cls}" data-action="open-profile" data-uid="${esc(uid)}">${esc(name)}</button>`
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
    return [p.kind, p.title, p.text, p.code, p.codeLanguage]
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

  const MAX_PROJECT_RESOURCE_BYTES = 3 * 1024 * 1024;
  const MAX_DISCUSSION_BYTES = 300 * 1024;
  const PROJECT_RESOURCE_COOLDOWN_MS = 10 * 60 * 1000;
  const isProjectResourceKind = (kind) => ["مشروع", "مورد", "project", "resource"].includes(String(kind || ""));
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
    if (isDiscussion && utf8Bytes(`${p.title || ""}${p.text || ""}${p.code || ""}`) > MAX_DISCUSSION_BYTES)
      throw new AppError(language === "en" ? "A discussion's text and code together cannot exceed 300 KB." : "لا يمكن أن يتجاوز مجموع نص النقاش والكود 300 كيلوبايت.");
    if (isProjectResourceKind(p.kind) && utf8Bytes(p.code || "") > MAX_PROJECT_RESOURCE_BYTES)
      throw new AppError(language === "en" ? "Project/resource code cannot exceed 3 MB." : "لا يمكن أن يتجاوز كود المشروع أو المورد 3 ميجابايت.");
    if (isArticle && selectedCodeFileBase64)
      throw new AppError(language === "en" ? "Articles cannot include an uploaded file." : "لا يمكن إرفاق ملف بالمقالة.");
  }

  async function enforcePublishPolicy(p, isEdit = false) {
    if (!activeUser) throw new AppError("سجّل الدخول أولاً.");
    validatePublishDraft(p, isEdit ? findPost(p.id) : null);
    if (isEdit) return;
    const fp = await sha256(postFingerprint(p));
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
    if (!activeUser) return;
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
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
      avatarUrl: p.avatarUrl || "",
      tone: p.tone || "blue",
      groupId: p.groupId || "",
      fingerprint: p.fingerprint || "",
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

  function stopMembershipWatchers() {
    groupMemberUnsubs.forEach((fn) => fn());
    groupMemberUnsubs = [];
    groupMembersMap = {};
    groupMembershipOverrides = {};
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

  function syncUserState(uid) {
    stopUserWatchers();
    watchUserPath(`users/${uid}/saved`, (v) => {
      savedIds = Object.keys(v).filter((k) => v[k] === true);
      if (!["compose", "messages", "settings"].includes(page)) renderPage();
    });
    watchUserPath(`users/${uid}/notifications`, (v) => {
      noticeItems = Object.values(v);
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
    const first = Object.keys(publicProfiles).find((id) => id !== activeUser.uid);
    const target =
      activeConversation && publicProfiles[activeConversation] ? activeConversation : first;
    if (target && target !== activeConversation) subscribeConversation(target);
  }

  async function publishPost(p) {
    if (!activeUser || !database) throw new AppError("سجّل الدخول أولاً.");
    const isEdit = !!editingPostId;
    await enforcePublishPolicy(p, isEdit);
    const group = p.groupId ? groups.find((g) => g.id === p.groupId) : null;
    const targetPath = group?.visibility === "private"
      ? `groupPosts/${group.id}/${p.id}/data`
      : `posts/${p.id}/data`;
    // Database Rules authorize the authenticated owner and validate the payload.
    // Write only the data node so comments and reactions are left untouched.
    await database.ref(targetPath).set(postData(p));
    if (!isEdit) commitPublishPolicy(p);
  }

  async function addNotification(targetUid, note) {
    if (!activeUser || !targetUid || targetUid === activeUser.uid) return;
    const r = database.ref(`users/${targetUid}/notifications`).push();
    await r.set({ ...note, id: r.key, actorUid: activeUser.uid, read: false, time: Date.now() });
  }

  async function addComment(postId, text) {
    if (!activeUser) throw new AppError("سجّل الدخول لإضافة تعليق.");
    const p = findPost(postId);
    if (!p) throw new AppError("المنشور غير متاح حالياً.");
    const r = database.ref(`${postRootPath(p)}/comments`).push();
    await r.set({ uid: activeUser.uid, name: activeUser.name, text, createdAt: Date.now() });
    if (p.uid !== activeUser.uid) {
      try {
        await addNotification(p.uid, {
          postId,
          commentId: r.key,
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
        groupRequestData = {};
        groupPendingStatus = {};
        groupRequestUnsubs.forEach((fn) => fn());
        groupRequestUnsubs = [];
        stopPrivateGroupWatchers();
        activeConversation = "";
        activeMessages = [];
        renderFrame();
        if (pendingSharedPostId) {
          authForm("login");
          setAuthInfo("يلزم تسجيل الدخول لفتح المنشور.");
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
      `<section class="panel profile-card"><div class="profile-top"><span class="avatar blue">${avatarContent(user)}</span><div><div class="profile-name">مرحباً ${esc(user.name || "")}</div><div class="profile-sub">مجتمع المطورين العرب</div></div></div><div class="profile-stats"><div><b>${myPosts}</b><span>مساهمة</span></div><div><b>${memberCount}</b><span>أعضاء</span></div><div><b>${groupCount}</b><span>مجموعة</span></div></div><button class="outline-wide" data-page="profile">${icon("user")}ملفي الشخصي</button></section><nav class="panel side-nav">${SIDE.map(([ic, label, id]) => `<button data-page="${id}" class="${page === id ? "active" : ""}">${icon(ic)}<span>${label}</span>${id === "notifications" && noticeItems.filter((n) => !n.read).length ? `<span class="nav-count">${noticeItems.filter((n) => !n.read).length}</span>` : ""}</button>`).join("")}<button data-page="resources">${icon("resource")}<span>الموارد والمسارات</span></button></nav><section class="panel side-cta"><div class="crown">⌘</div><h3>شارك معرفتك</h3><p>شارك فكرة أو مشروعاً ليستفيد منهما المطورون.</p><button class="btn primary small" data-page="compose">ابدأ المشاركة</button></section>`,
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

  function highlightCodeLine(line, language = "javascript") {
    const keywords = new Set(
      "abstract as async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch this throw try type typeof var void while with yield def lambda pass raise self True False None print import from as for in if elif else try except class return yield async await match case fn pub mod use impl struct enum trait mut let const static crate super return match loop while break continue fallthrough package func defer go chan select map range type var import interface nil true false null undefined NaN new throw extends constructor instanceof typeof void delete debugger with this super default export from as async await await".split(
        /\s+/,
      ),
    );
    const re =
      /\/\/.*$|\/\*.*?\*\/|--.*$|#.*$|\x3c!--.*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
    let out = "",
      last = 0,
      m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index));
      const t = m[0];
      let cls = "";
      if (
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("--") ||
        t.startsWith("#") ||
        t.startsWith("\x3c!--")
      )
        cls = "syn-comment";
      else if (/^['"`]/.test(t)) cls = "syn-string";
      else if (/^\d/.test(t)) cls = "syn-number";
      else if (keywords.has(t)) cls = "syn-key";
      else if (/[A-Za-z_$][\w$]*$/.test(t) && /^\s*\(/.test(line.slice(re.lastIndex)))
        cls = "syn-function";
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
      last = re.lastIndex;
    }
    return out + esc(line.slice(last));
  }

  function codeWindow(code, language = "javascript", filename = "", postId = "") {
    const lang = String(language || "javascript").toLowerCase();
    const extMap = {
      javascript: "js",
      js: "js",
      jsx: "jsx",
      typescript: "ts",
      ts: "ts",
      tsx: "tsx",
      python: "py",
      py: "py",
      html: "html",
      css: "css",
      json: "json",
      java: "java",
      php: "php",
      go: "go",
      rust: "rs",
      rs: "rs",
      c: "c",
      cpp: "cpp",
      csharp: "cs",
      sql: "sql",
      bash: "sh",
      shell: "sh",
    };
    const file = filename || `snippet.${extMap[lang] || "txt"}`;
    const raw = String(code || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .slice(0, 180);
    return `<section class="vscode-window" aria-label="مقطع كود ${esc(file)}"><div class="vs-head"><span class="vs-dots"><i></i><i></i><i></i></span><div class="vs-tab"><span class="vs-file-icon">◆</span>${esc(file)}</div><span class="vs-lang">${esc(lang)}</span>${postId ? `<button class="vs-copy" data-action="copy-code" data-id="${esc(postId)}">نسخ الكود</button>` : ""}</div><div class="vs-code">${raw.map((line, i) => `<div class="vs-line"><span class="vs-no">${i + 1}</span><span class="vs-src">${highlightCodeLine(line, lang) || "&nbsp;"}</span></div>`).join("")}</div></section>`;
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
    return `<article class="panel post" data-post="${esc(p.id)}"><div class="post-header"><span class="avatar ${esc(p.tone || "blue")}"${p.uid ? ` data-action="open-profile" data-uid="${esc(p.uid)}"` : ""}>${avatarContent(author)}</span><div class="post-ident"><strong>${profileLink(p.uid, author.name || p.name)}</strong> <span class="kind-pill ${p.kind === "سؤال" ? "question" : p.kind === "مقالة" ? "article" : ""}">${esc(p.kind || "نقاش")}</span><div class="post-meta" dir="rtl">@${esc(author.handle || p.handle || "member")} · ${timeAgo(p.createdAt || Date.now())}</div></div><button class="post-menu" data-action="post-menu" data-id="${esc(p.id)}" title="المزيد">${icon("dots")}</button></div>${p.title ? `<h3 class="post-title">${esc(p.title)}</h3>` : ""}${postTextPreview(p)}${p.code ? codeWindow(p.code, p.codeLanguage, p.fileName, p.id) : ""}<div class="post-tags">${(p.tags || []).map((t) => `<button class="tag" data-action="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div><div class="post-footer"><button class="post-action like ${liked ? "active" : ""}" data-action="like" data-id="${esc(p.id)}">${icon("heart")}<span>${Number(p.likes || 0)}</span></button><button class="post-action" data-action="comment" data-id="${esc(p.id)}">${icon("comment")}<span>${(p.comments || []).length}</span></button><button class="post-action ${saved ? "active" : ""}" data-action="save" data-id="${esc(p.id)}">${icon("bookmark")}<span>${saved ? "محفوظ" : "حفظ"}</span></button><button class="post-action" data-action="share" data-id="${esc(p.id)}">${icon("share")}<span>مشاركة</span></button><button class="post-action more" data-action="expand" data-id="${esc(p.id)}">عرض المزيد ${icon("arrow")}</button></div></article>`;
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
                : g.visibility === "private"
                  ? `<button class="btn ${pending ? "soft" : ""}" data-action="join" data-id="${esc(g.id)}" ${pending ? "disabled" : ""}>${pending ? "طلبك قيد المراجعة" : "طلب الانضمام"}</button>`
                  : `<button class="btn" data-action="join" data-id="${esc(g.id)}">انضمام إلى المجموعة</button>`;
              return `<article class="panel feature-card group-card"><div class="group-card-head"><div class="feature-icon">${icon("groups")}</div><span class="group-visibility ${g.visibility}">${g.visibility === "private" ? icon("lock") + " خاصة" : "عامّة"}</span></div><h3>${esc(g.name)}</h3><p>${esc(g.description || "مجموعة أنشأها عضو في المجتمع.")}</p><div class="metric-row"><span>${icon("user")} ${esc(publicProfiles[g.ownerUid]?.name || "عضو")}</span><span>${g.visibility === "public" ? "تظهر منشوراتها في الرئيسية" : "منشوراتها للأعضاء فقط"}</span></div><div class="group-buttons">${button}</div>${g.ownerUid === activeUser?.uid && g.visibility === "private" ? `<div class="group-requests"><strong>طلبات الانضمام ${requests.length ? `(${requests.length})` : ""}</strong>${requests.length ? requests.map((r) => `<div class="group-request-row"><span>${esc(r.name || "عضو")}</span><div><button class="btn small primary" data-action="approve-group" data-group="${esc(g.id)}" data-user="${esc(r.uid)}">قبول</button> <button class="btn small ghost" data-action="reject-group" data-group="${esc(g.id)}" data-user="${esc(r.uid)}">رفض</button></div></div>`).join("") : '<p class="muted">لا توجد طلبات معلّقة.</p>'}</div>` : ""}</article>`;
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
      : g.visibility === "public"
        ? `<button class="btn primary" data-action="join" data-id="${esc(g.id)}">انضم لرؤية منشورات المجموعة</button>`
        : `<button class="btn primary" data-action="join" data-id="${esc(g.id)}" ${groupPendingStatus[g.id] ? "disabled" : ""}>${groupPendingStatus[g.id] ? "طلبك قيد المراجعة" : "اطلب الانضمام"}</button>`;
    return `${pageHeader(g.name, `${g.visibility === "private" ? "مجموعة خاصة — المنشورات للأعضاء المقبولين فقط" : "مجموعة عامة — منشوراتها تظهر في الرئيسية"}`, `<button class="btn ghost" data-page="groups">العودة للمجموعات</button>`)}<section class="panel group-detail-intro"><div class="group-card-head"><span class="feature-icon">${icon("groups")}</span><span class="group-visibility ${g.visibility}">${g.visibility === "private" ? "خاصة" : "عامّة"}</span></div><p>${esc(g.description || "")}</p>${intro}</section>${member ? (posts.length ? posts.map(postCard).join("") : '<div class="panel empty-state">لا توجد منشورات في هذه المجموعة بعد.</div>') : `<div class="panel empty-state"><b>${g.visibility === "private" ? "محتوى المجموعة خاص" : "انضم إلى المجموعة"}</b><p>${g.visibility === "private" ? "لا تظهر منشورات المجموعة الخاصة قبل قبول طلبك." : "انضم لعرض المشاركات وكتابتها."}</p>${intro}</div>`}`;
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
    return `${pageHeader(language === "en" ? "Notifications" : "إشعاراتي", language === "en" ? "New activity and messages from the community." : "تابع التفاعلات والرسائل الجديدة في مجتمعك.", '<button class="btn" data-action="read-all">' + (language === "en" ? "Mark all read" : "تحديد الكل كمقروء") + '</button>')}<section class="panel">${notes.length ? notes.map((n) => `<div class="notice-item" role="button" tabindex="0" data-action="notification-click" data-id="${esc(n.id || "")}" style="${n.read ? "opacity:.68" : ""}"><span class="notice-icon">${icon(n.type === "heart" || n.type === "like" ? "heart" : n.type === "comment" || n.type === "message" ? "comment" : "bell")}</span><div><p>${esc(n.text)}</p><small>${timeAgo(n.time)} ${n.read ? "" : "· جديد"}</small></div></div>`).join("") : `<div class="empty-state">${empty}</div>`}</section>`;
  }

  function renderMessages() {
    const user = currentUser();
    if (!user)
      return `${pageHeader("الرسائل", "سجّل الدخول للتواصل مع أعضاء المجتمع.", "")}<div class="panel empty-state"><b>المحادثات خاصة بأصحاب الحسابات</b><button class="btn primary" data-auth="login">تسجيل الدخول</button></div>`;
    const people = Object.values(publicProfiles).filter((p) => p.uid !== user.uid);
    if (!people.length)
      return `${pageHeader("الرسائل", "تواصل مع أعضاء مجتمع Codeex.", "")}<div class="panel empty-state"><b>لا يوجد أعضاء مسجلون بعد</b>ستظهر المحادثات هنا بعد انضمام الأعضاء.</div>`;
    const chat = people.find((x) => x.uid === activeConversation) || people[0];
    const messages = chat.uid === activeConversation ? activeMessages : [];
    return `${pageHeader("الرسائل", "محادثات مباشرة بين أعضاء Codeex المسجلين.", "")}<section class="panel messages-layout"><div class="conversation-list">${people.map((c) => `<button class="conversation ${c.uid === chat.uid ? "active" : ""}" data-action="conversation" data-id="${esc(c.uid)}"><span class="avatar small teal">${avatarContent(c)}</span><span><strong>${esc(c.name || "مطور")}</strong><small>@${esc(c.handle || "member")}</small></span></button>`).join("")}</div><div class="chat"><div class="chat-head">${profileLink(chat.uid, chat.name || "مطور")} <small class="muted" dir="ltr">@${esc(chat.handle || "member")}</small></div><div class="chat-body" id="chatBody">${messages.map((m) => `<div class="bubble ${m.uid === user.uid ? "own" : ""}">${esc(m.text)}</div>`).join("") || '<div class="muted">ابدأ المحادثة برسالة ترحيب.</div>'}</div><form class="chat-form" id="chatForm" data-to="${esc(chat.uid)}"><input class="field" id="chatInput" maxlength="1000" placeholder="اكتب رسالة..." required><button class="btn primary" type="submit">إرسال</button></form></div></section>`;
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
    return `<section class="panel profile-cover"><div class="profile-cover-content"><div class="profile-avatar-wrap"><span class="avatar blue profile-avatar">${avatarContent(user)}</span>${isOwn ? '<label for="profileAvatar" class="avatar-edit" title="تغيير صورة الملف">✎</label><input id="profileAvatar" type="file" accept="image/png,image/jpeg,image/webp" hidden>' : ""}</div><div class="profile-details"><span class="pill">مطور في مجتمع Codeex</span><h1>${esc(user.name || "مطور")}</h1><div class="profile-handle">@${esc(user.handle || "developer")}</div><p class="profile-bio">${esc(user.bio || "لم يضف نبذة شخصية بعد.")}</p><div class="profile-meta">${joined ? `<span>${icon("calendar")} عضو منذ ${joined}</span>` : ""}</div></div>${isOwn ? `<button class="btn profile-cover-action" data-page="settings">${icon("settings")} تعديل الملف</button>` : `<div class="profile-cover-actions"><button class="btn primary" data-action="message-user" data-uid="${esc(user.uid)}">${icon("comment")} مراسلة</button><button class="btn" data-page="home">العودة</button></div>`}</div></section><section class="panel profile-summary"><div class="profile-stat"><b>${projects.length}</b><span>مشروع</span></div><div class="profile-stat"><b>${mine.length}</b><span>مساهمة</span></div><div class="profile-stat"><b>${articles.length}</b><span>مقالة</span></div></section><div class="profile-tabs"><button class="profile-tab ${profileTab === "projects" ? "active" : ""}" data-action="profile-tab" data-tab="projects">${icon("project")} المشاريع (${projects.length})</button><button class="profile-tab ${profileTab === "posts" ? "active" : ""}" data-action="profile-tab" data-tab="posts">${icon("file")} المنشورات</button><button class="profile-tab ${profileTab === "articles" ? "active" : ""}" data-action="profile-tab" data-tab="articles">${icon("article")} المقالات (${articles.length})</button>${isOwn ? `<button class="profile-tab ${profileTab === "saved" ? "active" : ""}" data-action="profile-tab" data-tab="saved">${icon("bookmark")} المحفوظات (${savedPosts.length})</button>` : ""}</div><div id="profileContent">${content}</div>`;
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
    const cap = article ? MAX_PROJECT_RESOURCE_BYTES : discussion ? MAX_DISCUSSION_BYTES : MAX_PROJECT_RESOURCE_BYTES;
    if (code) code.maxLength = cap;
    if (hint) hint.textContent = article
      ? (language === "en" ? "Articles: up to 1,000 words; file uploads are disabled." : "المقالة: حتى 1000 كلمة؛ رفع الملفات غير متاح.")
      : discussion
        ? (language === "en" ? "Discussion text/code total: up to 300 KB." : "النقاش: مجموع النص والكود حتى 300 كيلوبايت.")
        : (language === "en" ? `Project/resource code: up to 3 MB; one uploaded file every 7 days; 10 minutes between posts.` : "المشروع/المورد: كود حتى 3 ميجابايت، ملف واحد كل 7 أيام، وفاصل 10 دقائق بين المنشورات.");
    if (article && selectedCodeFileBase64) clearSelectedCodeFile(true);
    else if (selectedCodeFileBytes > 0 && selectedCodeFileBytes > (discussion ? MAX_DISCUSSION_BYTES : MAX_PROJECT_RESOURCE_BYTES)) clearSelectedCodeFile(true);
  }

  function renderCompose() {
    const user = currentUser();
    if (!user)
      return `${pageHeader("المشاركة في Codeex", "سجّل الدخول أولاً لتتمكن من النشر.", "")}<div class="panel empty-state"><b>تحتاج إلى حساب للمشاركة</b><button class="btn primary" data-auth="register">إنشاء حساب</button></div>`;
    return `${pageHeader("إنشاء مشاركة", "شارك فكرة أو مقالة أو مشروعاً مع المطورين العرب.", "")}<section class="panel"><form class="form-grid" id="publishForm"><label>نوع المشاركة<select class="field" id="publishKind"><option>نقاش</option><option>مقالة</option><option>مورد</option><option>مشروع</option></select></label><label>مكان النشر<select class="field" id="publishGroup"><option value="">المجتمع العام — يظهر المنشور في الرئيسية</option>${groups
      .filter((g) => g.visibility === "public" || isGroupMember(g))
      .map((g) => `<option value="${esc(g.id)}">${esc(g.name)} — ${g.visibility === "private" ? "خاص" : "عام"}</option>`).join("")}</select></label><label>العنوان (اختياري للنقاش)<input class="field" id="publishTitle" maxlength="140" placeholder="عنوان واضح ومفيد"></label><label>التفاصيل<textarea class="field" id="publishText" maxlength="307200" placeholder="اكتب ما تريد مشاركته..." required></textarea></label><div><strong style="display:block;font-size:12px;color:#67758b">مقطع كود (اختياري)</strong><div style="display:flex;gap:8px;align-items:center;margin:5px 0 8px"><select class="field" id="publishLanguage" style="margin:0;max-width:180px"><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="html">HTML</option><option value="css">CSS</option><option value="json">JSON</option><option value="java">Java</option><option value="php">PHP</option><option value="go">Go</option><option value="rust">Rust</option><option value="sql">SQL</option><option value="bash">Bash</option></select><label class="btn small" id="codeFileLabel" for="codeFile">اختيار ملف كود</label><input id="codeFile" type="file" accept=".js,.jsx,.ts,.tsx,.py,.html,.css,.json,.java,.php,.go,.rs,.c,.cpp,.cs,.sql,.sh,.txt" hidden></div><input id="codeFilename" type="hidden"><textarea class="code-editor" id="publishCode" maxlength="3145728" placeholder="الصق الكود هنا أو اختر ملفاً من جهازك"></textarea><small class="muted" id="publishPolicyHint"></small><br><small class="muted"></small></div><label>وسوم مفصولة بفاصلة<input class="field" id="publishTags" placeholder="React, JavaScript"></label><div class="modal-actions"><button class="btn" type="button" data-page="home">إلغاء</button><button class="btn primary" type="submit">نشر المشاركة</button></div></form></section>`;
  }

  function renderSearch() {
    const arr = allPosts();
    return `${pageHeader(`نتائج البحث: ${esc(searchTerm)}`, "المنشورات المطابقة في مجتمع Codeex.", "")} ${arr.length ? arr.map(postCard).join("") : '<div class="panel empty-state"><b>لم نجد نتائج</b>جرّب كلمات بحث مختلفة.</div>'}`;
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
    view.innerHTML = localizeMarkup(html);
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
        if (groupSelect) groupSelect.value = pendingGroupId;
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
      if (g.visibility === "private") {
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
        .ref(`groupMembers/${g.id}/${activeUser.uid}`)
        .set(true)
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
    if (action === "comment") {
      if (!requireUser()) return;
      const p = findPost(act.dataset.id);
      if (!p) return;
      openModal(
        "التعليقات",
        `<div class="comments-list" aria-live="polite">${(p.comments || []).map((c) => `<article class="comment-card"><span class="avatar"${c.uid ? ` data-action="open-profile" data-uid="${esc(c.uid)}"` : ""}>${avatarContent(c)}</span><div class="comment-content"><div class="comment-head"><strong>${profileLink(c.uid, personName(c) || "عضو")}</strong><time>${timeAgo(c.createdAt || Date.now())}</time></div><p class="comment-body">${esc(c.text)}</p></div></article>`).join("") || '<p class="muted">لا توجد تعليقات بعد. كن أول من يشارك رأيه.</p>'}</div><form id="commentForm" class="comment-composer"><input type="hidden" id="commentPostId" value="${esc(p.id)}"><textarea class="field" id="commentText" maxlength="400" placeholder="اكتب تعليقاً واضحاً ومحترماً..." required></textarea><div class="modal-actions"><button class="btn primary" type="submit">إرسال التعليق</button></div></form>`,
      );
      document.querySelector("#modalBackdrop .modal").classList.add("comments-modal");
      return;
    }
    if (action === "expand" || action === "read-post") {
      const p = findPost(act.dataset.id);
      if (!p) return;
      openModal(
        p.title || "تفاصيل المشاركة",
        `<div class="post-header"><span class="avatar ${esc(p.tone || "blue")}"${p.uid ? ` data-action="open-profile" data-uid="${esc(p.uid)}"` : ""}>${avatarContent({ ...p, ...(publicProfiles[p.uid] || {}) })}</span><div class="post-ident"><strong>${profileLink(p.uid, personName(p))}</strong><div class="post-meta">${timeAgo(p.createdAt)}</div></div></div><p class="post-text">${renderPostTextWithLinks(p.text)}</p>${p.code ? codeWindow(p.code, p.codeLanguage, p.fileName, p.id) : ""}<div class="post-tags">${(p.tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join("")}</div><div class="divider"></div><p class="muted">${(p.comments || []).length} تعليق · ${p.likes || 0} إعجاب</p>`,
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
        v("#publishTitle", p.title);
        v("#publishText", p.text);
        v("#publishLanguage", p.codeLanguage);
        v("#publishCode", p.code);
        v("#codeFilename", p.fileName);
        v("#publishTags", (p.tags || []).join(", "));
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
      const shareUrl = new URL("/", location.origin);
      shareUrl.searchParams.set("post", act.dataset.id);
      if (post?.privateGroupId) shareUrl.searchParams.set("group", post.privateGroupId);
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
      if (!note.read) database.ref(`users/${activeUser.uid}/notifications/${note.id}/read`).set(true).catch(handleError);
      if (note.type === "message" && note.actorUid && publicProfiles[note.actorUid]) {
        subscribeConversation(note.actorUid);
        navigate("messages");
      }
      return;
    }
    if (action === "read-all") {
      if (!requireUser()) return;
      Store.setNotices(Store.notices().map((n) => ({ ...n, read: true })));
      renderPage();
      toast("تم تحديد الإشعارات كمقروءة");
      return;
    }
    if (action === "conversation") {
      subscribeConversation(act.dataset.id);
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
        kind,
        title: document.querySelector("#publishTitle").value.trim(),
        text,
        code: document.querySelector("#publishCode").value.trim(),
        codeLanguage: document.querySelector("#publishLanguage").value,
        fileName: document.querySelector("#codeFilename").value.trim(),
        fileSize: selectedCodeFileBytes,
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
    if (e.target.id !== "publishCode" || !selectedCodeFileBase64) return;
    if (e.target.value !== selectedCodeFileText) {
      clearSelectedCodeFile(false);
      const name = document.querySelector("#codeFilename");
      if (name) name.value = "";
      toast(language === "en" ? "Code edited; select the file again to publish it as an upload." : "عدّلت الكود؛ أعد اختيار الملف إن أردت نشره كمرفق.");
    }
  });

  document.querySelector("#pageView").addEventListener("change", async (e) => {
    if (e.target.id === "publishKind") {
      updateComposePolicyUI();
      return;
    }
    const input = e.target;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (input.id === "codeFile") {
      const kind = document.querySelector("#publishKind")?.value || "نقاش";
      const maxBytes = kind === "مقالة" ? 0 : kind === "نقاش" ? MAX_DISCUSSION_BYTES : MAX_PROJECT_RESOURCE_BYTES;
      if (kind === "مقالة") {
        toast(language === "en" ? "Articles cannot include an uploaded file." : "لا يمكن إرفاق ملف بالمقالة.");
        input.value = "";
        return;
      }
      if (file.size > maxBytes) {
        toast(kind === "نقاش"
          ? (language === "en" ? "A discussion file cannot exceed 300 KB." : "لا يمكن أن يتجاوز ملف النقاش 300 كيلوبايت.")
          : (language === "en" ? "Project/resource files cannot exceed 3 MB." : "لا يمكن أن يتجاوز ملف المشروع أو المورد 3 ميجابايت."));
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

  connectServices();

  if (!firebaseAuthStarted) {
    let tries = 0;
    const sdkRetry = setInterval(() => {
      if (connectServices()) {
        clearInterval(sdkRetry);
        return;
      }
      if (++tries >= 100) {
        clearInterval(sdkRetry);
        const w = document.querySelector("#sdkWarning");
        if (w) w.textContent = "تعذّر تحميل الموقع. تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.";
      }
    }, 100);
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
