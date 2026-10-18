import { afterEach, describe, expect, it } from "vitest";
import { i18n, i18nReady } from "@/i18n";
import { credentialFields, sourceName } from "../imports/sources";
import { GROUP_LABELS } from "./catalog";
import { matchSnippets, SNIPPETS } from "./snippets";
import { templateText } from "./text";

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
    expect(templateText("Unknown {{ contact.name }} $t(Insert)")).toBe("Unknown {{ contact.name }} $t(Insert)");
    expect(templateText("Send this email to {{email}}", { email: "$t(Insert)" })).toBe("Envoyer cet e-mail à $t(Insert)");
  });

  it("updates imported credential guidance and group labels when language changes", async () => {
    await i18nReady;
    await i18n.changeLanguage("fr");
    expect(GROUP_LABELS.contact).toBe("Client");
    expect(sourceName.csv).toBe("Fichier CSV");
    expect(credentialFields.zendesk[0].label).toBe("Adresse Zendesk");
    expect(credentialFields.intercom[0].choices?.[0]).toEqual(["us", "États-Unis"]);
    await i18n.changeLanguage("en");
    expect(GROUP_LABELS.contact).toBe("Customer");
    expect(sourceName.csv).toBe("CSV file");
    expect(credentialFields.zendesk[0].label).toBe("Zendesk address");
    expect(credentialFields.intercom[0].choices?.[0]).toEqual(["us", "United States"]);
  });
});
