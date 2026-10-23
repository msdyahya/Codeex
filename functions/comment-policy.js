"use strict";

const USAGE_KEY = "__codeexUsageV1";
const MAX_POST_COMMENTS = 40;
const MAX_COMMENTS_PER_USER = 2;

function countValue(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function appendComment(current, uid, commentId, comment) {
  const source = current && typeof current === "object" ? current : {};
  const entries = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== USAGE_KEY),
  );
  const storedUsage = source[USAGE_KEY] && typeof source[USAGE_KEY] === "object"
    ? source[USAGE_KEY]
    : {};
  const byUid = storedUsage.byUid && typeof storedUsage.byUid === "object"
    ? { ...storedUsage.byUid }
    : {};
  const observedByUid = {};

  for (const value of Object.values(entries)) {
    if (value && typeof value.uid === "string" && value.uid) {
      observedByUid[value.uid] = (observedByUid[value.uid] || 0) + 1;
    }
  }
  for (const [commenterUid, observedCount] of Object.entries(observedByUid)) {
    byUid[commenterUid] = Math.max(countValue(byUid[commenterUid]), observedCount);
  }

  const total = Math.max(countValue(storedUsage.total), Object.keys(entries).length);
  const userTotal = Math.max(countValue(byUid[uid]), observedByUid[uid] || 0);
  if (total >= MAX_POST_COMMENTS) return { error: "post-limit", total, userTotal };
  if (userTotal >= MAX_COMMENTS_PER_USER) return { error: "user-limit", total, userTotal };
  if (Object.prototype.hasOwnProperty.call(entries, commentId))
    return { error: "duplicate", total, userTotal };

  byUid[uid] = userTotal + 1;
  const next = {
    ...entries,
    [commentId]: comment,
    [USAGE_KEY]: {
      total: total + 1,
      byUid,
    },
  };
  return {
    value: next,
    total: total + 1,
    userTotal: userTotal + 1,
  };
}

module.exports = {
  USAGE_KEY,
  MAX_POST_COMMENTS,
  MAX_COMMENTS_PER_USER,
  appendComment,
};
