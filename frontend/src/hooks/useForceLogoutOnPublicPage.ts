"use client";

import { useAuth } from "@/context/AuthContext";
import { useEffect, useRef, useState } from "react";

/**
 * The landing page and /login are the app's *exit* points — reaching either one while this
 * tab still has a live session (almost always via the browser Back/Forward buttons: nothing
 * in the authenticated shell links to "/", and /login's own former behavior of silently
 * `router.replace`-ing an already-logged-in visitor into the dashboard had the same problem
 * under a different name) must end that session outright, not silently let Forward walk back
 * into the dashboard with no fresh credential check. AuthProvider's `user` state otherwise
 * just persists across client-side navigation like any other SPA state, which is exactly the
 * "why did going back not log me out" gap being closed here.
 *
 * Judges *only* the session state as it stood the first moment this page's auth check
 * resolved after mount — never anything `user` transitions to afterward. That distinction
 * matters on /login specifically: a visitor submitting the form on this very page makes
 * `user` go from null to set too, and that transition must NOT be treated as "arrived with a
 * stale session" or logging in would immediately log itself back out.
 *
 * Returns true for the remainder of this page visit once that's happened, so the page can
 * show a "you've been signed out" notice explaining why the form is empty again.
 */
export function useForceLogoutOnPublicPage(): boolean {
  const { user, loading, logout } = useAuth();
  const [justLoggedOut, setJustLoggedOut] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (loading || checked.current) return;
    checked.current = true; // only the first resolved state is ever judged
    if (user) {
      logout();
      setJustLoggedOut(true);
    }
  }, [loading, user, logout]);

  return justLoggedOut;
}
