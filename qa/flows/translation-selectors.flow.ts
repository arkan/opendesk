import { expect, test } from "../lib/proof.ts";

for (const labels of [
  { locale: "en-US", search: "Search", searchTickets: "Search tickets", closeSearch: "Close search", filter: "Filter", priority: "Priority", high: "High", folder: "Unassigned" },
  { locale: "fr-FR", search: "Rechercher", searchTickets: "Rechercher des tickets", closeSearch: "Fermer la recherche", filter: "Filtrer", priority: "Priorité", high: "Élevée", folder: "Non attribués" },
]) {
  test.describe(labels.locale, () => {
    test.use({ locale: labels.locale });

    test("keyboard search and translated filters retain stable query values", async ({ page, proof }) => {
      await page.addInitScript(() => localStorage.setItem("od-ollie-tips", JSON.stringify({ paused: Number.MAX_SAFE_INTEGER })));
      await proof.open("/inbox/unassigned");
      await expect(page.getByRole("heading", { name: labels.folder, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: labels.search, exact: true })).toBeVisible();
      await page.keyboard.press("/");
      const search = page.getByRole("textbox", { name: labels.searchTickets, exact: true });
      await expect(search).toBeFocused();
      await search.fill("Pricing");
      await expect(page).toHaveURL(/q=Pricing/);
      await expect(page.getByRole("option", { name: /Pricing question/ })).toBeVisible();
      await proof.shot("keyboard-search", { caption: `Keyboard search works with ${labels.locale} accessible labels` });

      await page.getByRole("button", { name: labels.closeSearch, exact: true }).click();
      await expect(page).not.toHaveURL(/q=Pricing/);
      await page.getByRole("button", { name: labels.filter, exact: true }).click();
      await page.getByRole("menuitem", { name: labels.priority, exact: true }).hover();
      await page.getByRole("menuitemcheckbox", { name: new RegExp(labels.high) }).click();
      await expect(page).toHaveURL(/priority=high/);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await proof.shot("priority-filter", { caption: `The ${labels.high} filter keeps the API value high` });
    });
  });
}
