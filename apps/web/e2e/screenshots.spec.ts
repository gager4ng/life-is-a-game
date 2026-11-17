import { expect, test } from "@playwright/test";
import { newGame, skipGuideAndScene, state } from "./helpers";

// Phone-size screenshots for docs/screenshots. Run on demand: SHOTS=1 pnpm e2e
const OUT = "../../docs/screenshots";
test.skip(!process.env.SHOTS, "set SHOTS=1 to take screenshots");

test("day street view", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.runTo(55));
  await page.evaluate(() => window.__liag.centrePlayer(1.3));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/01-day-street.png` });
});

test("night with rain", async ({ page }) => {
  await newGame(page, 1);
  await skipGuideAndScene(page);
  expect(await page.evaluate(() => window.__liag.runToRainyNight())).toBe(true);
  await page.evaluate(() => window.__liag.setSpeed(0));
  await page.evaluate(() => window.__liag.centreOnTile(28, 18, 1.4));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/02-night-rain.png` });
});

test("encounter at street level (the first-morning chat)", async ({ page }) => {
  await newGame(page, 42);
  await page.getByTestId("guide-skip").click();
  await expect(page.getByTestId("encounter")).toBeVisible();
  await page.getByTestId("choices").locator("button").first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/03-encounter.png` });
});

test("gist feed", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.runTo(144 + 70));
  await page.getByTestId("gist-open").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-gist.png` });
});

test("guided start", async ({ page }) => {
  await newGame(page, 42);
  await page.getByTestId("intro-start").click();
  await expect(page.getByTestId("coach")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/05-guided-start.png` });
});

test("show me arrow", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.centreOnTile(3, 33, 1.2));
  await expect(page.getByTestId("edge-arrow")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-show-me-arrow.png` });
});

test("follow Tobi at street level", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  // Morning: Tobi heads off to work; follow him down the street.
  await page.evaluate(() => window.__liag.runTo(46));
  await page.getByTestId("follow").click();
  await page.evaluate(() => window.__liag.setSpeed(1));
  await expect.poll(async () => (await state(page)).travelling, { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/07-follow-tobi.png` });
});
