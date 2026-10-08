// Runs inside the page. Collects clipped boxes, truncated sentences and small tap targets.
export function inspectPage({ minTarget, checkTargets }) {
  const signature = (el) => {
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/) : [];
    return `${el.tagName.toLowerCase()}${classes.length ? `.${classes.slice(0, 4).join(".")}` : ""}`;
  };
  const describe = (el) => {
    const label = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 28) || "";
    return `${signature(el)} "${label}"`;
  };
  // Screen-reader-only text is clipped to a pixel on purpose.
  const hiddenByDesign = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.position === "absolute" && s.width === "1px" && s.height === "1px") return true;
    }
    return false;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const stretchedBox = (el) => {
    const after = getComputedStyle(el, "::after");
    if (after.position !== "absolute" || after.content === "none") return null;
    const filled = ["top", "right", "bottom", "left"].every((side) => after[side] === "0px");
    if (!filled) return null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).position !== "static") return p;
    }
    return null;
  };
  const overflow = [];
  const ellipsised = [];
  const small = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || hiddenByDesign(el)) continue;
    const s = getComputedStyle(el);
    const clipsX = s.overflowX === "hidden" || s.overflowX === "clip" || s.overflowX === "visible";
    if (
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth > 0 &&
      clipsX &&
      s.display !== "inline"
    ) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      const truncating = s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      if (truncating) {
        if (text.split(" ").length >= 4) ellipsised.push(`${describe(el)}`);
      } else if (s.overflowX !== "visible") {
        overflow.push(describe(el));
      }
    }
    if (s.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (text.split(" ").length >= 4) ellipsised.push(describe(el));
    }
  }
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) overflow.push("document horizontal scroll");
  if (checkTargets) {
    const selector =
      "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch]";
    for (const el of document.body.querySelectorAll(selector)) {
      if (!visible(el) || el.closest("[hidden], [inert]")) continue;
      const s = getComputedStyle(el);
      if (el.tagName === "A" && s.display === "inline") continue;
      if (hiddenByDesign(el)) continue;
      const r = el.getBoundingClientRect();
      // A label wrapping the control is the real hit area for a checkbox or radio, and a link whose
      // ::after fills its positioned ancestor makes that whole box the hit area.
      const hit = (stretchedBox(el) ?? el.closest("label"))?.getBoundingClientRect() ?? r;
      const w = Math.max(r.width, hit.width);
      const h = Math.max(r.height, hit.height);
      if (w < minTarget || h < minTarget) small.push(signature(el));
    }
  }
  return { overflow, ellipsised, small };
}
