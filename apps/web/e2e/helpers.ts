import type { Page } from "@playwright/test";

export interface LiagState {
  tick: number;
  minute: number;
  locationId: string;
  travelling: boolean;
  street: [number, number] | null;
  override: { locationId: string; tile: [number, number] | null } | null;
  inEncounter: boolean;
  weather: string;
}

type Api = {
  state(): LiagState;
  tileToScreen(x: number, y: number): { x: number; y: number };
  centreOnTile(x: number, y: number, zoom?: number): void;
  setSpeed(s: number): void;
  centrePlayer(zoom?: number): void;
  runUntilEncounter(max?: number): boolean;
  runTo(tick: number): void;
};

declare global {
  interface Window {
    __liag: Api;
  }
}

/** Open the game on a fixed seed and start a new game. */
export async function newGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId("new-game").click();
  await page.waitForFunction(() => !!window.__liag);
}

export function state(page: Page): Promise<LiagState> {
  return page.evaluate(() => window.__liag.state());
}
