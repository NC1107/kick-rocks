// Runs inside the page. Everything it needs is defined in the function body because Playwright
// serialises it. Returns the raw material that budget.mjs scores.
export function collectScreen(scope = {}) {
  const dialog = document.querySelector("dialog[open], [role=dialog], [role=alertdialog]");
  const scoped = scope.id ? document.getElementById(scope.id) : null;
  const root = dialog ?? scoped ?? document.body;
  const viewportOnly = Boolean(scope.viewportOnly) && !dialog && !scoped;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const ROW = "li, tr, article, [role=row], [role=listitem], [data-row]";
  const CRUMBS = "nav, [aria-label=Breadcrumb], [aria-label=breadcrumb]";
  const USER_CONTENT = "pre, code, blockquote, [data-user-content]";
  const NOT_HELP =
    "button, a, label, summary, th, option, kbd, [role=heading], h1, h2, h3, h4, h5, h6, [role=tab], [role=button], select, input, textarea";
  const MIN_STACKED_WORDS = 5;
  const FORM_CONTROL = new Set(["SELECT", "INPUT", "TEXTAREA", "BUTTON"]);
  const clean = (text) => text.replace(/\s+/g, " ").trim();
  const words = (text) => clean(text).split(" ").filter(Boolean).length;

  const shown = (element) =>
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    !element.closest("[aria-hidden=true], [inert]");
  const box = (element) => element.getBoundingClientRect();
  const real = (rect) => rect.width > 1 && rect.height > 1;

  let inView = 0;
  let inPage = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const count = words(node.nodeValue ?? "");
    if (!parent || count === 0 || SKIP.has(parent.tagName) || !shown(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!real(rect)) continue;
    inPage += count;
    if (rect.bottom > 0 && rect.top < window.innerHeight) inView += count;
  }

  const inViewport = (element) => {
    const rect = box(element);
    return rect.bottom > 0 && rect.top < window.innerHeight;
  };
  const visible = (element) =>
    shown(element) && real(box(element)) && (!viewportOnly || inViewport(element));
  const headingEls = [...root.querySelectorAll("h1, h2, h3, [role=heading]")].filter(
    (h) => visible(h) && clean(h.textContent ?? ""),
  );
  const headings = headingEls.map((h) => clean(h.textContent ?? "").split(" · ")[0]);

  const flowText = (element) => {
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
      else if (child.nodeType === Node.ELEMENT_NODE && !SKIP.has(child.tagName)) {
        const inline = getComputedStyle(child).display.startsWith("inline");
        if (inline && !FORM_CONTROL.has(child.tagName) && real(box(child)))
          text += ` ${child.textContent}`;
      }
    }
    return clean(text);
  };

  const blocks = [];
  const blockEls = [];
  for (const element of root.querySelectorAll("*")) {
    if (SKIP.has(element.tagName) || getComputedStyle(element).display.startsWith("inline"))
      continue;
    if (element.closest(NOT_HELP) || element.closest(USER_CONTENT)) continue;
    if (!visible(element)) continue;
    const text = flowText(element);
    if (words(text) === 0) continue;
    blocks.push(text);
    blockEls.push(element);
  }

  const inRow = (element) => element.closest(ROW) !== null;
  // Help split into sibling paragraphs is still several sentences on the screen, so the budget
  // reads each run of them as one block. Titles in callouts and empty states are not paragraphs.
  const stacks = new Map();
  blockEls.forEach((element, index) => {
    const parent = element.parentElement;
    if (
      !parent ||
      parent.closest("[data-copy-pair]") ||
      element.tagName !== "P" ||
      inRow(element) ||
      words(blocks[index]) < MIN_STACKED_WORDS
    )
      return;
    stacks.set(parent, [...(stacks.get(parent) ?? []), blocks[index]]);
  });
  const phrases = [
    ...headings.filter((_, i) => !inRow(headingEls[i]) && !headingEls[i].closest(CRUMBS)),
    ...blocks.filter((_, i) => !inRow(blockEls[i]) && !blockEls[i].closest(CRUMBS)),
  ];
  const actions = [...root.querySelectorAll("button, a[href], [role=button]")]
    .filter((e) => visible(e) && !inRow(e))
    .map((e) =>
      clean(e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || ""),
    )
    .filter(Boolean);

  return {
    words: scoped ? inPage : inView,
    fullWords: inPage,
    headings,
    blocks,
    stacks: [...stacks.values()].filter((texts) => texts.length > 1),
    repeatable: { phrases, actions },
    dialogOpen: dialog !== null,
  };
}
