// Runs before first paint so a saved theme does not flash the other one.
try {
  const saved = localStorage.getItem("kickrocks.theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
} catch {
  // Storage can be blocked; the system preference applies.
}
