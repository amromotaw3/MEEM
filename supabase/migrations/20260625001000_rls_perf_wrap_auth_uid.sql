-- Performance: wrap auth.uid() in a scalar sub-select so Postgres evaluates it
-- ONCE per query instead of once per row (fixes advisor: auth_rls_initplan).
-- Generated from the live policy definitions; only the auth.uid() calls change —
-- command, roles and logic are preserved exactly via ALTER POLICY.

ALTER POLICY "Users can delete their own profile" ON public.account_profiles
  USING (((select auth.uid()) = user_id));
ALTER POLICY "Users can insert their own profile" ON public.account_profiles
  WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY "Users can update their own profile" ON public.account_profiles
  USING (((select auth.uid()) = user_id));
ALTER POLICY "insert_collection_messages" ON public.collection_messages
  WITH CHECK ((is_list_participant(list_id, (select auth.uid())) AND (profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid()))))));
ALTER POLICY "select_collection_messages" ON public.collection_messages
  USING (is_list_participant(list_id, (select auth.uid())));
ALTER POLICY "Users can delete their own continue_watching" ON public.continue_watching
  USING ((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))));
ALTER POLICY "Users can insert their own continue_watching" ON public.continue_watching
  WITH CHECK ((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))));
ALTER POLICY "Users can select their own continue_watching" ON public.continue_watching
  USING ((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))));
ALTER POLICY "Users can update their own continue_watching" ON public.continue_watching
  USING ((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))))
  WITH CHECK ((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))));
ALTER POLICY "Owners can manage their own custom lists" ON public.custom_lists
  USING ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = custom_lists.profile_id) AND (account_profiles.user_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = custom_lists.profile_id) AND (account_profiles.user_id = (select auth.uid()))))));
ALTER POLICY "Members can view custom lists" ON public.custom_lists
  USING (is_list_member(id, (select auth.uid())));
ALTER POLICY "select_custom_lists_participant" ON public.custom_lists
  USING (((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1
   FROM list_members
  WHERE ((list_members.list_id = custom_lists.id) AND (list_members.user_id = (select auth.uid())) AND (list_members.status = 'joined'::text))))));
ALTER POLICY "Owners can manage list items" ON public.list_items
  USING (is_list_owner(list_id, (select auth.uid())))
  WITH CHECK (is_list_owner(list_id, (select auth.uid())));
ALTER POLICY "Members can delete list items" ON public.list_items
  USING (is_list_member(list_id, (select auth.uid())));
ALTER POLICY "Members can insert list items" ON public.list_items
  WITH CHECK (is_list_member(list_id, (select auth.uid())));
ALTER POLICY "Members can view list items" ON public.list_items
  USING (is_list_member(list_id, (select auth.uid())));
ALTER POLICY "select_list_items_participant" ON public.list_items
  USING ((EXISTS ( SELECT 1
   FROM custom_lists
  WHERE ((custom_lists.id = list_items.list_id) AND ((custom_lists.profile_id IN ( SELECT account_profiles.id
           FROM account_profiles
          WHERE (account_profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1
           FROM list_members
          WHERE ((list_members.list_id = list_items.list_id) AND (list_members.user_id = (select auth.uid())) AND (list_members.status = 'joined'::text)))))))));
ALTER POLICY "Owners or members can delete list members" ON public.list_members
  USING (((user_id = (select auth.uid())) OR is_list_owner(list_id, (select auth.uid()))));
ALTER POLICY "Owners can insert list members" ON public.list_members
  WITH CHECK ((is_list_owner(list_id, (select auth.uid())) AND user_allows_invites(user_id)));
ALTER POLICY "Users can view members of lists they belong to or own" ON public.list_members
  USING (((user_id = (select auth.uid())) OR is_list_owner(list_id, (select auth.uid())) OR is_list_member(list_id, (select auth.uid()))));
ALTER POLICY "Owners or members can update list members" ON public.list_members
  USING (((user_id = (select auth.uid())) OR is_list_owner(list_id, (select auth.uid()))))
  WITH CHECK (((user_id = (select auth.uid())) OR is_list_owner(list_id, (select auth.uid()))));
ALTER POLICY "Users can manage their own locked items" ON public.locked_items
  USING ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = locked_items.profile_id) AND (account_profiles.user_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = locked_items.profile_id) AND (account_profiles.user_id = (select auth.uid()))))));
ALTER POLICY "Users can manage their own playback history" ON public.playback_history
  USING ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = playback_history.profile_id) AND (account_profiles.user_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = playback_history.profile_id) AND (account_profiles.user_id = (select auth.uid()))))));
ALTER POLICY "select_playback_history_shared" ON public.playback_history
  USING (((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1
   FROM account_profiles ap
  WHERE ((ap.user_id = (select auth.uid())) AND share_custom_list(ap.id, playback_history.profile_id))))));
ALTER POLICY "Users can delete their own devices" ON public.user_devices
  USING (((select auth.uid()) = user_id));
ALTER POLICY "Users can insert their own devices" ON public.user_devices
  WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY "Users can select their own devices" ON public.user_devices
  USING (((select auth.uid()) = user_id));
ALTER POLICY "Users can update their own devices" ON public.user_devices
  USING (((select auth.uid()) = user_id));
ALTER POLICY "Users can select their own account" ON public.users_accounts
  USING (((select auth.uid()) = id));
ALTER POLICY "Users can update their own account" ON public.users_accounts
  USING (((select auth.uid()) = id));
ALTER POLICY "Users can manage their own watchlist items" ON public.watchlist_items
  USING ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = watchlist_items.profile_id) AND (account_profiles.user_id = (select auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM account_profiles
  WHERE ((account_profiles.id = watchlist_items.profile_id) AND (account_profiles.user_id = (select auth.uid()))))));
ALTER POLICY "select_watchlist_items_shared" ON public.watchlist_items
  USING (((profile_id IN ( SELECT account_profiles.id
   FROM account_profiles
  WHERE (account_profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1
   FROM account_profiles ap
  WHERE ((ap.user_id = (select auth.uid())) AND share_custom_list(ap.id, watchlist_items.profile_id))))));
