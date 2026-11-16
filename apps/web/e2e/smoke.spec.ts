import { expect, test } from "@playwright/test";
import { newGame, state } from "./helpers";

// One light end-to-end pass: load, tap to move, play one encounter, open the Gist.
test("load, tap to walk, one encounter, gist", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newGame(page, 42);
  await expect(page.getByTestId("clock")).toBeVisible();

  // Tap a sidewalk tile: Tobi gets a street destination and sets off.
  await page.evaluate(() => window.__liag.centreOnTile(16, 16, 1));
  await page.waitForTimeout(200);
  const p = await page.evaluate(() => window.__liag.tileToScreen(16, 16));
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await state(page)).override?.tile).toEqual([16, 16]);
  await page.getByTestId("speed-4").click();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        return s.travelling || (s.street?.[0] === 16 && s.street?.[1] === 16);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Run the world until someone talks to Tobi, then answer.
  const found = await page.evaluate(() => window.__liag.runUntilEncounter(400));
  expect(found).toBe(true);
  const enc = page.getByTestId("encounter");
  await expect(enc).toBeVisible();
  const choices = page.getByTestId("choices").locator("button");
  expect(await choices.count()).toBeGreaterThanOrEqual(2);
  await choices.first().click();
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("result-ok").click();
  await expect(enc).toBeHidden();

  await page.getByTestId("gist-open").click();
  await expect(page.getByTestId("gist").locator("li.entry").first()).toBeVisible();
  expect(errors).toEqual([]);
});
