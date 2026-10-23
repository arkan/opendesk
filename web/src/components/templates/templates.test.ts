import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n, loadAgentCatalogs } from "@/i18n";
import { localNames, tagState } from "./catalog";
import { matchSnippets, SNIPPETS } from "./snippets";

// The agent app loads its French catalogs before rendering (the root route's loader).
beforeAll(() => loadAgentCatalogs("fr"));

describe("snippets", () => {
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("finds French labels while keeping the inserted template code unchanged", async () => {
    await i18n.changeLanguage("en");
    const english = matchSnippets("");
    await i18n.changeLanguage("fr");
    expect(matchSnippets("énumérer").map((s) => s.id)).toContain("for");
    expect(matchSnippets("").map(({ id, code, select }) => ({ id, code, select }))).toEqual(english.map(({ id, code, select }) => ({ id, code, select })));
  });
  it("finds logic by words people use", () => {
    expect(matchSnippets("loop").map((s) => s.id)).toContain("for");
    expect(matchSnippets("else").map((s) => s.id)).toContain("ifelse");
    expect(matchSnippets("")).toHaveLength(SNIPPETS.length);
  });
  it("selects a part that is in the code", () => {
    for (const s of SNIPPETS) if (s.select) expect(s.code).toContain(s.select);
  });
});

describe("tag colours", () => {
  const known = new Set(["contact.first_name", "ticket.labels"]);
  it("knows logic, loop names and assigned names", () => {
    const text = "{% for label in ticket.labels %}{{ label }}{% endfor %}{% assign g = 1 %}{{ g }}";
    const locals = localNames(text);
    expect(tagState("{{ label }}", known, locals)).toBe("var");
    expect(tagState("{{ g | upcase }}", known, locals)).toBe("var");
    expect(tagState("{{ forloop.index }}", known, locals)).toBe("var");
    expect(tagState("{% for label in ticket.labels %}", known, locals)).toBe("logic");
    expect(tagState("{% endfor %}", known, locals)).toBe("logic");
    expect(tagState('{% if ticket.number &gt; 3 %}', new Set(["ticket.number"]))).toBe("logic");
  });
  it("marks what does not exist", () => {
    expect(tagState("{{ contact.frist_name }}", known)).toBe("bad");
    expect(tagState("{% loop x %}", known)).toBe("bad");
    expect(tagState('{{ "x" | upcase }}', known)).toBe("var");
  });
});
