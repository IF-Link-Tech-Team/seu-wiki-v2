-- Preserve whether a source supplied a calendar day or an actual clock time.
-- Existing rows are unknown because the old schema already discarded that distinction.
ALTER TABLE articles
  ADD COLUMN published_at_precision text NOT NULL DEFAULT 'unknown'
  CHECK (published_at_precision IN ('day', 'minute', 'second', 'unknown'));

ALTER TABLE publications
  ADD COLUMN published_at_precision text NOT NULL DEFAULT 'unknown'
  CHECK (published_at_precision IN ('day', 'minute', 'second', 'unknown'));

-- PR #10's four sources expose calendar dates only. Marking their existing rows explicitly
-- lets the new UI remove the misleading 00:00 immediately after migration.
UPDATE articles a
SET published_at_precision = 'day'
WHERE a.source_id IN ('wjx-xjxxx', 'wjx-dsjl', 'futuretech-56660', 'futuretech-kwyx')
  AND a.published_at IS NOT NULL;

UPDATE publications p
SET published_at_precision = a.published_at_precision
FROM articles a
WHERE a.id = p.article_id
  AND a.source_id IN ('wjx-xjxxx', 'wjx-dsjl', 'futuretech-56660', 'futuretech-kwyx')
  AND a.published_at IS NOT NULL;
