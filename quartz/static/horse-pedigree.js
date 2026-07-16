(() => {
  "use strict"

  const MIN_SCALE = 0.25
  const MAX_SCALE = 3
  const NODE_W = 170
  const NODE_H = 58
  const X_GAP = 70
  const Y_GAP = 105
  const PADDING = 80

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("sv-SE")
  }

  function isPedigreePage() {
    const path = decodeURIComponent(location.pathname).replace(/\/$/, "").toLowerCase()
    const slug = String(document.body?.dataset?.slug || "").toLowerCase()
    const value = `${path} ${slug}`

    return (
      value.includes("02.3-stamtavlor") ||
      value.includes("02.3 stamtavlor") ||
      /(?:^|[\/\s])stamtavlor(?:[\/\s]|$)/i.test(value) ||
      /(?:^|[\/\s])stamtavla(?:-|\s|$)/i.test(value)
    )
  }

  function findMermaidSource(article) {
    const candidates = [
      ...article.querySelectorAll("pre > code.language-mermaid"),
      ...article.querySelectorAll('pre > code[data-language="mermaid"]'),
      ...article.querySelectorAll(".mermaid"),
    ]
    for (const candidate of candidates) {
      const text = candidate.textContent || ""
      if (/\bflowchart\s+(TB|TD|LR|RL|BT)\b/i.test(text)) return { element: candidate, text }
    }
    return null
  }

  function parseSource(source) {
    const nodes = new Map()
    const edges = []
    const nodePattern = /^\s*([A-Za-z][\w-]*)\s*\[\s*["'](.+?)["']\s*\]\s*;?\s*$/
    const edgePattern = /^\s*([A-Za-z][\w-]*)\s*--+>\s*(?:\|([^|]+)\|\s*)?([A-Za-z][\w-]*)\s*;?\s*$/

    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("%%") || /^flowchart\b/i.test(line) || /^class\b/i.test(line)) continue
      const nodeMatch = line.match(nodePattern)
      if (nodeMatch) {
        nodes.set(nodeMatch[1], { id: nodeMatch[1], label: nodeMatch[2].replace(/<br\s*\/?\s*>/gi, " ") })
        continue
      }
      const edgeMatch = line.match(edgePattern)
      if (edgeMatch) {
        edges.push({ from: edgeMatch[1], to: edgeMatch[3], label: (edgeMatch[2] || "").trim() })
      }
    }

    for (const edge of edges) {
      if (!nodes.has(edge.from)) nodes.set(edge.from, { id: edge.from, label: edge.from })
      if (!nodes.has(edge.to)) nodes.set(edge.to, { id: edge.to, label: edge.to })
    }
    return { nodes: [...nodes.values()], edges }
  }

  function linkMap(article) {
    const map = new Map()
    for (const anchor of article.querySelectorAll("table a[href], a.internal[href]")) {
      const text = normalize(anchor.textContent)
      if (text && /^h-\d+/i.test(text)) map.set(text, anchor.href)
    }
    return map
  }

  function fallbackHref(label) {
    const base = new URL("../../", location.href)
    const path = `02. Register/02.1 Hästar/${label}`
    return new URL(path.split("/").map(encodeURIComponent).join("/"), base).href
  }

  function splitLabel(label) {
    const match = label.match(/^(H-\d+)\s+(.+)$/i)
    return match ? { id: match[1], name: match[2] } : { id: "", name: label }
  }

  function computeLevels(nodes, edges) {
    const incoming = new Map(nodes.map((n) => [n.id, []]))
    const outgoing = new Map(nodes.map((n) => [n.id, []]))
    for (const edge of edges) {
      incoming.get(edge.to)?.push(edge.from)
      outgoing.get(edge.from)?.push(edge.to)
    }

    const level = new Map()
    const roots = nodes.filter((node) => (incoming.get(node.id)?.length || 0) === 0)
    const queue = (roots.length ? roots : nodes).map((node) => node.id)
    for (const id of queue) level.set(id, 0)

    let guard = 0
    while (queue.length && guard++ < nodes.length * nodes.length + 10) {
      const current = queue.shift()
      const currentLevel = level.get(current) || 0
      for (const child of outgoing.get(current) || []) {
        const proposed = currentLevel + 1
        if (!level.has(child) || proposed > level.get(child)) {
          level.set(child, proposed)
          queue.push(child)
        }
      }
    }

    for (const node of nodes) if (!level.has(node.id)) level.set(node.id, 0)
    return level
  }

  function layoutGraph(data) {
    const levels = computeLevels(data.nodes, data.edges)
    const groups = new Map()
    for (const node of data.nodes) {
      const depth = levels.get(node.id) || 0
      if (!groups.has(depth)) groups.set(depth, [])
      groups.get(depth).push(node)
    }

    const maxCount = Math.max(1, ...[...groups.values()].map((items) => items.length))
    const maxDepth = Math.max(0, ...groups.keys())
    const canvasWidth = PADDING * 2 + (maxDepth + 1) * NODE_W + maxDepth * X_GAP
    const canvasHeight = PADDING * 2 + maxCount * NODE_H + Math.max(0, maxCount - 1) * Y_GAP
    const positions = new Map()

    for (const [depth, items] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      items.sort((a, b) => a.label.localeCompare(b.label, "sv"))
      const columnHeight = items.length * NODE_H + Math.max(0, items.length - 1) * Y_GAP
      const startY = (canvasHeight - columnHeight) / 2
      items.forEach((node, index) => {
        positions.set(node.id, {
          x: PADDING + depth * (NODE_W + X_GAP),
          y: startY + index * (NODE_H + Y_GAP),
        })
      })
    }
    return { positions, width: canvasWidth, height: canvasHeight }
  }

  function svgElement(name, attrs = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
    return element
  }

  function createSvg(data, links) {
    const layout = layoutGraph(data)
    const svg = svgElement("svg", {
      class: "pedigree-svg",
      width: layout.width,
      height: layout.height,
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      role: "img",
      "aria-label": "Interaktiv stamtavla",
    })

    const edgeGroup = svgElement("g", { class: "pedigree-edges" })
    for (const edge of data.edges) {
      const from = layout.positions.get(edge.from)
      const to = layout.positions.get(edge.to)
      if (!from || !to) continue
      const x1 = from.x + NODE_W
      const y1 = from.y + NODE_H / 2
      const x2 = to.x
      const y2 = to.y + NODE_H / 2
      const midX = (x1 + x2) / 2
      edgeGroup.append(svgElement("path", {
        class: "pedigree-edge",
        d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      }))
      if (edge.label) {
        const label = svgElement("text", { class: "pedigree-edge-label", x: midX, y: (y1 + y2) / 2 - 5 })
        label.textContent = edge.label
        edgeGroup.append(label)
      }
    }
    svg.append(edgeGroup)

    const nodeGroup = svgElement("g", { class: "pedigree-nodes" })
    for (const node of data.nodes) {
      const pos = layout.positions.get(node.id)
      if (!pos) continue
      const parts = splitLabel(node.label)
      const href = links.get(normalize(node.label)) || fallbackHref(node.label)
      const anchor = svgElement("a", { class: "pedigree-node-link", href, tabindex: "0" })
      const group = svgElement("g", { class: "pedigree-node", transform: `translate(${pos.x} ${pos.y})` })
      group.append(svgElement("rect", { width: NODE_W, height: NODE_H }))
      const name = svgElement("text", { x: NODE_W / 2, y: parts.id ? 25 : 34, "text-anchor": "middle" })
      name.textContent = parts.name.length > 22 ? `${parts.name.slice(0, 21)}…` : parts.name
      group.append(name)
      if (parts.id) {
        const id = svgElement("text", { class: "pedigree-node-id", x: NODE_W / 2, y: 44, "text-anchor": "middle" })
        id.textContent = parts.id
        group.append(id)
      }
      anchor.append(group)
      nodeGroup.append(anchor)
    }
    svg.append(nodeGroup)
    return svg
  }

  function button(label, title, handler) {
    const el = document.createElement("button")
    el.type = "button"
    el.className = "pedigree-control"
    el.textContent = label
    el.title = title
    el.addEventListener("click", handler)
    return el
  }

  function createWorkspace(data, links) {
    const shell = document.createElement("section")
    shell.className = "pedigree-workspace"
    shell.dataset.pedigreeReady = "true"

    const toolbar = document.createElement("div")
    toolbar.className = "pedigree-toolbar"
    const viewport = document.createElement("div")
    viewport.className = "pedigree-viewport"
    viewport.tabIndex = 0
    const stage = document.createElement("div")
    stage.className = "pedigree-stage"
    const svg = createSvg(data, links)
    stage.append(svg)
    viewport.append(stage)
    const zoomValue = document.createElement("span")
    zoomValue.className = "pedigree-zoom-value"

    let scale = 1
    let tx = 0
    let ty = 0
    let drag = null

    function apply() {
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
      zoomValue.textContent = `${Math.round(scale * 100)} %`
    }

    function fit() {
      const bounds = viewport.getBoundingClientRect()
      const naturalWidth = Number(svg.getAttribute("width")) || 1
      const naturalHeight = Number(svg.getAttribute("height")) || 1
      scale = clamp(Math.min((bounds.width - 48) / naturalWidth, (bounds.height - 48) / naturalHeight, 1.35), MIN_SCALE, MAX_SCALE)
      tx = (bounds.width - naturalWidth * scale) / 2
      ty = (bounds.height - naturalHeight * scale) / 2
      apply()
    }

    function zoomAt(factor, clientX, clientY) {
      const rect = viewport.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
      const worldX = (px - tx) / scale
      const worldY = (py - ty) / scale
      scale = next
      tx = px - worldX * scale
      ty = py - worldY * scale
      apply()
    }

    toolbar.append(
      button("Zooma in", "Zooma in", () => zoomAt(1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2)),
      button("Zooma ut", "Zooma ut", () => zoomAt(1 / 1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2)),
      button("Anpassa", "Visa hela stamtavlan", fit),
      button("Återställ", "Återställ till 100 procent", () => { scale = 1; tx = 40; ty = 40; apply() }),
      button("Helskärm", "Öppna i helskärm", () => shell.requestFullscreen?.()),
      zoomValue,
    )

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault()
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)
    }, { passive: false })

    viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest("a")) return
      viewport.setPointerCapture(event.pointerId)
      drag = { x: event.clientX, y: event.clientY, tx, ty }
      viewport.classList.add("is-dragging")
    })
    viewport.addEventListener("pointermove", (event) => {
      if (!drag) return
      tx = drag.tx + event.clientX - drag.x
      ty = drag.ty + event.clientY - drag.y
      apply()
    })
    const endDrag = () => { drag = null; viewport.classList.remove("is-dragging") }
    viewport.addEventListener("pointerup", endDrag)
    viewport.addEventListener("pointercancel", endDrag)

    viewport.addEventListener("keydown", (event) => {
      const step = 35
      if (event.key === "+" || event.key === "=") zoomAt(1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2)
      else if (event.key === "-") zoomAt(1 / 1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2)
      else if (event.key === "0") fit()
      else if (event.key === "ArrowLeft") tx += step
      else if (event.key === "ArrowRight") tx -= step
      else if (event.key === "ArrowUp") ty += step
      else if (event.key === "ArrowDown") ty -= step
      else return
      event.preventDefault()
      apply()
    })

    const hint = document.createElement("div")
    hint.className = "pedigree-hint"
    hint.textContent = "Dra i den tomma ytan för att panorera. Använd mushjulet för att zooma. Klicka på en häst för att öppna profilen."

    shell.append(toolbar, viewport, hint)
    requestAnimationFrame(() => requestAnimationFrame(fit))
    new ResizeObserver(() => fit()).observe(viewport)
    return shell
  }

  function initialize() {
    const article = document.querySelector("article")
    if (!article || article.dataset.pedigreeInitialized === "true") return

    const source = findMermaidSource(article)
    const active = isPedigreePage() || Boolean(source)
    document.body.classList.toggle("pedigree-page", active)

    if (!active || !source) return

    const data = parseSource(source.text)
    if (!data.nodes.length) return
    const workspace = createWorkspace(data, linkMap(article))
    const replaceTarget = source.element.matches("code") ? source.element.closest("pre") : source.element
    replaceTarget.replaceWith(workspace)
    article.dataset.pedigreeInitialized = "true"
  }

  document.addEventListener("DOMContentLoaded", initialize)
  document.addEventListener("nav", () => requestAnimationFrame(initialize))
  new MutationObserver(() => requestAnimationFrame(initialize)).observe(document.documentElement, { childList: true, subtree: true })
})()
