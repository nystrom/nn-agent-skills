// Print the text a rendered review page actually shows, tab by tab.
// Usage: node visible_text.js <page.html>
// The page embeds its whole input as `const STATE = ...`, so searching the HTML
// proves nothing; this reads document.body.innerText after the JS has drawn it.
// Exits 77 when Playwright or a browser is unavailable, so callers can skip.
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { process.exit(77); }

(async () => {
  let browser;
  try { browser = await chromium.launch(); } catch { process.exit(77); }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto("file://" + path.resolve(process.argv[2]));
    // a collapsed <details> is drawn, one click away; open them so innerText sees it
    const shown = () => page.evaluate(() => {
      document.querySelectorAll("details").forEach(d => { d.open = true; });
      return document.body.innerText;
    });
    let out = await shown();
    await page.click('#tabs [data-tab="changes"]');
    out += "\n" + await shown();
    if (errors.length) out += "\nPAGE_ERROR " + errors.join("\nPAGE_ERROR ");
    process.stdout.write(out);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
