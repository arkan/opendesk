import { templateText } from "@/i18n/text";
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

export const SNIPPETS: Snippet[] = [
  {
    id: "fallback",
    label: "Fallback when empty",
    description: "A value, or your own words when it is empty.",
    code: `{{ contact.first_name | default: "there" }}`,
    select: "there",
    keywords: "default empty missing",
  },
  {
    id: "if",
    label: "Show only when set",
    description: "A part that appears only when a value is there.",
    code: "{% if agent.phone %}Call me on {{ agent.phone }}.{% endif %}",
    select: "Call me on {{ agent.phone }}.",
    keywords: "if condition when",
  },
  {
    id: "ifelse",
    label: "If / else",
    description: "One part when it holds, another when it doesn't.",
    code: "{% if contact.first_name %}Hi {{ contact.first_name }},{% else %}Hi there,{% endif %}",
    select: "contact.first_name",
    keywords: "if else otherwise",
  },
  {
    id: "elsif",
    label: "Several cases in order",
    description: "Checks conditions one after another.",
    code: `{% if ticket.priority == "Urgent" %}We're on it now.{% elsif ticket.priority == "High" %}We'll reply today.{% else %}We'll reply soon.{% endif %}`,
    select: "We're on it now.",
    keywords: "if elsif else priority",
  },
  {
    id: "contains",
    label: "Has a label",
    description: "Checks a list, or words in text, with contains. Also ==, !=, >, <.",
    code: `{% if ticket.labels contains "VIP" %}Thanks for being with us.{% endif %}`,
    select: "VIP",
    keywords: "contains compare label equals and or",
  },
  {
    id: "unless",
    label: "Show only when empty",
    description: "The opposite of if.",
    code: "{% unless contact.name %}Could you tell us your name?{% endunless %}",
    select: "Could you tell us your name?",
    keywords: "unless not empty",
  },
  {
    id: "case",
    label: "Pick by value",
    description: "A different part for each value.",
    code: `{% case ticket.priority %}{% when "Urgent", "High" %}We're on it now.{% else %}We'll reply soon.{% endcase %}`,
    select: "ticket.priority",
    keywords: "case when switch",
  },
  {
    id: "for",
    label: "List each item",
    description: "Repeats a part for each item of a list, like the labels.",
    code: "{% for label in ticket.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% else %}None yet{% endfor %}",
    select: "ticket.labels",
    keywords: "for loop each repeat list labels",
  },
  {
    id: "assign",
    label: "Name a value",
    description: "Set it once, use it anywhere after.",
    code: `{% assign greeting = contact.first_name | default: "there" %}Hi {{ greeting }},`,
    select: "greeting",
    keywords: "assign variable set",
  },
  {
    id: "capture",
    label: "Name a piece",
    description: "Keep a whole piece to reuse.",
    code: "{% capture signoff %}{{ agent.first_name }} from {{ team.name }}{% endcapture %}{{ signoff }}",
    select: "signoff",
    keywords: "capture variable",
  },
  {
    id: "comment",
    label: "Note for your team",
    description: "Never reaches the customer.",
    code: "{% comment %}Only your team sees this{% endcomment %}",
    select: "Only your team sees this",
    keywords: "comment note hidden",
  },
  {
    id: "raw",
    label: "Write tags as they are",
    description: "Shows braces without filling them.",
    code: "{% raw %}{{ not filled }}{% endraw %}",
    select: "{{ not filled }}",
    keywords: "raw literal escape braces",
  },
];

export function matchSnippets(query: string): Snippet[] {
  const q = query.toLowerCase().trim();
  const snippets = SNIPPETS.map((s) => ({ ...s, label: templateText(s.label), description: templateText(s.description) }));
  if (!q) return snippets;
  return snippets.filter((s) => s.label.toLowerCase().includes(q) || s.id.includes(q) || s.keywords.includes(q) || s.code.toLowerCase().includes(q));
}
