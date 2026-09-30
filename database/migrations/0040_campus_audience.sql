-- 「为你」信息流的受众与校园语义：内容理解（提示词层，后续接入）提取后写在 analyses.campus，
-- 投影时拷贝到 publications.campus，公开读取层按读者画像加权排序（只加权和标注，不剔除）。
-- 形状：{ identities?: string[], colleges?: string[], grades?: string[], deadline?: string|null,
--         valueTier?: "action"|"opportunity"|"news", completeness?: string }，全部可空。
-- colleges 为空数组或含「全校」表示面向全校，是中性而不是全命中。

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS campus jsonb;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS campus jsonb;
