// The printable shortcuts card (shortcuts.html).
import "./shortcuts-page.css";
import { keysHtml, SHORTCUT_GROUPS } from "./lib/shortcuts.js";

document.getElementById("groups").innerHTML = SHORTCUT_GROUPS.map((g) => `
  <section>
    <h2>${g.title}</h2>
    <table>${g.rows.map(([keys, action, kind]) => `<tr><th>${keysHtml(keys, kind)}</th><td>${action}</td></tr>`).join("")}</table>
  </section>`).join("");
document.getElementById("print").addEventListener("click", () => window.print());
