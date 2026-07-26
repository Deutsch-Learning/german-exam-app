import { expect, test } from "@playwright/test";

const baseUrl = globalThis.process?.env?.SCROLL_BASE_URL || "http://127.0.0.1:4179";

const installScrollFixture = async (page) => {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("lenis"));
  await page.evaluate(() => {
    const fixture = document.createElement("section");
    fixture.id = "scroll-regression-fixture";
    fixture.style.cssText = "min-height:1200px;padding:40px;background:#fff;";
    fixture.innerHTML = `
      <div id="scroll-outer" style="height:280px;overflow-y:auto;overscroll-behavior-y:auto;border:1px solid transparent;">
        <div id="scroll-inner" style="height:150px;overflow-y:auto;overscroll-behavior-y:auto;touch-action:pan-y;">
          <div style="height:900px"></div>
        </div>
        <div style="height:1100px"></div>
      </div>
      <div style="height:900px"></div>
    `;
    document.body.appendChild(fixture);
    window.scrollTo({ top: fixture.offsetTop, behavior: "instant" });
  });
  await page.waitForTimeout(100);
};

const readPositions = (page) => page.evaluate(() => ({
  inner: document.querySelector("#scroll-inner").scrollTop,
  outer: document.querySelector("#scroll-outer").scrollTop,
  page: window.scrollY,
}));

const pointInside = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + Math.min(60, box.height / 2) };
};

test("wheel follows the hovered nested panel and chains only at boundaries", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installScrollFixture(page);
  const point = await pointInside(page, "#scroll-inner");
  await page.mouse.move(point.x, point.y);

  const initial = await readPositions(page);
  await page.mouse.wheel(0, 320);
  await page.waitForTimeout(150);
  const innerMoved = await readPositions(page);
  expect(innerMoved.inner).toBeGreaterThan(initial.inner);
  expect(innerMoved.outer).toBe(initial.outer);
  expect(innerMoved.page).toBe(initial.page);

  await page.locator("#scroll-inner").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforeOuter = await readPositions(page);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(150);
  const outerMoved = await readPositions(page);
  expect(outerMoved.inner).toBe(beforeOuter.inner);
  expect(outerMoved.outer).toBeGreaterThan(beforeOuter.outer);
  expect(outerMoved.page).toBe(beforeOuter.page);

  await page.locator("#scroll-outer").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforePage = await readPositions(page);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(900);
  const pageMoved = await readPositions(page);
  expect(pageMoved.outer).toBe(beforePage.outer);
  expect(pageMoved.page).toBeGreaterThan(beforePage.page);

  await page.evaluate(() => {
    const inner = document.querySelector("#scroll-inner");
    const outer = document.querySelector("#scroll-outer");
    inner.scrollTop = 0;
    outer.scrollTop = 0;
  });
  const beforeUpwardChain = await readPositions(page);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(900);
  const pageMovedUp = await readPositions(page);
  expect(pageMovedUp.inner).toBe(0);
  expect(pageMovedUp.outer).toBe(0);
  expect(pageMovedUp.page).toBeLessThan(beforeUpwardChain.page);
});

test("touch scrolling is consumed by the touched nested panel first", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await installScrollFixture(page);
  const point = await pointInside(page, "#scroll-inner");
  const client = await context.newCDPSession(page);
  const initial = await readPositions(page);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y }],
  });
  for (const offset of [25, 50, 75, 100]) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y - offset }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);

  const moved = await readPositions(page);
  expect(moved.inner).toBeGreaterThan(initial.inner);
  expect(moved.outer).toBe(initial.outer);
  expect(moved.page).toBe(initial.page);
  await context.close();
});
