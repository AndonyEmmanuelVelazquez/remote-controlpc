// Translate controller InputEvents into real OS mouse/keyboard actions via nut.js.
import {
  mouse,
  keyboard,
  screen,
  Button,
  Key,
  Point,
} from "@nut-tree-fork/nut-js";
import type { InputEvent, MouseButton } from "../../../shared/types";

// Fire instantly; no artificial delays between actions.
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 99999;
keyboard.config.autoDelayMs = 0;

const BUTTON: Record<MouseButton, Button> = {
  left: Button.LEFT,
  right: Button.RIGHT,
  middle: Button.MIDDLE,
};

// Map browser KeyboardEvent.key values -> nut.js Key. Printable chars not listed
// here fall through to keyboard.type().
const KEY: Record<string, Key> = {
  Enter: Key.Enter,
  Tab: Key.Tab,
  Backspace: Key.Backspace,
  Delete: Key.Delete,
  Escape: Key.Escape,
  " ": Key.Space,
  ArrowUp: Key.Up,
  ArrowDown: Key.Down,
  ArrowLeft: Key.Left,
  ArrowRight: Key.Right,
  Home: Key.Home,
  End: Key.End,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Control: Key.LeftControl,
  Alt: Key.LeftAlt,
  Shift: Key.LeftShift,
  Meta: Key.LeftSuper,
  CapsLock: Key.CapsLock,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
};

let cachedSize: { w: number; h: number } | null = null;
async function screenSize(): Promise<{ w: number; h: number }> {
  if (!cachedSize) {
    cachedSize = { w: await screen.width(), h: await screen.height() };
  }
  return cachedSize;
}

/** Re-read screen size (call on resolution change). */
export function invalidateScreenSize(): void {
  cachedSize = null;
}

async function moveToNormalized(x: number, y: number): Promise<void> {
  const { w, h } = await screenSize();
  const px = Math.round(clamp01(x) * (w - 1));
  const py = Math.round(clamp01(y) * (h - 1));
  await mouse.setPosition(new Point(px, py));
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function nutKey(key: string): Key | null {
  if (key in KEY) return KEY[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= "A" && upper <= "Z") return Key[upper as keyof typeof Key] as Key;
    if (key >= "0" && key <= "9") return Key[("Num" + key) as keyof typeof Key] as Key;
  }
  return null;
}

export async function dispatch(ev: InputEvent): Promise<void> {
  switch (ev.t) {
    case "mm":
      await moveToNormalized(ev.x, ev.y);
      break;
    case "md":
      await moveToNormalized(ev.x, ev.y);
      await mouse.pressButton(BUTTON[ev.b]);
      break;
    case "mu":
      await moveToNormalized(ev.x, ev.y);
      await mouse.releaseButton(BUTTON[ev.b]);
      break;
    case "click":
      await moveToNormalized(ev.x, ev.y);
      if (ev.double) await mouse.doubleClick(BUTTON[ev.b]);
      else await mouse.click(BUTTON[ev.b]);
      break;
    case "scroll":
      if (ev.dy) ev.dy > 0 ? await mouse.scrollDown(ev.dy) : await mouse.scrollUp(-ev.dy);
      if (ev.dx) ev.dx > 0 ? await mouse.scrollRight(ev.dx) : await mouse.scrollLeft(-ev.dx);
      break;
    case "kd": {
      const k = nutKey(ev.key);
      if (k !== null) await keyboard.pressKey(k);
      else if (ev.key.length === 1) await keyboard.type(ev.key);
      break;
    }
    case "ku": {
      const k = nutKey(ev.key);
      if (k !== null) await keyboard.releaseKey(k);
      break;
    }
    case "type":
      if (ev.text) await keyboard.type(ev.text);
      break;
  }
}
