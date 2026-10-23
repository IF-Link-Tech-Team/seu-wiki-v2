-- Retire periodic publications without touching source articles, facts or stories.
DELETE FROM reports WHERE kind IN ('daily', 'weekly', 'monthly'); -- revisions cascade
-- Compatibility columns stay so upgrades do not break old SQL; they no longer carry meaning.
UPDATE sources SET first_party = false WHERE first_party;
UPDATE publications SET first_party = false WHERE first_party;
