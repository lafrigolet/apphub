-- Inbound email bridge (notifications §26): a user's email reply to their
-- inquiry confirmation is re-ingested into the thread as a timeline activity.
-- New activity type 'email_reply' — body carries the cleaned reply text,
-- metadata { from, inboundEmailId, attachments: [{filename, objectKey, …}] }.

ALTER TABLE platform_inquiries.inquiry_activities
  DROP CONSTRAINT IF EXISTS inquiry_activities_type_check;

ALTER TABLE platform_inquiries.inquiry_activities
  ADD CONSTRAINT inquiry_activities_type_check
  CHECK (type IN ('note', 'status_change', 'assignment', 'system', 'email_reply'));
