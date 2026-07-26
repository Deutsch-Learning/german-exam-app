import { test, expect } from "@playwright/test";

const baseUrl = globalThis.process?.env?.B1_READING_BASE_URL || "https://gem-app-delta.vercel.app";

const startReadingSimulation = async (page, examId, provider) => {
  const seriesId = `imported-${provider}-b1-series-01`;
  await page.goto(`${baseUrl}/simulations/${examId}/${seriesId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Lesen\b/ }).click();
  await page.getByRole("button", { name: "Beginnen" }).click();
  await expect(page.getByRole("button", { name: "Test starten" })).toBeVisible();
  await page.getByRole("button", { name: "Test starten" }).click();
  return seriesId;
};

const expectNoHorizontalOverflow = async (page) => {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
};

const enterPendingPart = async (page) => {
  const skipTransition = page.getByRole("button", { name: "Ueberspringen" });
  if (await skipTransition.isVisible().catch(() => false)) await skipTransition.click();
  const startPart = page.getByRole("button", { name: "Test starten" });
  if (await startPart.isVisible().catch(() => false)) await startPart.click();
};

test.describe.configure({ mode: "serial" });

test("TELC B1 desktop preserves matching answers and confirms final submission", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startReadingSimulation(page, "telc-b1", "telc");

  await expect(page.getByRole("heading", { name: "Teil 1 - Globalverstehen" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Überschriften A-G" })).toBeVisible();
  const headingSelects = page.getByRole("combobox");
  await headingSelects.first().selectOption("A");
  await expect(headingSelects.first()).toHaveValue("A");
  await expect(headingSelects.nth(1).locator('option[value="A"]')).toHaveText(/bereits verwendet/);

  await page.getByRole("region", { name: "Aufgabennavigation" }).getByRole("button", { name: /Weiter/ }).click();
  await enterPendingPart(page);
  await expect(page.getByRole("heading", { name: /Teil 2/ })).toBeVisible();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Teil 2/ })).toBeVisible();

  const partProgress = page.getByRole("region", { name: "Abschnittsfortschritt" });
  await partProgress.getByRole("button", { name: /Teil 1/ }).click();
  await enterPendingPart(page);
  await expect(page.getByRole("combobox").first()).toHaveValue("A");
  await partProgress.getByRole("button", { name: /Teil 3/ }).click();
  await enterPendingPart(page);
  await expect(page.getByRole("heading", { name: /Teil 3/ })).toBeVisible();

  await page.getByRole("region", { name: "Aufgabennavigation" }).getByRole("button", { name: /Abgeben/ }).click();
  const confirmation = page.getByRole("dialog", { name: "Simulation abgeben?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("19 Aufgaben sind noch unbeantwortet.");
  await confirmation.getByRole("button", { name: "Antworten prüfen" }).click();
  await expect(confirmation).toBeHidden();

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/b1-reading-telc-desktop.png", fullPage: true });
});

test("TELC B1 mobile exposes the heading bank without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startReadingSimulation(page, "telc-b1", "telc");

  const referenceButton = page.getByRole("button", { name: "Überschriften anzeigen" });
  await expect(referenceButton).toBeVisible();
  await referenceButton.click();
  const dialog = page.getByRole("dialog", { name: "Überschriften anzeigen" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("A");
  await expect(dialog).toContainText("G");
  await dialog.getByRole("button", { name: "Überschriften anzeigen schließen" }).click();
  await expect(dialog).toBeHidden();

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/b1-reading-telc-mobile.png", fullPage: true });
});

test("ÖSD B1 mobile Teil 4 offers only Dafür and Dagegen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startReadingSimulation(page, "osd-b1", "osd");

  await page.getByRole("button", { name: "Navigation", exact: true }).click();
  await page.getByRole("button", { name: /Teil 4/ }).first().click();
  await enterPendingPart(page);
  await expect(page.getByRole("heading", { name: /Teil 4/ })).toBeVisible();
  const question = page.locator("fieldset").first();
  await expect(question.getByRole("button", { name: /DAFÜR/ })).toBeVisible();
  await expect(question.getByRole("button", { name: /DAGEGEN/ })).toBeVisible();
  await expect(question.getByRole("button", { name: /BEIDES/ })).toHaveCount(0);
  await question.getByRole("button", { name: /DAFÜR/ }).click();
  await expect(question.getByRole("button", { name: /DAFÜR/ })).toHaveAttribute("aria-pressed", "true");

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/b1-reading-osd-mobile.png", fullPage: true });
});

test("ECL B1 tablet renders the three-state task and Aufgabe navigation", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await startReadingSimulation(page, "ecl-b1", "ecl");

  await expect(page.getByRole("heading", { name: /Aufgabe 1/ })).toBeVisible();
  const firstQuestion = page.locator("fieldset").first();
  const notInText = firstQuestion.getByRole("button", { name: /Steht nicht im Text/i });
  await expect(notInText).toBeVisible();
  await notInText.click();
  await expect(notInText).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("region", { name: "Aufgabennavigation" }).getByRole("button", { name: /Weiter/ }).click();
  await enterPendingPart(page);
  await expect(page.getByRole("heading", { name: /Aufgabe 2/ })).toBeVisible();
  await expect(page.locator("fieldset")).toHaveCount(5);

  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
    const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: String(element.className || ""), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .sort((a, b) => b.width - a.width)
      .slice(0, 12));
    console.log("Tablet overflow elements", offenders);
    await page.screenshot({ path: "test-results/b1-reading-ecl-tablet-overflow.png", fullPage: true });
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/b1-reading-ecl-tablet.png", fullPage: true });
});
