-- Step 24: the first daily statistics snapshot (public /statistics), computed after the timeline has been backdated.
select public.refresh_statistics();
