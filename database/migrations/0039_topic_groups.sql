-- 主题分组从 AI 行业的 company/field/genre 换成校园站的 org/college/topic。
-- 旧主题是首次启动时导入的 AI 示例，直接清掉，由 setup 按 industry/topics.json 重新播种。

BEGIN;

DELETE FROM topics;

ALTER TABLE topics DROP CONSTRAINT topics_grp_check;
ALTER TABLE topics ADD CONSTRAINT topics_grp_check CHECK (grp IN ('org', 'college', 'topic'));

COMMIT;
