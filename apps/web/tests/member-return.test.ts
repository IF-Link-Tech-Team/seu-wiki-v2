import assert from "node:assert/strict";
import { test } from "node:test";
import { memberReturnPath } from "../app/features/member/member-return.ts";

test("global account entry preserves pathname and query", () => {
  assert.equal(memberReturnPath("/all", "?q=%E4%BF%9D%E7%A0%94&page=2"), "/all?q=%E4%BF%9D%E7%A0%94&page=2");
  assert.equal(memberReturnPath("/items/example", ""), "/items/example");
  assert.equal(memberReturnPath("/subscription", ""), "/subscription");
});
