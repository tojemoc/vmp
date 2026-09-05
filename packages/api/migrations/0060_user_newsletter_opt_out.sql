-- Newsletter preference for paying subscribers.
--
-- Default (NULL newsletter_opted_out_at): the subscriber receives creator
-- newsletters while their subscription is active/trialing. Checking the
-- checkout / account opt-out box stamps this column and removes them from the
-- Brevo marketing list only — transactional mail (magic links, security,
-- account notices) is unaffected and does not use that list.
--
-- newsletter_opt_out_version records which notice wording the opt-out refers to.
ALTER TABLE users ADD COLUMN newsletter_opted_out_at DATETIME;
ALTER TABLE users ADD COLUMN newsletter_opt_out_version TEXT;
