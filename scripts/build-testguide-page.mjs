// Builds the shareable version of docs/TESTGUIDE.md as a single self-contained HTML page in MaskinID's graphic
// profile (design-system/grafisk-profil.md, design-system/tokens.json).
//
//   node scripts/build-testguide-page.mjs            → .tmp/testguide.html
//   node scripts/build-testguide-page.mjs out.html   → a path of your choosing
//
// docs/TESTGUIDE.md is the original; this page is only a rendering of it, so changing the guide and re-running
// this script is the whole update procedure. The fonts are inlined as data URIs because the page is served under
// a strict CSP that blocks every external host — a linked webfont would fall back silently.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2] ?? join(root, ".tmp/testguide.html");
const md = readFileSync(join(root, "docs/TESTGUIDE.md"), "utf8");
const tokens = JSON.parse(readFileSync(join(root, "design-system/tokens.json"), "utf8"));

/** A colour token in both themes, straight from the profile. */
const c = (name) => {
  const t = tokens.color.tokens.find((x) => x.name === name);
  if (!t) throw new Error(`unknown colour token: ${name}`);
  return t.value;
};

const font = (file) => {
  const b64 = readFileSync(join(root, "apps/web/src/assets/fonts", file)).toString("base64");
  return `url(data:font/woff2;base64,${b64}) format("woff2")`;
};

// ---------- a small, deliberately limited markdown reader ----------
// Only what TESTGUIDE.md actually uses. Anything else should be added here rather than hand-edited into the HTML.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${href}" rel="noopener">${text}</a>`);
  // Bare URLs in table cells and prose.
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" rel="noopener">$2</a>');
  return h;
}

/** Splits a pipe table row, dropping the leading and trailing empties. */
const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((x) => x.trim());

// The profile allows the ID frame once per view, around the single most important identified value. Here that is
// the access block at the top: the address, the password and which database you are looking at.
let framedTable = false;

function render(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  const isTableDivider = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes("-");

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Fences are frequently indented, because the guide puts commands inside numbered steps.
    if (/^\s*```/.test(line)) {
      const indent = /^(\s*)/.exec(line)[1].length;
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++].slice(indent));
      i++;
      html.push(`<pre><code>${esc(body.join("\n").replace(/\s+$/, ""))}</code></pre>`);
      continue;
    }

    if (/^---+\s*$/.test(line)) { html.push('<hr aria-hidden="true" />'); i++; continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      // "### Runda 8 – ..." becomes a register post with the profile's 4 px top edge; everything else is a plain
      // heading. The sections of the guide really are a sequence, so the numbering carries meaning.
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push(`<blockquote>${render(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const thead = head.some(Boolean)
        ? `<thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead>`
        : "";
      const tbody = rows.map((r) => `<tr>${r.map((x) => `<td>${inline(x)}</td>`).join("")}</tr>`).join("");
      const table = `<div class="tabell-svep"><table>${thead}<tbody>${tbody}</tbody></table></div>`;
      if (!framedTable) {
        framedTable = true;
        html.push(`<div class="id-ram">${table}<span class="hornen" aria-hidden="true"></span></div>`);
      } else {
        html.push(table);
      }
      continue;
    }

    const ordered = /^\s*\d+\.\s+/.test(line);
    const bullet = /^\s*[-*]\s+/.test(line);
    if (ordered || bullet) {
      const items = [];
      const marker = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const other = ordered ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/;
      // An indented fence inside a step ends the list; the fence branch above then renders it.
      while (i < lines.length && lines[i].trim() && !other.test(lines[i]) && !/^\s*```/.test(lines[i])) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ""));
        else if (items.length) items[items.length - 1] += ` ${lines[i].trim()}`; // a wrapped list item
        else break;
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*[-*]\s|\s*\d+\.\s|---+\s*$)/.test(lines[i])
           && !(lines[i].includes("|") && isTableDivider(lines[i + 1] ?? ""))) {
      para.push(lines[i++]);
    }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return html.join("\n");
}

// The H1 and the lead paragraph become the page header; the rest is the body.
const body = render(md);
const title = /^#\s+(.*)$/m.exec(md)?.[1] ?? "Testguide";

const page = `<title>${esc(title)} – MaskinID</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @font-face { font-family: "Archivo Expanded"; src: ${font("ArchivoExpanded-VF.woff2")}; font-weight: 100 900; font-display: swap; }
  @font-face { font-family: "Archivo"; src: ${font("Archivo-VF.woff2")}; font-weight: 100 900; font-display: swap; }
  @font-face { font-family: "IBM Plex Mono"; src: ${font("IBMPlexMono-Regular.woff2")}; font-weight: 400; font-display: swap; }

  /* Light is the complete palette; the two blocks below redefine only these tokens. */
  :root {
    --maskin-svart: ${c("maskin-svart").ljust};
    --id-gul: ${c("id-gul").ljust};
    --yta: ${c("yta").ljust};
    --yta-2: ${c("yta-2").ljust};
    --text: ${c("text").ljust};
    --text-sekundar: ${c("text-sekundar").ljust};
    --linje: ${c("linje").ljust};
    --id-text: ${c("id-text").ljust};
    --status-sparr: ${c("status-sparr").ljust};
    --status-verifierad: ${c("status-verifierad").ljust};
    --stroke-register: ${tokens.stroke.tokens.find((x) => x.name === "stroke-register").value};
    --stroke-ram: ${tokens.stroke.tokens.find((x) => x.name === "stroke-ram").value};
    --ram: var(--maskin-svart);
    --display: "Archivo Expanded", "Archivo", "Arial Black", Arial, sans-serif;
    --brod: "Archivo", "Helvetica Neue", Arial, sans-serif;
    --mono: "IBM Plex Mono", Consolas, ui-monospace, monospace;
  }
  :root:not([data-theme="light"]) { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --yta: ${c("yta").morkt};
      --yta-2: ${c("yta-2").morkt};
      --text: ${c("text").morkt};
      --text-sekundar: ${c("text-sekundar").morkt};
      --linje: ${c("linje").morkt};
      --id-text: ${c("id-text").morkt};
      --status-sparr: ${c("status-sparr").morkt};
      --status-verifierad: ${c("status-verifierad").morkt};
      /* The register line is the strongest marking in the interface; on a black ground it has to be the yellow. */
      --ram: var(--id-gul);
    }
  }
  :root[data-theme="dark"] {
    --yta: ${c("yta").morkt};
    --yta-2: ${c("yta-2").morkt};
    --text: ${c("text").morkt};
    --text-sekundar: ${c("text-sekundar").morkt};
    --linje: ${c("linje").morkt};
    --id-text: ${c("id-text").morkt};
    --status-sparr: ${c("status-sparr").morkt};
    --status-verifierad: ${c("status-verifierad").morkt};
    --ram: var(--id-gul);
  }

  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--yta);
    color: var(--text);
    font-family: var(--brod);
    font-size: 16px;
    line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .sida { max-width: 61rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; display: flex; flex-direction: column; gap: 1.5rem; }

  /* Ordmärket: the wordmark is the sender. "Maskin" in black (white on a dark ground), "ID" in the yellow. */
  .ordmarke {
    font-family: var(--display); font-weight: 800; font-size: clamp(1.75rem, 5vw, 2.5rem);
    letter-spacing: -0.01em; line-height: 1; margin: 0;
  }
  .ordmarke span { color: var(--id-gul); }

  h1 {
    font-family: var(--display); font-weight: 800; font-size: clamp(1.9rem, 5.5vw, 3rem);
    line-height: 1.05; letter-spacing: -0.015em; margin: 0.5rem 0 0; text-wrap: balance;
  }
  h2 {
    font-family: var(--display); font-weight: 800; font-size: clamp(1.3rem, 3.2vw, 1.75rem);
    line-height: 1.15; letter-spacing: -0.01em; margin: 2.75rem 0 0; text-wrap: balance;
    padding-top: 1.25rem; border-top: var(--stroke-register) solid var(--ram);
  }
  h3 {
    font-family: var(--display); font-weight: 800; font-size: clamp(1.05rem, 2.4vw, 1.25rem);
    line-height: 1.25; margin: 2rem 0 0; text-wrap: balance;
  }
  h4 { font-family: var(--display); font-weight: 700; font-size: 1rem; margin: 1.5rem 0 0; }
  p, ul, ol { margin: 0; }
  p, li { max-width: 68ch; }
  ul, ol { padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
  li::marker { color: var(--text-sekundar); }
  ol { font-variant-numeric: tabular-nums; }
  a { color: var(--id-text); text-decoration: underline; text-underline-offset: 2px; }
  a:focus-visible, summary:focus-visible { outline: 3px solid var(--id-gul); outline-offset: 2px; }
  strong { font-weight: 700; }
  hr { display: none; }

  /* Identifiers only: serial numbers, registration numbers, organisation numbers, account names. */
  code {
    font-family: var(--mono); font-size: 0.875em; font-variant-numeric: tabular-nums slashed-zero;
    background: var(--yta-2); border: 1px solid var(--linje); padding: 0.1em 0.35em; white-space: nowrap;
  }
  pre {
    margin: 0; background: var(--yta-2); border: 1px solid var(--linje); border-left: 4px solid var(--ram);
    padding: 1rem; overflow-x: auto;
  }
  pre code { background: none; border: 0; padding: 0; white-space: pre; font-size: 0.8125rem; line-height: 1.55; }

  blockquote {
    margin: 0; padding: 1rem 1.25rem; background: var(--yta-2);
    border-left: 4px solid var(--id-gul); display: flex; flex-direction: column; gap: 0.75rem;
  }
  blockquote p { max-width: 64ch; }

  .tabell-svep { overflow-x: auto; border: 1px solid var(--linje); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
  th, td { text-align: left; vertical-align: top; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--linje); }
  th { font-family: var(--brod); font-weight: 700; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase;
       color: var(--text-sekundar); background: var(--yta-2); white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  td code { white-space: nowrap; }

  /* ID-ramen: four corner brackets around the one identified value that matters most on the page. Used once. */
  .id-ram { position: relative; padding: 1.25rem 1.5rem; background: var(--yta-2); }
  .id-ram::before, .id-ram::after,
  .id-ram > .hornen::before, .id-ram > .hornen::after {
    content: ""; position: absolute; width: 1.25rem; height: 1.25rem; border: var(--stroke-ram) solid var(--ram);
  }
  .id-ram::before { top: 0; left: 0; border-right: 0; border-bottom: 0; }
  .id-ram::after { top: 0; right: 0; border-left: 0; border-bottom: 0; }
  .id-ram > .hornen::before { bottom: 0; left: 0; border-right: 0; border-top: 0; }
  .id-ram > .hornen::after { bottom: 0; right: 0; border-left: 0; border-top: 0; }
  .id-ram .tabell-svep { border: 0; }
  .id-ram th { background: none; }

  .avsandare { display: flex; flex-direction: column; gap: 0.25rem; }
  .avsandare .etikett {
    font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-sekundar);
  }
  footer { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--linje); color: var(--text-sekundar); font-size: 0.875rem; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
<div class="sida">
  <header class="avsandare">
    <p class="ordmarke">Maskin<span>ID</span></p>
    <p class="etikett">Testguide – staging</p>
  </header>
  ${body}
  <footer>
    <p>Byggd från <code>docs/TESTGUIDE.md</code> i repot. Ändra guiden där och kör
    <code>node scripts/build-testguide-page.mjs</code> för att bygga om den här sidan.</p>
  </footer>
</div>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`${out} · ${Math.round(page.length / 1024)} kB`);
