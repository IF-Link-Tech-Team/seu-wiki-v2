-- 上游 AIHOT 4.0.0（1ca5d6d）把模型榜与 Codex 重置监控整体移出框架。本仓库的
-- industry/features.ts 两项均为 false、功能早已关闭，代码与接口已删，这里清掉数据表。
-- 与上游 0053_drop_leaderboard_monitor.sql 对应；本仓库 schema 以 877d6d5 为基线，
-- 没有上游 0048 短暂建过又删掉的 lb_calibrations。
DROP TABLE IF EXISTS lb_rankings;
DROP TABLE IF EXISTS lb_scores;
DROP TABLE IF EXISTS lb_prices;
DROP TABLE IF EXISTS lb_aliases;
DROP TABLE IF EXISTS lb_runs;
DROP TABLE IF EXISTS lb_snapshots;
DROP TABLE IF EXISTS lb_models;
DROP TABLE IF EXISTS monitor_event_posts;
DROP TABLE IF EXISTS monitor_events;
DROP TABLE IF EXISTS monitor_posts;
DROP TABLE IF EXISTS monitor_state;
DROP TABLE IF EXISTS fx_rates;
DELETE FROM settings WHERE key IN ('leaderboard.fetch', 'models.monitor');
