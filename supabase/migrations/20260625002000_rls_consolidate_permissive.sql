-- Performance: consolidate clearly-redundant permissive policies and wrap the last
-- auth.<fn>() call (advisors: multiple_permissive_policies, auth_rls_initplan).
--
-- Only the unambiguous "admin OR row-owner" pairs are merged (user_devices,
-- users_accounts). The merged policy is logically identical to the two it replaces:
--   is_admin() was false for non-admins, and auth.uid() = <owner> was false for
--   admins acting on other rows, so OR-combining changes nothing functionally.
-- Intentional layered policies (owner = ALL + member = SELECT on custom_lists /
-- list_items, and the shared-list SELECT policies) are deliberately left as-is to
-- avoid altering access-control semantics for a marginal performance gain.
--
-- Wrapped is_admin() / auth.* in scalar sub-selects so they evaluate once per query.

-- ============================================================
-- media_content: wrap auth.role()
-- ============================================================
ALTER POLICY "Allow read access to media content for authenticated users"
  ON public.media_content
  USING (((select auth.role()) = 'authenticated'::text));

-- ============================================================
-- user_devices: merge admin + owner (SELECT, DELETE)
-- ============================================================
DROP POLICY IF EXISTS "Admins can select all devices" ON public.user_devices;
DROP POLICY IF EXISTS "Users can select their own devices" ON public.user_devices;
CREATE POLICY "Devices visible to owner or admin"
  ON public.user_devices
  FOR SELECT
  TO public
  USING ((select is_admin()) OR ((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Admins can delete all devices" ON public.user_devices;
DROP POLICY IF EXISTS "Users can delete their own devices" ON public.user_devices;
CREATE POLICY "Devices deletable by owner or admin"
  ON public.user_devices
  FOR DELETE
  TO public
  USING ((select is_admin()) OR ((select auth.uid()) = user_id));

-- ============================================================
-- users_accounts: merge admin + owner (SELECT, UPDATE)
-- ============================================================
DROP POLICY IF EXISTS "Admins can select all users_accounts" ON public.users_accounts;
DROP POLICY IF EXISTS "Users can select their own account" ON public.users_accounts;
CREATE POLICY "Account visible to owner or admin"
  ON public.users_accounts
  FOR SELECT
  TO public
  USING ((select is_admin()) OR ((select auth.uid()) = id));

DROP POLICY IF EXISTS "Admins can update all users_accounts" ON public.users_accounts;
DROP POLICY IF EXISTS "Users can update their own account" ON public.users_accounts;
CREATE POLICY "Account updatable by owner or admin"
  ON public.users_accounts
  FOR UPDATE
  TO public
  USING ((select is_admin()) OR ((select auth.uid()) = id))
  WITH CHECK ((select is_admin()) OR ((select auth.uid()) = id));
