const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();
const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const MAX = { name: 50, handle: 40, kind: 20, title: 140, text: 5000, code: 20000, language: 30, file: 120 };

function clean(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}
function validPost(p) {
  return p && typeof p === 'object' && clean(p.text, MAX.text).length > 0 &&
    clean(p.name, MAX.name).length > 0 && clean(p.handle, MAX.handle).length > 0;
}
function normalisePost(p, uid, old = null) {
  const tags = Array.isArray(p.tags) ? p.tags.slice(0, 5).map(x => clean(x, 40)).filter(Boolean) : [];
  return {
    uid,
    name: clean(p.name, MAX.name),
    handle: clean(p.handle, MAX.handle),
    kind: clean(p.kind || 'نقاش', MAX.kind),
    title: clean(p.title, MAX.title),
    text: clean(p.text, MAX.text),
    code: clean(p.code, MAX.code),
    codeLanguage: clean(p.codeLanguage || 'javascript', MAX.language),
    fileName: clean(p.fileName, MAX.file),
    tags,
    avatarUrl: '',
    tone: clean(p.tone || 'blue', 20),
    groupId: clean(p.groupId, 128),
    fingerprint: clean(p.fingerprint, 128),
    createdAt: old?.createdAt || Date.now()
  };
}

exports.publishPost = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.email_verified !== true) {
    throw new functions.https.HttpsError('permission-denied', 'يجب توثيق البريد الإلكتروني أولاً.');
  }
  const uid = context.auth.uid;
  const input = data?.post;
  const isEdit = data?.isEdit === true;
  if (!validPost(input) || !clean(input.id, 128)) {
    throw new functions.https.HttpsError('invalid-argument', 'بيانات المنشور غير صالحة.');
  }

  const postId = clean(input.id, 128);
  const groupId = clean(input.groupId, 128);
  let group = null;
  if (groupId) {
    const snap = await db.ref(`groups/${groupId}`).once('value');
    group = snap.val();
    if (!group || (group.visibility === 'private' && group.ownerUid !== uid && (await db.ref(`groupMembers/${groupId}/${uid}`).once('value')).val() !== true)) {
      throw new functions.https.HttpsError('permission-denied', 'لا تملك صلاحية النشر في هذه المجموعة.');
    }
  }
  const root = group?.visibility === 'private' ? `groupPosts/${groupId}/${postId}` : `posts/${postId}`;
  const oldSnap = await db.ref(`${root}/data`).once('value');
  const old = oldSnap.val();
  if (isEdit) {
    if (!old || old.uid !== uid) throw new functions.https.HttpsError('permission-denied', 'لا يمكنك تعديل هذا المنشور.');
    const next = normalisePost(input, uid, old);
    await db.ref(`${root}/data`).set(next);
    return { id: postId, edited: true };
  }
  if (old) throw new functions.https.HttpsError('already-exists', 'معرّف المنشور مستخدم بالفعل.');

  const now = Date.now();
  const limitRef = db.ref(`postLimits/${uid}`);
  const reservation = await limitRef.transaction(state => {
    state = state || { lastPublishedAt: 0, strikes: 0, bannedUntil: 0 };
    if (Number(state.bannedUntil) > now) return; // abort
    if (Number(state.lastPublishedAt) && now - Number(state.lastPublishedAt) < TEN_MINUTES) return;
    return { ...state, pendingAt: now };
  });
  if (!reservation.committed) throw new functions.https.HttpsError('failed-precondition', 'يمكنك نشر مشاركة واحدة كل 10 دقائق فقط.');

  const fp = clean(input.fingerprint, 128);
  const fingerprintRef = db.ref(`postFingerprints/${uid}/${fp || postId}`);
  const fpTx = await fingerprintRef.transaction(value => value || { postId, createdAt: now });
  if (!fpTx.committed || (fpTx.snapshot.val()?.postId !== postId && fpTx.snapshot.val()?.postId)) {
    await limitRef.transaction(state => ({ ...(state || {}), lastPublishedAt: 0, pendingAt: null, strikes: Number(state?.strikes || 0) + 1, bannedUntil: Number(state?.strikes || 0) + 1 >= 3 ? now + DAY : 0 }));
    throw new functions.https.HttpsError('already-exists', 'هذا المنشور مكرر.');
  }

  const next = normalisePost(input, uid);
  await db.ref(`${root}/data`).set(next);
  await limitRef.update({ lastPublishedAt: now, pendingAt: null });
  return { id: postId, edited: false };
});
