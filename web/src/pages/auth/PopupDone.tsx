import { useTranslation } from "react-i18next";
// /auth/popup: where a provider sign-in that ran in a popup window comes back
// (lib/oauthPopup.ts). It hands the one-time code to the tab that started it and closes;
// when no tab answers, it finishes the sign-in here instead.

import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { deliverPopupResult } from "@/lib/oauthPopup";

const route = getRouteApi("/auth/auth/popup");

export default function PopupDone() {
  const { t: uiText } = useTranslation("interface");
  const search = route.useSearch();
  const router = useRouter();
  const [handed, setHanded] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const here = () => {
      const q = search.code ? `code=${encodeURIComponent(search.code)}` : `error=${encodeURIComponent(search.error || "invalid_request")}`;
      router.history.replace(`/auth/callback?${q}`);
    };
    if (!search.popup || (!search.code && !search.error)) return here();
    void deliverPopupResult({ type: "opendesk-oauth-popup", popup: search.popup, code: search.code, error: search.error }).then((ok) => {
      if (!ok) return here();
      setHanded(true);
      window.close();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center text-[13px] text-fg-3" aria-live="polite">
      {handed ? uiText("You're signed in. You can close this window.") : (
        <>
          <Spinner />
           {uiText("Signing you in")} </>
      )}
    </div>
  );
}
