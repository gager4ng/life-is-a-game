import { expect, test } from "@playwright/test";
import { newGame, skipGuideAndScene } from "./helpers";

// Phone-size screenshots for docs/screenshots. Run on demand: SHOTS=1 pnpm e2e
const OUT = "../../docs/screenshots";
test.skip(!process.env.SHOTS, "set SHOTS=1 to take screenshots");

test("day street view", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.runTo(55));
  await page.evaluate(() => window.__liag.centrePlayer(1.3));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-day-street.png` });
});

test("night with rain", async ({ page }) => {
  await newGame(page, 1);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.runTo(410)); // day 3, 20:10, raining
  await page.evaluate(() => window.__liag.setSpeed(0));
  await page.evaluate(() => window.__liag.centreOnTile(24, 17, 0.9));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-night-rain.png` });
});

test("encounter scene (the first-morning chat)", async ({ page }) => {
  await newGame(page, 42);
  await page.getByTestId("guide-skip").click();
  await expect(page.getByTestId("encounter")).toBeVisible();
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-guided-start.png` });
});

test("show me arrow", async ({ page }) => {
  await newGame(page, 42);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.centreOnTile(3, 33, 1.2));
  await expect(page.getByTestId("edge-arrow")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-show-me-arrow.png` });
});
