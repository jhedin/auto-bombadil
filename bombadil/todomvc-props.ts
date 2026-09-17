/**
 * TodoMVC invariants, in the spirit of Quickstrom's TodoMVC specification.
 * Each property reads one extracted snapshot of the app and states a rule
 * that must hold in every state.
 */
import { always, eventually, now } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";

type Filter = "all" | "active" | "completed";

type Item = { completed: boolean; editing: boolean; title: string };

export type TodoSnapshot = {
  items: Item[];
  /** The filter the app claims to show: its selected filter link, else the route. */
  filter: Filter;
  /** The filter the URL asks for, or null when the URL has no route. */
  routeFilter: Filter | null;
  /** Whether a filter link is marked selected at all. */
  hasSelectedFilter: boolean;
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
  const filterOf = (route: string): Filter =>
    route.includes("completed") ? "completed" : route.includes("active") ? "active" : "all";
  const hash = state.window.location.hash;
  const routeFilter: Filter | null = hash.length > 1 ? filterOf(hash) : null;
  const selected = d.querySelector<HTMLAnchorElement>(".filters .selected");
  const hasSelectedFilter = selected !== null;
  const filter: Filter = selected ? filterOf(selected.getAttribute("href") ?? "") : (routeFilter ?? "all");
  const countText = d.querySelector(".todo-count")?.textContent?.trim() ?? "";
  const countNumber = parseInt(countText, 10);
  const toggleAll = d.querySelector<HTMLInputElement>(".toggle-all");
  const clear = d.querySelector(".clear-completed");
  const newTodo = d.querySelector<HTMLInputElement>(".new-todo");
  return {
    items,
    filter,
    routeFilter,
    hasSelectedFilter,
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

/**
 * The selected filter link agrees with the route. Routing may be asynchronous,
 * so a mismatch must resolve within two seconds; one that persists means the
 * app changed its filter without updating the URL, or the other way round.
 */
export const selectedFilterMatchesRoute = always(
  now(() => {
    const t = snap();
    return t.hasSelectedFilter && t.routeFilter !== null && t.filter !== t.routeFilter;
  }).implies(
    eventually(() => {
      const t = snap();
      return !t.hasSelectedFilter || t.routeFilter === null || t.filter === t.routeFilter;
    }).within(2, "seconds"),
  ),
);
