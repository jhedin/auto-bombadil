/**
 * A faster input generator for form-driven apps. Bombadil's default types up
 * to 100 random characters with up to 100 ms between them, which is most of
 * the wall clock on TodoMVC. Short strings and frequent Enter keep the app
 * moving; Escape and Backspace stay in the mix for edit flows.
 */
import { actions, extract, weighted, type ActionTemplate } from "@antithesishq/bombadil/browser";

const activeInputType = extract((state) => {
  const el = state.document.activeElement;
  if (!el || el === state.document.body) return null;
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLInputElement) return el.type;
  return null;
});

const ENTER = 13;
const ESCAPE = 27;
const BACKSPACE = 8;

export const fastInputs = actions(() => {
  const type = activeInputType.current;
  if (type !== "text" && type !== "textarea") return [];
  const typeText: ActionTemplate = {
    TypeText: { text: { Text: [1, 12] }, delayMillis: [1, 5] },
  };
  return weighted([
    [4, typeText],
    [3, { PressKey: { code: ENTER } }],
    [1, { PressKey: { code: ESCAPE } }],
    [1, { PressKey: { code: BACKSPACE } }],
  ]).generate();
});
