/*! Minimal markdown → safe HTML for chat / reports */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(text) {
    let s = escapeHtml(text);
    // code
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // bold / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
    // links [text](url)
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return s;
  }

  function isTableRow(line) {
    const t = String(line || "").trim();
    return t.startsWith("|") && t.indexOf("|", 1) !== -1;
  }

  function isTableSep(line) {
    const t = String(line || "").trim();
    if (!t.startsWith("|")) return false;
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
  }

  function splitCells(line) {
    let t = String(line || "").trim();
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|")) t = t.slice(0, -1);
    return t.split("|").map((c) => c.trim());
  }

  function renderTable(rows) {
    if (!rows.length) return "";
    const head = splitCells(rows[0]);
    let bodyStart = 1;
    if (rows.length > 1 && isTableSep(rows[1])) bodyStart = 2;

    let out = '<div class="md-table-wrap"><table><thead><tr>';
    for (const cell of head) out += "<th>" + inline(cell) + "</th>";
    out += "</tr></thead><tbody>";
    for (let r = bodyStart; r < rows.length; r++) {
      const cells = splitCells(rows[r]);
      out += "<tr>";
      for (let c = 0; c < head.length; c++) {
        out += "<td>" + inline(cells[c] || "") + "</td>";
      }
      out += "</tr>";
    }
    out += "</tbody></table></div>";
    return out;
  }

  function renderMarkdown(src) {
    const raw = String(src || "").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    /** @type {string[]} */
    const html = [];
    let i = 0;
    let inUl = false;
    let inOl = false;
    let inBq = false;

    function closeLists() {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
    }

    function closeBq() {
      if (inBq) {
        html.push("</blockquote>");
        inBq = false;
      }
    }

    while (i < lines.length) {
      const line = lines[i];

      // fenced code
      if (/^```/.test(line)) {
        closeLists();
        closeBq();
        i += 1;
        const code = [];
        while (i < lines.length && !/^```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1; // closing fence
        html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }

      // blank
      if (/^\s*$/.test(line)) {
        closeLists();
        closeBq();
        i += 1;
        continue;
      }

      // headings
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        closeLists();
        closeBq();
        const level = hm[1].length;
        html.push("<h" + level + ">" + inline(hm[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }

      // tables
      if (isTableRow(line)) {
        closeLists();
        closeBq();
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(lines[i]);
          i += 1;
        }
        html.push(renderTable(rows));
        continue;
      }

      // blockquote
      const bqm = line.match(/^>\s?(.*)$/);
      if (bqm) {
        closeLists();
        if (!inBq) {
          html.push("<blockquote>");
          inBq = true;
        }
        html.push("<p>" + inline(bqm[1]) + "</p>");
        i += 1;
        continue;
      }
      closeBq();

      // unordered list
      const ulm = line.match(/^[-*+]\s+(.*)$/);
      if (ulm) {
        if (inOl) {
          html.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          html.push("<ul>");
          inUl = true;
        }
        html.push("<li>" + inline(ulm[1]) + "</li>");
        i += 1;
        continue;
      }

      // ordered list
      const olm = line.match(/^\d+\.\s+(.*)$/);
      if (olm) {
        if (inUl) {
          html.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          html.push("<ol>");
          inOl = true;
        }
        html.push("<li>" + inline(olm[1]) + "</li>");
        i += 1;
        continue;
      }

      closeLists();

      // paragraph (merge consecutive plain lines)
      const para = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (
          /^\s*$/.test(next) ||
          /^```/.test(next) ||
          /^#{1,6}\s+/.test(next) ||
          /^>\s?/.test(next) ||
          /^[-*+]\s+/.test(next) ||
          /^\d+\.\s+/.test(next) ||
          isTableRow(next)
        ) {
          break;
        }
        para.push(next);
        i += 1;
      }
      html.push("<p>" + inline(para.join(" ")) + "</p>");
    }

    closeLists();
    closeBq();
    return html.join("\n");
  }

  global.renderMarkdown = renderMarkdown;
})(typeof window !== "undefined" ? window : globalThis);
