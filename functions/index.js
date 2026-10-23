"use strict";

const { getApps, initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { appendComment, USAGE_KEY } = require("./comment-policy");

const DATABASE_URL = "https://codna-f8612-default-rtdb.europe-west1.firebasedatabase.app";
const REGION = "europe-west1";
const app = getApps().length ? getApps()[0] : initializeApp({ databaseURL: DATABASE_URL });
const database = getDatabase(app);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

exports.addComment = onCall(
  { region: REGION, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "سجّل الدخول لإضافة تعليق.");
    if (request.auth.token.email_verified !== true)
      throw new HttpsError("permission-denied", "تحقق من بريدك الإلكتروني أولاً.");

    const payload = request.data && typeof request.data === "object" ? request.data : {};
    const postId = typeof payload.postId === "string" ? payload.postId : "";
    const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!SAFE_ID.test(postId) || (groupId && !SAFE_ID.test(groupId)))
      throw new HttpsError("invalid-argument", "معرّف المنشور غير صالح.");
    if (!text || text.length > 400 || (text.match(/\n/g) || []).length > 4)
      throw new HttpsError("invalid-argument", "يجب أن يكون التعليق بين حرف واحد و400 حرف، وبحد أقصى خمسة أسطر.");

    const banned = await database.ref(`bannedUsers/${uid}`).get();
    if (banned.exists())
      throw new HttpsError("permission-denied", "لا يمكن لهذا الحساب إضافة تعليقات حالياً.");

    let postPath;
    if (groupId) {
      const [groupSnapshot, membershipSnapshot] = await Promise.all([
        database.ref(`groups/${groupId}`).get(),
        database.ref(`groupMembers/${groupId}/${uid}`).get(),
      ]);
      const group = groupSnapshot.val();
      if (!group || group.visibility !== "private")
        throw new HttpsError("permission-denied", "المجموعة الخاصة غير متاحة.");
      if (group.ownerUid !== uid && membershipSnapshot.val() !== true)
        throw new HttpsError("permission-denied", "يجب أن تكون عضواً مقبولاً في المجموعة للتعليق.");
      postPath = `groupPosts/${groupId}/${postId}`;
    } else {
      postPath = `posts/${postId}`;
    }

    const postSnapshot = await database.ref(`${postPath}/data`).get();
    if (!postSnapshot.exists())
      throw new HttpsError("not-found", "المنشور غير متاح للتعليق.");

    const profileSnapshot = await database.ref(`profiles/${uid}`).get();
    const profile = profileSnapshot.val() || {};
    const profileName = typeof profile.name === "string" ? profile.name.trim() : "";
    const tokenName = typeof request.auth.token.name === "string" ? request.auth.token.name.trim() : "";
    const name = (profileName || tokenName || "عضو Codeex").slice(0, 50);
    const comment = { uid, name, text, createdAt: Date.now() };
    const commentsRef = database.ref(`${postPath}/comments`);
    const commentId = commentsRef.push().key;
    if (!commentId) throw new HttpsError("internal", "تعذّر تجهيز التعليق.");

    let policyError = "";
    const transaction = await commentsRef.transaction((current) => {
      const result = appendComment(current, uid, commentId, comment);
      policyError = result.error || "";
      return result.value;
    });

    if (!transaction.committed) {
      if (policyError === "post-limit")
        throw new HttpsError("resource-exhausted", "وصل المنشور إلى الحد الأقصى وهو 40 تعليقاً.");
      if (policyError === "user-limit")
        throw new HttpsError("resource-exhausted", "يمكن لكل شخص إضافة تعليقين فقط على المنشور نفسه.");
      if (policyError === "duplicate")
        throw new HttpsError("already-exists", "تعذّر حفظ التعليق بسبب تعارض؛ حاول مرة أخرى.");
      throw new HttpsError("aborted", "تغيّرت التعليقات أثناء الحفظ؛ حاول مرة أخرى.");
    }

    const usage = transaction.snapshot.child(USAGE_KEY).val() || {};
    return {
      commentId,
      comment,
      totalCount: Number(usage.total) || 0,
      userCommentCount: Number(usage.byUid?.[uid]) || 0,
    };
  },
);
