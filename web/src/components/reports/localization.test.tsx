import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { setAgentLocale } from "@/i18n";
import { rangeLabel } from "./RangePicker";
import { VolumeTable } from "./VolumeChart";

afterEach(async () => {
  await setAgentLocale("en");
  localStorage.clear();
});

it("uses French date order for custom ranges within and across years", async () => {
  await setAgentLocale("fr");
  expect(rangeLabel({ from: "2020-10-18", to: "2020-10-20" })).toBe("18 oct. – 20 oct. 2020");
  expect(rangeLabel({ from: "2020-12-30", to: "2021-01-02" })).toBe("30 déc. 2020 – 2 janv. 2021");
});

it("keeps the English date order and the report's calendar day", async () => {
  await setAgentLocale("en");
  expect(rangeLabel({ from: "2020-10-18", to: "2020-10-20" })).toBe("Oct 18 – Oct 20, 2020");
});

it("uses French date order in the volume table", async () => {
  await setAgentLocale("fr");
  const html = renderToStaticMarkup(<VolumeTable days={[{ date: "2020-10-18", created: 3, solved: 2 }]} />);
  expect(html).toContain("dim. 18 oct.");
});
