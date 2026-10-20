// Web Push (contracts/native.md "Web Push"): once the person allows notifications, the
// browser subscribes with the server's VAPID key through the service worker
// (public/sw.js), and the subscription is saved for this session. The desktop app shows
// its own notifications and never subscribes.

import { api } from "./api/endpoints";
import { isDesktop } from "./desktop";

/** True when this browser can receive web pushes. */
export function webPushSupported(): boolean {
  return (
    !isDesktop &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/** A base64url VAPID key as the bytes pushManager.subscribe takes. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/**
 * Subscribes this browser and saves the subscription for the session. It does nothing
 * without the person's permission or a server key. A subscription made with another key
 * (AUTH_SECRET changed) is replaced. Reports whether the browser is subscribed.
 */
export async function subscribeWebPush(key: string | null | undefined): Promise<boolean> {
  if (!key || !webPushSupported() || window.Notification.permission !== "granted") return false;
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  const appKey = vapidKeyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  await api.me.webPush(sub.toJSON());
  return true;
}
