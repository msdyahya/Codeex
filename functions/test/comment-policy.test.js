"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { appendComment, USAGE_KEY } = require("../comment-policy");

function comment(uid, n = 1) {
  return { uid, name: `member-${uid}`, text: `comment ${n}`, createdAt: n };
}

test("يسمح بتعليقين للمستخدم نفسه ثم يرفض الثالث", () => {
  const first = appendComment(null, "alice", "push-1", comment("alice", 1));
  assert.equal(first.error, undefined);
  const second = appendComment(first.value, "alice", "push-2", comment("alice", 2));
  assert.equal(second.error, undefined);
  const third = appendComment(second.value, "alice", "push-3", comment("alice", 3));
  assert.equal(third.error, "user-limit");
});

test("يحتسب التعليقات القديمة ذات مفاتيح push قبل تطبيق الحد", () => {
  const legacy = {
    "-old-a": comment("alice", 1),
    "-old-b": comment("alice", 2),
  };
  assert.equal(appendComment(legacy, "alice", "push-new", comment("alice", 3)).error, "user-limit");
  assert.equal(appendComment(legacy, "bob", "push-new", comment("bob", 1)).error, undefined);
});

test("يحفظ الحصة حتى لو حُذفت تعليقات قديمة بعد تسجيل الاستخدام", () => {
  const first = appendComment(null, "alice", "push-1", comment("alice", 1));
  const second = appendComment(first.value, "alice", "push-2", comment("alice", 2));
  const afterModeration = { [USAGE_KEY]: second.value[USAGE_KEY] };
  assert.equal(appendComment(afterModeration, "alice", "push-3", comment("alice", 3)).error, "user-limit");
});

test("يرفض التعليق الحادي والأربعين ويحافظ على التعليقات الحالية", () => {
  const full = {};
  for (let i = 0; i < 40; i++) full[`-legacy-${i}`] = comment(`user-${i}`, i);
  assert.equal(appendComment(full, "new-user", "push-new", comment("new-user")).error, "post-limit");
  assert.equal(Object.keys(full).length, 40);
});

test("يسمح لمستخدم آخر بالتعليق قبل بلوغ حد المنشور", () => {
  const first = appendComment(null, "alice", "push-a", comment("alice"));
  const second = appendComment(first.value, "bob", "push-b", comment("bob"));
  assert.equal(second.error, undefined);
  assert.equal(second.total, 2);
  assert.equal(second.userTotal, 1);
});
