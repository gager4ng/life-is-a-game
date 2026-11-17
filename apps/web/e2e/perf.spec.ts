import { test } from "@playwright/test";
import { newGame, skipGuideAndScene, state } from "./helpers";

// Frame-rate check on the Low setting. Run on demand: PERF=1 pnpm e2e
// Uses the computer's real GPU (headless Chromium otherwise draws in software) and slows the
// CPU down 4x to stand in for a mid-range phone. Prints the numbers; it does not fail on them.
test.skip(!process.env.PERF, "set PERF=1 to measure the frame rate");
test.use({
  launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] },
});

test("frame rate on Low", async ({ page }) => {
  await newGame(page, 1);
  await skipGuideAndScene(page);
  await page.evaluate(() => window.__liag.setQuality("low"));
  const cdp = await page.context().newCDPSession(page);
  const measure = async (label: string): Promise<void> => {
    await page.waitForTimeout(1500);
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1000);
      samples.push((await state(page)).fps);
    }
    const s = await state(page);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(
      `${label}: ${Math.round(avg)} fps (min ${Math.min(...samples)}), ${s.calls} draw calls, ${s.triangles} triangles`,
    );
  };
  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.evaluate(() => window.__liag.centrePlayer(1.2));
    await measure(`city view, day, CPU x${rate}`);
    await page.evaluate(() => window.__liag.setFollow(true));
    await measure(`follow Tobi, CPU x${rate}`);
    await page.evaluate(() => window.__liag.setFollow(false));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.evaluate(() => window.__liag.runToRainyNight());
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => window.__liag.centreOnTile(28, 18, 1.2));
  await measure("city view, rainy night, CPU x4");
});
