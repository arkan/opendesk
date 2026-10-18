import { afterEach, describe, expect, it } from "vitest";
import { i18n, i18nReady } from "@/i18n";
import { sourceName } from "../imports/sources";
import { matchSnippets, SNIPPETS } from "./snippets";
import { templateMetadataText, templateText } from "@/i18n/text";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("template and import language", () => {
  it("searches French guidance while inserting unchanged template code", async () => {
    await i18nReady;
    await i18n.changeLanguage("fr");
    const loop = matchSnippets("parcourir").find((s) => s.id === "for");
    expect(loop?.label).toBe("Parcourir chaque élément");
    expect(loop?.code).toBe(SNIPPETS.find((s) => s.id === "for")?.code);
    expect(loop?.select).toBe("ticket.labels");
    expect(templateMetadataText("Unknown {{ contact.name }} $t(Insert)")).toBe("Unknown {{ contact.name }} $t(Insert)");
    expect(templateText("Send this email to {{email}}", { email: "$t(Insert)" })).toBe("Envoyer cet e-mail à $t(Insert)");
  });

  it("updates source labels when language changes", async () => {
    await i18nReady;
    await i18n.changeLanguage("fr");
    expect(sourceName.csv).toBe("Fichier CSV");
    await i18n.changeLanguage("en");
    expect(sourceName.csv).toBe("CSV file");
  });
});
