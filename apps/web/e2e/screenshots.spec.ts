import { expect, test } from "@playwright/test";
import { newGame } from "./helpers";

// Phone-size screenshots for docs/screenshots. Run on demand: SHOTS=1 pnpm e2e
const OUT = "../../docs/screenshots";
test.skip(!process.env.SHOTS, "set SHOTS=1 to take screenshots");

test("day street view", async ({ page }) => {
  await newGame(page, 42);
  await page.evaluate(() => window.__liag.runTo(55));
  await page.evaluate(() => window.__liag.centrePlayer(1.1));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-day-street.png` });
});

test("night with rain", async ({ page }) => {
  await newGame(page, 1);
  await page.evaluate(() => window.__liag.runTo(410)); // day 3, 20:10, raining
  await page.evaluate(() => window.__liag.centreOnTile(24, 17, 0.9));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-night-rain.png` });
});

test("encounter scene", async ({ page }) => {
  await newGame(page, 42);
  expect(await page.evaluate(() => window.__liag.runUntilEncounter(400))).toBe(true);
  await expect(page.getByTestId("encounter")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-encounter.png` });
});

test("gist feed", async ({ page }) => {
  await newGame(page, 42);
  await page.evaluate(() => window.__liag.runTo(144 + 70));
  await page.getByTestId("gist-open").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-gist.png` });
});
