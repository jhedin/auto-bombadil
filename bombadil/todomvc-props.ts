/**
 * TodoMVC invariants, in the spirit of Quickstrom's TodoMVC specification.
 * Each property reads one extracted snapshot of the app and states a rule
 * that must hold in every state.
 */
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";

type Filter = "all" | "active" | "completed";

type Item = { completed: boolean; editing: boolean; title: string };

export type TodoSnapshot = {
  items: Item[];
  filter: Filter;
  countText: string;
  count: number | null;
  toggleAllChecked: boolean | null;
  clearVisible: boolean;
  footerVisible: boolean;
  mainVisible: boolean;
  newTodoValue: string;
  newTodoFocused: boolean;
};

function shown(el: Element | null): boolean {
  if (!el) return false;
  return (el as HTMLElement).offsetParent !== null || getComputedStyle(el).display !== "none";
}

const todo = extract((state): TodoSnapshot => {
  const d = state.document;
  const items: Item[] = [...d.querySelectorAll(".todo-list li")].map((li) => ({
    completed: li.classList.contains("completed"),
    editing: li.classList.contains("editing"),
    title: li.querySelector("label")?.textContent ?? "",
  }));
  const hash = state.window.location.hash;
  const filter: Filter = hash.includes("completed") ? "completed" : hash.includes("active") ? "active" : "all";
  const countText = d.querySelector(".todo-count")?.textContent?.trim() ?? "";
  const countNumber = parseInt(countText, 10);
  const toggleAll = d.querySelector<HTMLInputElement>(".toggle-all");
  const clear = d.querySelector(".clear-completed");
  const newTodo = d.querySelector<HTMLInputElement>(".new-todo");
  return {
    items,
    filter,
    countText,
    count: Number.isNaN(countNumber) ? null : countNumber,
    toggleAllChecked: toggleAll?.checked ?? null,
    clearVisible: shown(clear) && (clear?.textContent?.trim() ?? "") !== "",
    footerVisible: shown(d.querySelector(".footer")),
    mainVisible: shown(d.querySelector(".main")),
    newTodoValue: newTodo?.value ?? "",
    newTodoFocused: d.activeElement === newTodo,
  };
});

/** Typed view of the current snapshot. */
const snap = (): TodoSnapshot => todo.current as TodoSnapshot;

/** Under the Active filter every listed item is active. */
export const activeFilterShowsOnlyActive = always(() => {
  const t = snap();
  return t.filter !== "active" || t.items.every((i) => !i.completed);
});

/** Under the Completed filter every listed item is completed. */
export const completedFilterShowsOnlyCompleted = always(() => {
  const t = snap();
  return t.filter !== "completed" || t.items.every((i) => i.completed);
});

/** "N items left" equals the number of active items, whenever they are all listed. */
export const itemsLeftMatchesActiveItems = always(() => {
  const t = snap();
  if (t.filter === "completed" || t.items.length === 0) return true;
  return t.count === t.items.filter((i) => !i.completed).length;
});

/** The count pluralizes: "1 item left", otherwise "items left". */
export const itemsLeftIsGrammatical = always(() => {
  const t = snap();
  if (t.count === null || !t.footerVisible) return true;
  return t.count === 1 ? /\b1 item left\b/.test(t.countText) : /\bitems left\b/.test(t.countText);
});

/** "Clear completed" is offered exactly when a completed item exists (All filter). */
export const clearCompletedOfferedIffCompletedExists = always(() => {
  const t = snap();
  if (t.filter !== "all") return true;
  return t.clearVisible === t.items.some((i) => i.completed);
});

/** The toggle-all checkbox is checked exactly when every item is completed (All filter). */
export const toggleAllReflectsItems = always(() => {
  const t = snap();
  if (t.filter !== "all" || t.items.length === 0 || t.toggleAllChecked === null) return true;
  return t.toggleAllChecked === t.items.every((i) => i.completed);
});

/** Main section and footer are hidden exactly when there are no items (All filter). */
export const chromeHiddenWhenEmpty = always(() => {
  const t = snap();
  if (t.filter !== "all") return true;
  const empty = t.items.length === 0;
  return t.footerVisible === !empty && t.mainVisible === !empty;
});

/** Item titles are never blank once rendered. */
export const noBlankTitles = always(() =>
  snap().items.every((i) => i.editing || i.title.trim() !== ""),
);
