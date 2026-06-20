"use client";

import { supabase } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return bytes.buffer as ArrayBuffer;
}

export type PushResult = { ok: boolean; reason?: string };

export async function subscribeToPush(): Promise<PushResult> {
  if (!("Notification" in window)) {
    return { ok: false, reason: "This browser does not support notifications." };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push is not supported. Open the app from your home-screen icon (not Safari)." };
  }

  // 1) Permission FIRST, synchronously inside the user gesture — iOS denies
  //    silently if any async work happens before this call.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "Could not request permission. Add the app to your home screen first." };
  }
  if (permission === "denied") {
    return { ok: false, reason: "Notifications are blocked. Enable them in iOS Settings → SayNoMore → Notifications." };
  }
  if (permission !== "granted") {
    return { ok: false, reason: "Permission was not granted." };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Reuse an existing subscription if one exists, otherwise create one.
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
      });
    }

    const { endpoint, keys } = subscription.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    // user_id is required by the table + RLS — Supabase does not auto-fill it.
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return { ok: false, reason: "Not signed in." };

    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: userData.user.id, endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
      { onConflict: "user_id,endpoint" }
    );

    if (error) return { ok: false, reason: `Could not save subscription: ${error.message}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || "Subscription failed." };
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}
