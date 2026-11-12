import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMpHistory, parseMpArticle } from "@aihot/backend/providers/dajiala";

test("Dajiala real history schema preserves source identity, time, and all articles in one send", () => {
  const parsed = parseMpHistory({ code: 0, AccountInfo: { NickName: "测试学院", UserName: "gh_test" }, MsgList: { Msg: [
    { BaseInfo: { DateTime: 1700000000 }, AppMsg: { DetailInfo: [
      { Title: "次条", ContentUrl: "https://mp.weixin.qq.com/s/two", ItemIndex: 2, send_time: 1700000001 },
      { Title: "头条", ContentUrl: "https://mp.weixin.qq.com/s/one", ItemIndex: 1, CoverImgUrl: "https://mmbiz.qpic.cn/cover.jpg" },
    ] } },
  ] }, remain_money: 4 }, "测试学院");
  assert.equal(parsed.ghid, "gh_test");
  assert.equal(parsed.posts.length, 2);
  assert.equal(parsed.posts[0]!.post_time, 1700000001);
  assert.equal(parsed.posts[1]!.cover_url, "https://mmbiz.qpic.cn/cover.jpg");
  assert.throws(() => parseMpHistory({ code: 0, AccountInfo: { NickName: "同名误匹配" }, MsgList: { Msg: [] } }, "测试学院"), /account mismatch/);
});

test("Dajiala detail keeps HTML and image list independently of plain text", () => {
  const parsed = parseMpArticle({ code: 0, content: "纯文本", content_multi_text: '<p>纯文本<img data-src="https://mmbiz.qpic.cn/a.png"></p>',
    nick_name: "测试学院", user_name: "gh_test", cdn_url: "https://mmbiz.qpic.cn/cover.png",
    picture_page_info_list: [{ cdn_url: "https://mmbiz.qpic.cn/a.png", width: 100, height: 200 }],
  }, "测试学院");
  assert.equal(parsed.content, "纯文本");
  assert.match(parsed.contentHtml!, /img/);
  assert.equal(parsed.images[0]!.width, 100);
  assert.equal(parsed.coverUrl, "https://mmbiz.qpic.cn/cover.png");
  assert.throws(() => parseMpArticle({ code: 0, nick_name: "误匹配" }, "测试学院"), /account mismatch/);
});

test("Dajiala missing/nonzero status never becomes successful empty content", () => {
  assert.throws(() => parseMpHistory({}, "测试学院"), /invalid status/);
  assert.throws(() => parseMpArticle({ code: 101 }), /code 101/);
  assert.throws(() => parseMpArticle({ code: null }), /invalid status/);
  assert.throws(() => parseMpArticle({ code: "" }), /invalid status/);
  assert.throws(() => parseMpArticle({ code: false }), /invalid status/);
});
