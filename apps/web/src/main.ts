import "./style.css";
import { Game } from "./game/app";
import type { Storage } from "./game/session";
import { Session } from "./game/session";
import { el } from "./ui/dom";
import { titleScreen } from "./ui/panels";
import { t } from "./ui/text";

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem("x");
    return s;
  } catch {
    return null; // private mode or blocked: play without saving
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  const params = new URLSearchParams(location.search);
  const store = storage();
  const start = async (session: Session): Promise<void> => {
    root.replaceChildren(el("div", { class: "loading" }, t("loading")));
    const game = new Game(root, session);
    root.replaceChildren();
    await game.start();
  };
  const newGame = (): void => {
    const seed = params.has("seed")
      ? Number(params.get("seed"))
      : Math.floor(Math.random() * 1_000_000);
    void start(Session.newGame(store, seed));
  };
  const title = titleScreen(
    Session.hasSave(store),
    () => {
      const s = Session.continueGame(store);
      if (s) void start(s);
      else newGame();
    },
    newGame,
  );
  root.replaceChildren(title);
}

void boot();
