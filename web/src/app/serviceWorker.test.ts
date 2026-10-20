import { beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sw.js?raw";

// public/sw.js runs as written, against a stand-in for the service worker global.

type Handler = (event: Record<string, unknown>) => void;
type Win = { focused: boolean; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> };

let handlers: Record<string, Handler>;
let windows: Win[];
let shown: { title: string; options: NotificationOptions; close: ReturnType<typeof vi.fn> }[];
let opened: string[];

function load() {
  handlers = {};
  const self = {
    location: { origin: "https://desk.example" },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => opened.push(url)),
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: NotificationOptions) => shown.push({ title, options, close: vi.fn() })),
      getNotifications: vi.fn(async ({ tag }: { tag: string }) => shown.filter((n) => n.options.tag === tag)),
    },
  };
  new Function("self", source)(self);
}

/** Dispatches an event and waits for what it handed to waitUntil. */
async function dispatch(type: string, event: Record<string, unknown>) {
  let work: Promise<unknown> = Promise.resolve();
  handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
  await work;
}

const win = (focused: boolean): Win => ({ focused, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) });
const push = (data: unknown) => ({ data: { json: () => (typeof data === "string" ? JSON.parse(data) : data) } });
const alert = { id: "n1", workspace_id: "w1", title: "A ticket was assigned to you", body: "#12 Refund", url: "https://desk.example/inbox/mine/t1?ws=w1" };

beforeEach(() => {
  windows = [];
  shown = [];
  opened = [];
  load();
});

describe("service worker pushes", () => {
  it("shows a push while no window is focused, tagged with the notification id", async () => {
    windows = [win(false)];
    await dispatch("push", push(alert));
    expect(shown).toEqual([
      { title: alert.title, options: { body: "#12 Refund", tag: "n1", icon: "/icon-192.png", data: { url: alert.url } }, close: expect.any(Function) },
    ]);
    expect(shown[0].close).not.toHaveBeenCalled();
  });

  it("leaves a focused window to its toasts, closing the push it must show", async () => {
    windows = [win(true)];
    await dispatch("push", push(alert));
    expect(shown).toHaveLength(1);
    expect(shown[0].close).toHaveBeenCalled();
  });

  it("ignores a push it cannot read", async () => {
    await dispatch("push", push("not json"));
    await dispatch("push", push({ id: "n2" }));
    expect(shown).toHaveLength(0);
  });
});

describe("service worker clicks", () => {
  const click = (url?: string) => ({ notification: { close: vi.fn(), data: url ? { url } : undefined } });

  it("brings an open window to the notification's page", async () => {
    const w = win(false);
    windows = [w];
    await dispatch("notificationclick", click(alert.url));
    expect(w.focus).toHaveBeenCalled();
    expect(w.navigate).toHaveBeenCalledWith(alert.url);
    expect(opened).toEqual([]);
  });

  it("opens a window when none is open, or when the open one cannot navigate", async () => {
    await dispatch("notificationclick", click(alert.url));
    const w = win(false);
    w.navigate.mockRejectedValueOnce(new TypeError("not controlled"));
    windows = [w];
    await dispatch("notificationclick", click(alert.url));
    expect(opened).toEqual([alert.url, alert.url]);
  });

  it("opens another origin's link in a new window", async () => {
    const w = win(false);
    windows = [w];
    await dispatch("notificationclick", click("https://other.example/x"));
    expect(w.navigate).not.toHaveBeenCalled();
    expect(opened).toEqual(["https://other.example/x"]);
  });
});
