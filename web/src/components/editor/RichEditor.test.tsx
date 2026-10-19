import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichEditor, type RichEditorHandle } from "./RichEditor";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("shared rich editor hydration", () => {
  it("does not turn editable changes or loading a saved body into user edits", async () => {
    const onChange = vi.fn(); const ref = createRef<RichEditorHandle>();
    await act(async () => root.render(<RichEditor ref={ref} value="" editable={false} toolbar="none" syncWhileFocused onChange={onChange} />));
    await act(async () => root.render(<RichEditor ref={ref} value="<p>Saved order</p>" editable toolbar="none" syncWhileFocused onChange={onChange} />));
    expect(host.querySelector("[contenteditable]")?.textContent).toBe("Saved order");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(<RichEditor ref={ref} value="<p>Saved order</p>" editable={false} toolbar="none" syncWhileFocused onChange={onChange} />));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => ref.current?.setHtml("<p>Explicit edit</p>"));
    expect(onChange).toHaveBeenCalledWith("<p>Explicit edit</p>");
  });
});
