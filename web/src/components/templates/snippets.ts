import { i18n } from "@/i18n";
import type strings from "@/i18n/locales/en/ui.json";
// Ready-made logic for template editors (contracts/templates.md "The language"):
// what "{%" offers and the Insert menu's Logic tab. Each inserts working code with
// the part to change selected, so nobody has to remember the syntax.

export type Snippet = {
  id: string;
  label: string;
  description: string;
  code: string;
  /** Selected after inserting: the part to change first. */
  select?: string;
  keywords: string;
};

export const SNIPPETS: (Omit<Snippet, "id" | "label" | "description"> & { id: keyof typeof strings.snippets })[] = [
  {
    id: "fallback",
    code: `{{ contact.first_name | default: "there" }}`,
    select: "there",
    keywords: "default empty missing",
  },
  {
    id: "if",
    code: "{% if agent.phone %}Call me on {{ agent.phone }}.{% endif %}",
    select: "Call me on {{ agent.phone }}.",
    keywords: "if condition when",
  },
  {
    id: "ifelse",
    code: "{% if contact.first_name %}Hi {{ contact.first_name }},{% else %}Hi there,{% endif %}",
    select: "contact.first_name",
    keywords: "if else otherwise",
  },
  {
    id: "elsif",
    code: `{% if ticket.priority == "Urgent" %}We're on it now.{% elsif ticket.priority == "High" %}We'll reply today.{% else %}We'll reply soon.{% endif %}`,
    select: "We're on it now.",
    keywords: "if elsif else priority",
  },
  {
    id: "contains",
    code: `{% if ticket.labels contains "VIP" %}Thanks for being with us.{% endif %}`,
    select: "VIP",
    keywords: "contains compare label equals and or",
  },
  {
    id: "unless",
    code: "{% unless contact.name %}Could you tell us your name?{% endunless %}",
    select: "Could you tell us your name?",
    keywords: "unless not empty",
  },
  {
    id: "case",
    code: `{% case ticket.priority %}{% when "Urgent", "High" %}We're on it now.{% else %}We'll reply soon.{% endcase %}`,
    select: "ticket.priority",
    keywords: "case when switch",
  },
  {
    id: "for",
    code: "{% for label in ticket.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% else %}None yet{% endfor %}",
    select: "ticket.labels",
    keywords: "for loop each repeat list labels",
  },
  {
    id: "assign",
    code: `{% assign greeting = contact.first_name | default: "there" %}Hi {{ greeting }},`,
    select: "greeting",
    keywords: "assign variable set",
  },
  {
    id: "capture",
    code: "{% capture signoff %}{{ agent.first_name }} from {{ team.name }}{% endcapture %}{{ signoff }}",
    select: "signoff",
    keywords: "capture variable",
  },
  {
    id: "comment",
    code: "{% comment %}Only your team sees this{% endcomment %}",
    select: "Only your team sees this",
    keywords: "comment note hidden",
  },
  {
    id: "raw",
    code: "{% raw %}{{ not filled }}{% endraw %}",
    select: "{{ not filled }}",
    keywords: "raw literal escape braces",
  },
];

export function matchSnippets(query: string): Snippet[] {
  const q = query.toLowerCase().trim();
  const snippets = SNIPPETS.map((s) => ({
    ...s,
    label: i18n.t(`snippets.${s.id}.label`, { ns: "ui" }),
    description: i18n.t(`snippets.${s.id}.description`, { ns: "ui" }),
  }));
  if (!q) return snippets;
  return snippets.filter((s) => s.label.toLowerCase().includes(q) || s.id.includes(q) || s.keywords.includes(q) || s.code.toLowerCase().includes(q));
}
