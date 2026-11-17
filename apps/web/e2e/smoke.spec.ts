import { expect, test } from "@playwright/test";
import { newGame, state } from "./helpers";

// One light end-to-end pass in 3D: a new game opens in the morning on Tobi, the guided start
// can be skipped, the first-morning chat plays at street level, tap to walk, "Show me" pans to
// the target, Follow Tobi and turning the view work, the Gist opens.
test("3D first minutes: morning start, street-level encounter, walk, show me, follow, gist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newGame(page, 42);
  await expect(page.getByTestId("clock")).toHaveText("06:40");

  // Morning of day 1, at home, camera centred on Tobi, guide up and the clock held.
  const s0 = await state(page);
  expect(s0.day).toBe(1);
  expect(s0.minute).toBe(6 * 60 + 40);
  expect(s0.locationId).toBe("loc_home_adeleke");
  expect(s0.guideOpen).toBe(true);
  // The WebGL city is drawing, in a handful of draw calls.
  await expect(page.locator(".stage canvas")).toBeVisible();
  await expect.poll(async () => (await state(page)).calls).toBeGreaterThan(5);
  expect((await state(page)).calls).toBeLessThan(60);
  expect((await state(page)).camera).toBe("city");
  const vp = page.viewportSize()!;
  const me = await page.evaluate(() => window.__liag.playerScreen());
  expect(Math.abs(me.x - vp.width / 2)).toBeLessThan(vp.width * 0.2);
  expect(Math.abs(me.y - vp.height / 2)).toBeLessThan(vp.height * 0.2);
  await expect(page.getByTestId("intro")).toBeVisible();

  // Skip the guide: the neighbour's welcome follows straight away, through the engine.
  await page.getByTestId("guide-skip").click();
  await expect(page.getByTestId("guide")).toBeHidden();
  const enc = page.getByTestId("encounter");
  await expect(enc).toBeVisible({ timeout: 10_000 });
  // The camera is down at street level beside the two of them.
  expect((await state(page)).camera).toBe("encounter");
  const choices = page.getByTestId("choices").locator("button");
  expect(await choices.count()).toBeGreaterThanOrEqual(2);
  await choices.first().click();
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 20_000 });
  // The result card speaks in plain words: no ids such as "tip:gig_leads" or "welcome_ada".
  const card = await page.getByTestId("result").innerText();
  expect(card).toContain("Ada told you where to find gig leads");
  expect(card).not.toMatch(/\b[a-z]+[:_][a-z_]+\b/);
  await page.getByTestId("result-ok").click();
  await expect(enc).toBeHidden();
  expect((await state(page)).sceneDone).toBe(true);
  expect((await state(page)).camera).toBe("city");

  // Tap a sidewalk tile: Tobi gets a street destination.
  await page.evaluate(() => window.__liag.centreOnTile(16, 16, 1));
  await page.waitForTimeout(200);
  const p = await page.evaluate(() => window.__liag.tileToScreen(16, 16));
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await state(page)).override?.tile).toEqual([16, 16]);

  // Look far away: the arrow points back to the target; "Show me" pans there.
  await page.evaluate(() => window.__liag.centreOnTile(3, 33, 1.2));
  await expect(page.getByTestId("edge-arrow")).toBeVisible();
  await page.getByTestId("show-me").click();
  await expect(page.getByTestId("show-me-sheet")).toBeVisible();
  await expect
    .poll(
      async () => {
        const f = await page.evaluate(() => window.__liag.focusScreen());
        return f ? Math.hypot(f.x - vp.width / 2, f.y - vp.height / 2) : 9999;
      },
      { timeout: 5_000 },
    )
    .toBeLessThan(vp.height * 0.3);
  await expect(page.getByTestId("walk-there")).toBeVisible();
  await page.locator("[data-testid=show-me-sheet] .close").click();

  // Follow Tobi at street level, then back; a quarter turn of the city view.
  await page.getByTestId("follow").click();
  await expect.poll(async () => (await state(page)).camera).toBe("follow");
  await page.getByTestId("follow").click();
  await expect.poll(async () => (await state(page)).camera).toBe("city");
  await page.getByTestId("zoom-toggle").click();
  await page.getByTestId("rotate-right").click();
  await page.getByTestId("zoom-toggle").click();

  await page.getByTestId("gist-open").click();
  await expect(page.getByTestId("gist").locator("li.entry").first()).toBeVisible();
  expect(errors).toEqual([]);
});
