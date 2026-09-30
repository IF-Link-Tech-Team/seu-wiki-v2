-- 知识内容模块：旧站（seu-wiki，Astro/Starlight）的手册与经验迁入统一应用。
-- Git 是这批长期内容的编辑真源，docs 表是 scripts/import-seuwiki-docs.ts 生成的派生结果；
-- 重跑导入按 content_hash 判断，内容没变就不动版本。
-- slug 沿用旧站路径段（中文、小写 ASCII、空格转连字符），新旧 URL 一致；
-- 少数改过地址的（6 个"已迁移"兼容页等）在 doc_redirects 里 301。

CREATE TABLE docs (
  id            bigserial PRIMARY KEY,
  -- 站内路径段，如 'survival/方向篇/升学/1-保研篇'、'experience/learning/transfer-major/mechanics-to-information-stella'
  slug          text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('survival', 'experience')),
  title         text NOT NULL,
  description   text,
  html          text NOT NULL,
  -- 章节锚点：[{ id, text, depth }]
  headings      jsonb NOT NULL DEFAULT '[]',
  author        text,
  -- 经历/原文时间（'2021-08'、'2019' 等原文写法），经验列表按它排序展示；不是导入时间
  occurred_at   text,
  -- 经验筛选三维：场景 / 年级 / 学院
  category      text,
  grade         text,
  college       text,
  -- 原始来源或编辑真源链接
  source_url    text,
  -- 手册篇（survival.ts 的 part key）与篇内顺序；经验的校友篇也按手册目录排
  part          text,
  position      integer NOT NULL DEFAULT 0,
  old_paths     text[] NOT NULL DEFAULT '{}',
  content_hash  text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX docs_kind_part_idx ON docs (kind, part, position);
CREATE INDEX docs_experience_filter_idx ON docs (category, grade, college) WHERE kind = 'experience';

CREATE TABLE doc_redirects (
  old_path    text PRIMARY KEY,
  target      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
