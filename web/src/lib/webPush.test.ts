import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api/endpoints";
import { subscribeWebPush, vapidKeyBytes } from "./webPush";

// A 65-byte uncompressed P-256 key, base64url as the server sends it.
const KEY = "BA" + "A".repeat(85);

type Sub = { options: { applicationServerKey: ArrayBuffer | null }; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => PushSubscriptionJSON };

let permission: NotificationPermission;
let existing: Sub | null;
let subscribe: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;
let save: ReturnType<typeof vi.spyOn>;

const sub = (key: Uint8Array, endpoint: string): Sub => ({
  options: { applicationServerKey: key.slice().buffer },
  unsubscribe: vi.fn(async () => true),
  toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
});

beforeEach(() => {
  permission = "granted";
  existing = null;
  subscribe = vi.fn(async (o: PushSubscriptionOptionsInit) => sub(o.applicationServerKey as Uint8Array, "https://push.example/new"));
  register = vi.fn(async () => ({}));
  const reg = { pushManager: { getSubscription: async () => existing, subscribe } };
  vi.stubGlobal("window", { Notification: { get permission() { return permission; } }, PushManager: class {} });
  vi.stubGlobal("navigator", { serviceWorker: { register, ready: Promise.resolve(reg) } });
  save = vi.spyOn(api.me, "webPush").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("vapidKeyBytes", () => {
  it("decodes base64url, padded or not", () => {
    expect(Array.from(vapidKeyBytes("-_8"))).toEqual([251, 255]);
    expect(Array.from(vapidKeyBytes("-_8="))).toEqual([251, 255]);
    expect(vapidKeyBytes(KEY)).toHaveLength(65);
  });
});

describe("subscribeWebPush", () => {
  it("subscribes with the server key and saves the subscription", async () => {
    expect(await subscribeWebPush(KEY)).toBe(true);
    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(KEY) });
    expect(save).toHaveBeenCalledWith({ endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } });
  });

  it("saves an existing subscription made with the same key again, for this session", async () => {
    existing = sub(vapidKeyBytes(KEY), "https://push.example/kept");
    await subscribeWebPush(KEY);
    expect(subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://push.example/kept" }));
  });

  it("replaces a subscription made with another key", async () => {
    const old = sub(vapidKeyBytes("BB" + "B".repeat(85)), "https://push.example/old");
    existing = old;
    await subscribeWebPush(KEY);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://push.example/new" }));
  });

  it("does nothing without permission or a server key", async () => {
    permission = "default";
    expect(await subscribeWebPush(KEY)).toBe(false);
    permission = "granted";
    expect(await subscribeWebPush(null)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
