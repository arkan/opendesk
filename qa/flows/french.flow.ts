import { expect, test } from "../lib/proof.ts";

test.use({ locale: "fr-FR" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("od-ollie-tips", JSON.stringify({ paused: Number.MAX_SAFE_INTEGER })));
});

test("a French browser opens a ticket and adds an internal note", async ({ page, proof }) => {
  await proof.open("/inbox/unassigned");
  const tickets = page.getByRole("listbox", { name: "Tickets" });
  await expect(tickets.getByRole("option").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("link", { name: "Base de connaissances", exact: true })).toBeVisible();
  await proof.chapter("French inbox", "The browser language selects French automatically");
  await proof.shot("inbox", { caption: "The agent inbox in French" });
  await tickets.getByRole("option", { name: /Pricing question/ }).click();
  await expect(page.getByRole("heading", { name: "Pricing question" })).toBeVisible();
  await page.getByRole("radio", { name: "Note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Le client souhaite connaître les modalités de facturation.");
  await page.getByRole("button", { name: "Ajouter une note", exact: true }).click();
  await expect(page.getByText("Le client souhaite connaître les modalités de facturation.", { exact: true })).toBeVisible();
  await proof.shot("ticket-note", { caption: "A French internal note added to a ticket" });
});

test("French contacts, knowledge base and reports", async ({ page, proof }) => {
  for (const [path, heading, shot] of [
    ["/contacts", "Contacts", "contacts"],
    ["/kb", "Base de connaissances", "knowledge-base"],
    ["/reports", "Rapports", "reports"],
  ]) {
    await proof.open(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await proof.shot(shot, { caption: `${heading}: the French agent interface` });
  }
});

test("French profile, teams, bots and billing settings", async ({ page, proof }) => {
  for (const [path, heading, shot] of [
    ["/settings/profile", "Profil", "profile"],
    ["/settings/teams", "Équipes", "teams"],
    ["/settings/ai/bots", "Bots", "bots"],
    ["/settings/billing", "Offre et facturation", "billing"],
  ]) {
    await proof.open(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await proof.shot(shot, { caption: `${heading}: settings in French` });
  }
});
