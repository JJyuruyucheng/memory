-- Both invited couple members may maintain the shared settings page.
-- member_role() checks the protected profiles whitelist and runtime guard;
-- authenticated outsiders and anonymous requests remain excluded.
-- Existing grants still restrict writes to spaceName, subtitle, startDate and
-- anniversaries. No profiles, entries, media or Storage authorization changes.
alter policy settings_update on public.settings
  using ((select memory_private.member_role()) is not null)
  with check ((select memory_private.member_role()) is not null);
