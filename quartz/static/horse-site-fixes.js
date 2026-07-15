(() => {
  "use strict"

  const SKIP = new Set(["SCRIPT", "STYLE", "PRE", "CODE", "TEXTAREA", "A"])

  function rootHref(target) {
    const clean = String(target || "").trim().replace(/\.md$/i, "")
    const path = clean.split("/").map(encodeURIComponent).join("/")
    return new URL(`/${path}`, location.origin).href
  }

  function makeInternalLink(target, label) {
    const link = document.createElement("a")
    link.className = "internal"
    link.href = rootHref(target)
    link.textContent = String(label || target).trim()
    return link
  }

  function parseWikiLinks(text) {
    const links = []
    const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
    let match
    while ((match = regex.exec(text))) {
      links.push({ target: match[1].trim(), label: (match[2] || match[1]).trim() })
    }
    return links
  }

  function repairPedigreeTables(article) {
    for (const table of article.querySelectorAll("table")) {
      const headers = [...(table.tHead?.rows[0]?.cells || [])].map((cell) =>
        (cell.textContent || "").trim().toLocaleLowerCase("sv-SE"),
      )
      const isPedigreeTable =
        headers.length === 4 &&
        headers[0] === "häst" &&
        headers[1] === "ägare" &&
        headers[2] === "uppfödare" &&
        headers[3] === "rank"
      if (!isPedigreeTable) continue

      for (const body of table.tBodies) {
        for (const row of [...body.rows]) {
          const raw = [...row.cells].map((cell) => cell.textContent || "").join("|")
          const links = parseWikiLinks(raw)
          if (links.length < 4) continue

          const values = links.slice(0, 4)
          const cells = values.map(({ target, label }, index) => {
            const td = document.createElement("td")
            td.dataset.column = headers[index]
            td.append(makeInternalLink(target, label))
            return td
          })
          row.replaceChildren(...cells)
        }
      }
      table.classList.add("pedigree-data-table")
    }
  }

  function renderInlineMarkdown(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.parentElement || SKIP.has(node.parentElement.tagName)) continue
      if (/\*\*[^*]+\*\*|\[\[[^\]]+\]\]/.test(node.nodeValue || "")) nodes.push(node)
    }

    for (const node of nodes) {
      const text = node.nodeValue || ""
      const pattern = /(\*\*([^*]+)\*\*)|(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g
      let match
      let last = 0
      const fragment = document.createDocumentFragment()
      while ((match = pattern.exec(text))) {
        fragment.append(text.slice(last, match.index))
        if (match[1]) {
          const strong = document.createElement("strong")
          strong.textContent = match[2]
          fragment.append(strong)
        } else {
          fragment.append(makeInternalLink(match[4], match[5] || match[4]))
        }
        last = pattern.lastIndex
      }
      fragment.append(text.slice(last))
      node.replaceWith(fragment)
    }
  }

  function removeSizeCallout(article) {
    for (const callout of article.querySelectorAll(".callout")) {
      const title = callout.querySelector(".callout-title")?.textContent || ""
      const text = callout.textContent || ""
      if (/storlek och zoom/i.test(title) || /diagrammet växer automatiskt/i.test(text)) {
        callout.remove()
      }
    }
  }

  function normalizeSidebar() {
    const right = document.querySelector(".sidebar.right")
    if (!right) return
    for (const child of right.children) child.classList.add("right-panel-card")

    const toc = right.querySelector(".toc")
    const tocTitle = toc?.querySelector("h3, h2, button")
    if (tocTitle && /table of contents/i.test(tocTitle.textContent || "")) {
      for (const node of tocTitle.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          node.nodeValue = (node.nodeValue || "").replace(/Table of Contents/i, "Innehåll på sidan")
        }
      }
    }
  }

  let scheduled = false
  function initialize() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      const article = document.querySelector("article")
      if (article) {
        repairPedigreeTables(article)
        renderInlineMarkdown(article)
        removeSizeCallout(article)
      }
      normalizeSidebar()
    })
  }

  document.addEventListener("DOMContentLoaded", initialize)
  document.addEventListener("nav", initialize)
  new MutationObserver(initialize).observe(document.documentElement, { childList: true, subtree: true })
})()
