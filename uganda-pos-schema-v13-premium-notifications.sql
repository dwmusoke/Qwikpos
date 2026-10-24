-- =====================================================================
-- QWICKPOS — SCHEMA V13
-- Premium notifications: snooze + rich action buttons.
-- Safe to re-run. Run AFTER schema v3 (notifications table exists).
-- =====================================================================

alter table notifications add column if not exists snooze_until timestamptz;

alter table notifications add column if not exists action_buttons jsonb;

create index if not exists idx_notifications_snooze on notifications(snooze_until) where snooze_until is not null;

-- =====================================================================
-- END OF SCHEMA V13
-- =====================================================================
