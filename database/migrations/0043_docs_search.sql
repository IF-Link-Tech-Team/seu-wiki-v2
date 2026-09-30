-- 全站搜索扩展到手册/经验：docs 的检索文本（标题 + 描述 + 小节标题 + 正文纯文本，小写）与
-- trigram 索引。由导入脚本维护；这里为已导入的行回填一遍。
ALTER TABLE docs ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';
UPDATE docs SET search_text = lower(
  title || ' ' || coalesce(description, '') || ' ' ||
  coalesce((SELECT string_agg(h->>'text', ' ') FROM jsonb_array_elements(headings) h), '') || ' ' ||
  regexp_replace(html, '<[^>]+>', ' ', 'g'))
WHERE search_text = '';
CREATE INDEX IF NOT EXISTS docs_search_trgm_idx ON docs USING gin (search_text gin_trgm_ops);
