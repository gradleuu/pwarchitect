const WORLD_W = 80;
const WORLD_H = 60;
const TILE_BASE = 32;

interface TileTexture {
  id: string;
  baseName: string;
  categoryId: string;
  frames: HTMLImageElement[];
  altFrame: HTMLImageElement | null;
  tileW: number;
  tileH: number;
  pixW: number;
  pixH: number;
}

interface TileCategory {
  id: string;
  name: string;
  zAxis: number;
  textures: TileTexture[];
}

interface PlacedTile {
  textureId: string;
  tileW: number;
  tileH: number;
  zAxis: number;
}

interface WorldCell {
  [z: number]: PlacedTile | null;
}

interface Background {
  name: string;
  layers: HTMLImageElement[];
  enabled: boolean;
  parallaxFactors: number[];
}

interface WorldState {
  grid: (WorldCell | null)[][];
  backgrounds: { name: string; enabled: boolean }[];
}

interface CellDelta {
  x: number;
  y: number;
  z: number;
  before: PlacedTile | null;
  after: PlacedTile | null;
}

let categories: TileCategory[] = [];
let backgrounds: Background[] = [];
let selectedCategory: TileCategory | null = null;
let selectedTexture: TileTexture | null = null;
let tileSearch = "";

let grid: (WorldCell | null)[][] = [];
let zLayers: { z: number; visible: boolean }[] = [];
let activeZ = 0;

const undoStack: CellDelta[][] = [];
const redoStack: CellDelta[][] = [];
const MAX_HISTORY = 100;

type Tool = "paint" | "fill" | "rect" | "line" | "pick";
let tool: Tool = "paint";
let showGrid = true;
let showAlt = true;
let animEnabled = true;

let zoom = 1.0;
let panX = 0;
let panY = 0;

let isDragging = false;
let isErasing = false;
let isPanning = false;

let shapeStartTx = -1;
let shapeStartTy = -1;
let shapeCurTx = -1;
let shapeCurTy = -1;

let panVX = 0;
let panVY = 0;
let lastPanX = 0;
let lastPanY = 0;
let panAnimId = 0;

let animFrame = 0;

let bgCanvas: HTMLCanvasElement;
let worldCanvas: HTMLCanvasElement;
let gridCanvas: HTMLCanvasElement;
let cursorCanvas: HTMLCanvasElement;
let bgCtx: CanvasRenderingContext2D;
let worldCtx: CanvasRenderingContext2D;
let gridCtx: CanvasRenderingContext2D;
let cursorCtx: CanvasRenderingContext2D;
let container: HTMLElement;
let canvasArea: HTMLElement;

const CANVAS_W = WORLD_W * TILE_BASE;
const CANVAS_H = WORLD_H * TILE_BASE;

export async function initEditor() {
  initGrid();
  setupCanvases();
  await loadAssets();
  setupUI();
  setupInput();
  centerView();
  renderAll();
  startAnimLoop();
}

function initGrid() {
  grid = Array.from({ length: WORLD_H }, () =>
    Array.from({ length: WORLD_W }, () => null),
  );
}

function centerView() {
  const area = canvasArea.getBoundingClientRect();
  panX = (area.width - CANVAS_W) / 2;
  panY = (area.height - CANVAS_H) / 2;
  applyPanZoom();
}

function setupCanvases() {
  bgCanvas = document.getElementById("bg-canvas") as HTMLCanvasElement;
  worldCanvas = document.getElementById("world-canvas") as HTMLCanvasElement;
  gridCanvas = document.getElementById("grid-canvas") as HTMLCanvasElement;
  cursorCanvas = document.getElementById("cursor-canvas") as HTMLCanvasElement;
  container = document.getElementById("viewport-container") as HTMLElement;
  canvasArea = document.getElementById("canvas-area") as HTMLElement;

  [bgCanvas, worldCanvas, gridCanvas, cursorCanvas].forEach((c) => {
    c.width = CANVAS_W;
    c.height = CANVAS_H;
  });

  container.style.width = CANVAS_W + "px";
  container.style.height = CANVAS_H + "px";

  bgCtx = bgCanvas.getContext("2d")!;
  worldCtx = worldCanvas.getContext("2d")!;
  gridCtx = gridCanvas.getContext("2d")!;
  cursorCtx = cursorCanvas.getContext("2d")!;
}

async function loadAssets() {
  await loadBackgrounds();
  await loadCategories();
}

async function loadBackgrounds() {
  backgrounds = [];
  try {
    const resp = await fetch("/assets/backgrounds/_index.json");
    if (!resp.ok) return;
    const index: { groups: string[] } = await resp.json();

    let first = true;
    for (const groupName of index.groups) {
      const bg: Background = {
        name: groupName,
        layers: [],
        enabled: first,
        parallaxFactors: [],
      };

      let i = 0;
      while (true) {
        const img = await loadImageMaybe(
          `/assets/backgrounds/${groupName}_${i}.png`,
        );
        if (!img) break;
        bg.layers.push(img);
        bg.parallaxFactors.push(i === 0 ? 0 : 0.2 * i);
        i++;
      }

      if (bg.layers.length > 0) {
        backgrounds.push(bg);
        first = false;
      }
    }
  } catch {
    /* no backgrounds */
  }
}

async function loadCategories() {
  categories = [];
  try {
    const resp = await fetch("/assets/_index.json");
    if (!resp.ok) return;
    const index: { folders: string[] } = await resp.json();

    for (const folder of index.folders) {
      // metadata should sit next to the folder in assets/
      const metaResp = await fetch(`/assets/${folder}.metadata`);
      if (!metaResp.ok) continue;
      const meta = parseMetadata(await metaResp.text());

      const cat: TileCategory = {
        id: folder,
        name: meta.name || folder,
        zAxis: parseInt(meta.z ?? meta.zAxis ?? "0") || 0,
        textures: [],
      };

      const texResp = await fetch(`/assets/${folder}/_textures.json`);
      if (!texResp.ok) continue;
      const texIndex: { files: string[] } = await texResp.json();

      const grouped = groupTextureFiles(texIndex.files, folder);
      for (const [baseName, info] of Object.entries(grouped)) {
        const tex = await buildTexture(baseName, folder, cat.zAxis, info);
        if (tex) cat.textures.push(tex);
      }

      if (cat.textures.length > 0) categories.push(cat);
    }
  } catch {}

  rebuildZLayers();
}

interface TextureInfo {
  frames: string[];
  altFile: string | null;
}

function groupTextureFiles(
  files: string[],
  folder: string,
): Record<string, TextureInfo> {
  const grouped: Record<string, TextureInfo> = {};
  for (const file of files) {
    if (!file.endsWith(".png")) continue;
    const name = file.slice(0, -4);
    if (name.endsWith("_Alt")) {
      const base = name.slice(0, -4);
      if (!grouped[base]) grouped[base] = { frames: [], altFile: null };
      grouped[base].altFile = `/assets/${folder}/${file}`;
      continue;
    }
    const frameMatch = name.match(/^(.+?)_(\d+)$/);
    if (frameMatch) {
      const base = frameMatch[1];
      const frameIdx = parseInt(frameMatch[2]);
      if (!grouped[base]) grouped[base] = { frames: [], altFile: null };
      grouped[base].frames[frameIdx] = `/assets/${folder}/${file}`;
    } else {
      if (!grouped[name]) grouped[name] = { frames: [], altFile: null };
      if (grouped[name].frames.length === 0)
        grouped[name].frames[0] = `/assets/${folder}/${file}`;
    }
  }
  return grouped;
}

async function buildTexture(
  baseName: string,
  folder: string,
  _z: number,
  info: TextureInfo,
): Promise<TileTexture | null> {
  const frameImgs: HTMLImageElement[] = [];
  for (const url of info.frames) {
    if (!url) continue;
    const img = await loadImageMaybe(url);
    if (img) frameImgs.push(img);
  }
  if (frameImgs.length === 0) return null;
  const altImg = info.altFile ? await loadImageMaybe(info.altFile) : null;
  const ref = frameImgs[0];
  const pixW = ref.naturalWidth,
    pixH = ref.naturalHeight;
  return {
    id: `${folder}:${baseName}`,
    baseName,
    categoryId: folder,
    frames: frameImgs,
    altFrame: altImg,
    tileW: Math.max(1, Math.round(pixW / TILE_BASE)),
    tileH: Math.max(1, Math.round(pixH / TILE_BASE)),
    pixW,
    pixH,
  };
}

function parseMetadata(text: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    r[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return r;
}

function loadImageMaybe(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function rebuildZLayers() {
  const zSet = new Set<number>();
  categories.forEach((c) => zSet.add(c.zAxis));
  if (zSet.size === 0) zSet.add(0);
  const existing = new Map(zLayers.map((l) => [l.z, l]));
  zLayers = [...zSet]
    .sort((a, b) => a - b)
    .map((z) => ({
      z,
      visible: existing.get(z)?.visible ?? true,
    }));
  if (!zLayers.find((l) => l.z === activeZ) && zLayers.length > 0)
    activeZ = zLayers[0].z;
  renderLayerList();
}

function pushHistory(deltas: CellDelta[]) {
  if (deltas.length === 0) return;
  undoStack.push(deltas);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  updateHistStatus();
}

function undo() {
  const deltas = undoStack.pop();
  if (!deltas) return;
  for (const d of deltas) applyDelta(d.x, d.y, d.z, d.before);
  redoStack.push(deltas);
  renderWorld();
  updateHistStatus();
}

function redo() {
  const deltas = redoStack.pop();
  if (!deltas) return;
  for (const d of deltas) applyDelta(d.x, d.y, d.z, d.after);
  undoStack.push(deltas);
  renderWorld();
  updateHistStatus();
}

function applyDelta(x: number, y: number, z: number, tile: PlacedTile | null) {
  if (!grid[y][x]) grid[y][x] = {};
  grid[y][x]![z] = tile;
}

function updateHistStatus() {
  const el = document.getElementById("status-hist");
  if (el) el.textContent = `Undo:${undoStack.length} Redo:${redoStack.length}`;
}

function setupUI() {
  renderCategoryList();
  renderLayerList();
  renderToolList();
  setupMenubar();
  setupSearch();
}

function setupSearch() {
  const input = document.getElementById("tile-search") as HTMLInputElement;
  input.addEventListener("input", () => {
    tileSearch = input.value.toLowerCase().trim();
    renderTilePalette();
  });
}

function renderCategoryList() {
  const el = document.getElementById("category-list")!;
  el.innerHTML = "";
  for (const cat of categories) {
    const item = document.createElement("div");
    item.className = "cat-item" + (selectedCategory === cat ? " selected" : "");
    item.innerHTML = `<span>${cat.name}</span><span class="cat-z">z:${cat.zAxis}</span>`;
    item.addEventListener("click", () => {
      selectedCategory = cat;
      renderCategoryList();
      renderTilePalette();
    });
    el.appendChild(item);
  }
  if (categories.length === 0) {
    el.innerHTML =
      '<div style="padding:8px;color:#555;font-size:11px;">No categories found.<br>Add assets/ folder.</div>';
  }
}

function getFilteredTextures(): TileTexture[] {
  if (!tileSearch) return selectedCategory?.textures ?? [];
  const all: TileTexture[] = [];
  for (const cat of categories) {
    for (const tex of cat.textures) {
      if (
        tex.baseName.toLowerCase().includes(tileSearch) ||
        cat.name.toLowerCase().includes(tileSearch)
      ) {
        all.push(tex);
      }
    }
  }
  return all;
}

function renderTilePalette() {
  const el = document.getElementById("tile-palette")!;
  el.innerHTML = "";
  const textures = getFilteredTextures();
  for (const tex of textures) {
    const item = document.createElement("div");
    item.className = "tile-item" + (selectedTexture === tex ? " selected" : "");
    item.title =
      tex.baseName +
      (tex.frames.length > 1 ? ` (${tex.frames.length} frames)` : "");
    const img = document.createElement("img");
    img.src = tex.frames[0].src;
    img.alt = tex.baseName;
    item.appendChild(img);
    item.addEventListener("click", () => selectTexture(tex));
    el.appendChild(item);
  }
  if (textures.length === 0 && tileSearch) {
    el.innerHTML =
      '<div style="padding:8px;color:#555;font-size:11px;">No matches.</div>';
  }
}

function selectTexture(tex: TileTexture) {
  selectedTexture = tex;
  const cat = categories.find((c) => c.id === tex.categoryId);
  if (cat) {
    activeZ = cat.zAxis;
    if (!tileSearch) selectedCategory = cat;
    renderCategoryList();
    renderLayerList();
  }
  renderTilePalette();
  updateSelectedTileInfo();
}

function updateSelectedTileInfo() {
  const preview = document.getElementById("sel-tile-preview")!;
  const nameEl = document.getElementById("sel-tile-name")!;
  preview.innerHTML = "";
  if (selectedTexture) {
    const img = document.createElement("img");
    img.src =
      selectedTexture.frames[animFrame % selectedTexture.frames.length].src;
    preview.appendChild(img);
    nameEl.textContent =
      selectedTexture.baseName +
      (selectedTexture.frames.length > 1
        ? ` [${selectedTexture.frames.length}f]`
        : "") +
      (selectedTexture.altFrame ? " +Alt" : "");
  } else {
    nameEl.textContent = "No tile selected";
  }
}

function renderLayerList() {
  const el = document.getElementById("layer-list")!;
  el.innerHTML = "";
  for (const layer of zLayers) {
    const item = document.createElement("div");
    item.className =
      "layer-item" +
      (layer.z === activeZ ? " selected" : "") +
      (layer.visible ? " visible" : "");
    const cat = categories.find((c) => c.zAxis === layer.z);
    const label = cat ? cat.name : `z:${layer.z}`;
    item.innerHTML = `<span>${label}</span><span class="layer-z">z:${layer.z}</span><span class="layer-eye">👁</span>`;
    item.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("layer-eye")) {
        layer.visible = !layer.visible;
        renderLayerList();
        renderWorld();
      } else {
        activeZ = layer.z;
        renderLayerList();
      }
    });
    el.appendChild(item);
  }
}

function renderToolList() {
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    const b = btn as HTMLButtonElement;
    b.classList.toggle("active", b.dataset.tool === tool);
    b.addEventListener("click", () => {
      tool = b.dataset.tool as Tool;
      renderToolList();
    });
  });
}

function setupMenubar() {
  document.getElementById("btn-new-world")!.addEventListener("click", () => {
    showModal(
      "New World",
      "Create a new empty world? All unsaved changes will be lost.",
      () => {
        initGrid();
        undoStack.length = 0;
        redoStack.length = 0;
        updateHistStatus();
        renderWorld();
      },
    );
  });

  document
    .getElementById("btn-export-world")!
    .addEventListener("click", saveWorld);

  document.getElementById("btn-load-world")!.addEventListener("click", () => {
    const input = document.getElementById("file-input") as HTMLInputElement;
    input.onchange = () => {
      if (!input.files?.length) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          loadWorldState(JSON.parse(e.target!.result as string));
        } catch {
          alert("Failed to parse world file.");
        }
      };
      reader.readAsText(input.files[0]);
      input.value = "";
    };
    input.click();
  });

  const gridBtn = document.getElementById("btn-toggle-grid")!;
  gridBtn.addEventListener("click", () => {
    showGrid = !showGrid;
    gridBtn.classList.toggle("active", showGrid);
    renderGrid();
  });

  const animBtn = document.getElementById("btn-toggle-anim")!;
  animBtn.addEventListener("click", () => {
    animEnabled = !animEnabled;
    animBtn.classList.toggle("active", animEnabled);
  });

  const altBtn = document.getElementById("btn-toggle-alt")!;
  altBtn.addEventListener("click", () => {
    showAlt = !showAlt;
    altBtn.classList.toggle("active", showAlt);
    renderWorld();
  });

  document
    .getElementById("btn-bg-manage")!
    .addEventListener("click", openBgManager);
}

function saveWorld() {
  const state: WorldState = {
    grid: grid.map((row) => row.map((cell) => cell)),
    backgrounds: backgrounds.map((b) => ({ name: b.name, enabled: b.enabled })),
  };
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "world.json";
  a.click();
  URL.revokeObjectURL(url);
}

function openBgManager() {
  const content = document.getElementById("modal-content")!;
  content.innerHTML = "";

  if (backgrounds.length === 0) {
    content.innerHTML = `<div class="bg-info">No backgrounds found.<br>Add .png files to <code>assets/backgrounds/</code> and an <code>_index.json</code> manifest.</div>`;
  } else {
    const list = document.createElement("div");
    list.id = "bg-manage-list";

    for (const bg of backgrounds) {
      const entry = document.createElement("div");
      entry.className = "bg-entry";

      const thumb = document.createElement("img");
      if (bg.layers.length > 0) thumb.src = bg.layers[0].src;

      const changeBtn = document.createElement("button");
      changeBtn.textContent = "Change";
      changeBtn.style.padding = "2px 8px";
      changeBtn.style.fontSize = "11px";
      changeBtn.style.border = "1px solid #555";
      changeBtn.style.borderRadius = "3px";
      changeBtn.style.background = "#333";
      changeBtn.style.color = "#ddd";
      changeBtn.style.cursor = "pointer";
      changeBtn.addEventListener(
        "mouseover",
        () => (changeBtn.style.background = "#444"),
      );
      changeBtn.addEventListener(
        "mouseout",
        () => (changeBtn.style.background = "#333"),
      );

      changeBtn.addEventListener("click", () => {
        backgrounds.forEach((b) => (b.enabled = false));
        bg.enabled = true;
        renderBg();
      });

      const nameEl = document.createElement("span");
      nameEl.className = "bg-name";
      nameEl.textContent = `${bg.name}`;

      entry.append(thumb, changeBtn, nameEl);
      list.appendChild(entry);
    }

    content.appendChild(list);
  }

  showModal("Manage Backgrounds", "", null, true, () => renderBg());
}

function setupInput() {
  const el = cursorCanvas;
  el.addEventListener("mousedown", onMouseDown);
  canvasArea.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button === 1 && !isPanning) {
      e.preventDefault();
      isPanning = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      panVX = 0;
      panVY = 0;
      cancelAnimationFrame(panAnimId);
    }
  });
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  el.addEventListener("mouseleave", onMouseLeave);
  el.addEventListener("wheel", onWheel, { passive: false });
  canvasArea.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", onKeyDown);
}

function clientToTile(
  clientX: number,
  clientY: number,
): { tx: number; ty: number } | null {
  const rect = cursorCanvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const cx = mx / (rect.width / CANVAS_W);
  const cy = my / (rect.height / CANVAS_H);
  const tx = Math.floor(cx / TILE_BASE);
  const ty = Math.floor(cy / TILE_BASE);
  if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return null;
  return { tx, ty };
}

function onMouseDown(e: MouseEvent) {
  e.preventDefault();

  if (e.button === 1) {
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    panVX = 0;
    panVY = 0;
    cancelAnimationFrame(panAnimId);
    return;
  }

  if (e.button === 2) {
    const pos = clientToTile(e.clientX, e.clientY);
    if (!pos) return;
    isErasing = true;
    beginErase(pos.tx, pos.ty);
    return;
  }

  if (e.button !== 0) return;

  const pos = clientToTile(e.clientX, e.clientY);

  if (tool === "paint") {
    isDragging = true;
    if (pos) beginPaint(pos.tx, pos.ty);
  } else if (tool === "fill") {
    if (pos) {
      const deltas = floodFill(pos.tx, pos.ty);
      pushHistory(deltas);
      renderWorld();
    }
  } else if (tool === "rect" || tool === "line") {
    isDragging = true;
    if (pos) {
      shapeStartTx = pos.tx;
      shapeStartTy = pos.ty;
      shapeCurTx = pos.tx;
      shapeCurTy = pos.ty;
    }
  } else if (tool === "pick") {
    if (pos) pickTile(pos.tx, pos.ty);
  }
}

let strokeDeltas: CellDelta[] = [];

function beginPaint(tx: number, ty: number) {
  strokeDeltas = [];
  paintAt(tx, ty);
}

function beginErase(tx: number, ty: number) {
  strokeDeltas = [];
  eraseAt(tx, ty);
}

function paintAt(tx: number, ty: number) {
  if (!selectedTexture) return;
  if (
    tx < 0 ||
    ty < 0 ||
    tx + selectedTexture.tileW > WORLD_W ||
    ty + selectedTexture.tileH > WORLD_H
  )
    return;
  if (!grid[ty][tx]) grid[ty][tx] = {};
  const before = grid[ty][tx]![activeZ] ?? null;
  const after: PlacedTile = {
    textureId: selectedTexture.id,
    tileW: selectedTexture.tileW,
    tileH: selectedTexture.tileH,
    zAxis: activeZ,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  strokeDeltas.push({ x: tx, y: ty, z: activeZ, before, after });
  grid[ty][tx]![activeZ] = after;
  renderWorld();
}

function eraseAt(tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;
  if (!grid[ty][tx]) return;
  const before = grid[ty][tx]![activeZ] ?? null;
  if (before === null) return;
  strokeDeltas.push({ x: tx, y: ty, z: activeZ, before, after: null });
  grid[ty][tx]![activeZ] = null;
  renderWorld();
}

function onMouseMove(e: MouseEvent) {
  if (isPanning) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    panVX = dx;
    panVY = dy;
    panX += dx;
    panY += dy;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    applyPanZoom();
    return;
  }

  const pos = clientToTile(e.clientX, e.clientY);

  if (pos) {
    document.getElementById("status-cursor")!.textContent =
      `Cursor: ${pos.tx}, ${pos.ty}`;
    const cell = grid[pos.ty]?.[pos.tx];
    const layer = cell?.[activeZ];
    document.getElementById("status-tile")!.textContent = layer
      ? `Tile: ${layer.textureId} z:${layer.zAxis}`
      : "Tile: none";
  }

  if (isDragging) {
    if (tool === "paint" && pos) paintAt(pos.tx, pos.ty);
    if (isErasing && pos) eraseAt(pos.tx, pos.ty);

    if ((tool === "rect" || tool === "line") && pos) {
      shapeCurTx = pos.tx;
      shapeCurTy = pos.ty;
    }
  }

  if (isErasing && pos) eraseAt(pos.tx, pos.ty);

  drawCursorPreview(pos);
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 1) {
    isPanning = false;
    startPanGlide();
    return;
  }

  if (e.button === 2) {
    if (strokeDeltas.length > 0) pushHistory([...strokeDeltas]);
    strokeDeltas = [];
    isErasing = false;
    return;
  }

  if (e.button !== 0) return;

  if (isDragging) {
    if (tool === "paint") {
      if (strokeDeltas.length > 0) pushHistory([...strokeDeltas]);
      strokeDeltas = [];
    } else if (tool === "rect" && shapeStartTx >= 0) {
      const pos = clientToTile(e.clientX, e.clientY);
      const ex = pos ? pos.tx : shapeCurTx;
      const ey = pos ? pos.ty : shapeCurTy;
      const deltas = applyRect(shapeStartTx, shapeStartTy, ex, ey);
      pushHistory(deltas);
      renderWorld();
      shapeStartTx = shapeStartTy = -1;
    } else if (tool === "line" && shapeStartTx >= 0) {
      const pos = clientToTile(e.clientX, e.clientY);
      const ex = pos ? pos.tx : shapeCurTx;
      const ey = pos ? pos.ty : shapeCurTy;
      const deltas = applyLine(shapeStartTx, shapeStartTy, ex, ey);
      pushHistory(deltas);
      renderWorld();
      shapeStartTx = shapeStartTy = -1;
    }
    isDragging = false;
  }
}

function onMouseLeave() {
  clearCursor();
}

function startPanGlide() {
  cancelAnimationFrame(panAnimId);
  const FRICTION = 0.88;
  function glide() {
    if (Math.abs(panVX) < 0.3 && Math.abs(panVY) < 0.3) return;
    panVX *= FRICTION;
    panVY *= FRICTION;
    panX += panVX;
    panY += panVY;
    applyPanZoom();
    panAnimId = requestAnimationFrame(glide);
  }
  panAnimId = requestAnimationFrame(glide);
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  cancelAnimationFrame(panAnimId);
  panVX = 0;
  panVY = 0;

  const rect = cursorCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const oldZoom = zoom;
  zoom = Math.max(0.1, Math.min(8, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const ratio = zoom / oldZoom;
  panX = mx - ratio * (mx - panX);
  panY = my - ratio * (my - panY);

  applyPanZoom();
  document.getElementById("status-zoom")!.textContent =
    `Zoom: ${Math.round(zoom * 100)}%`;
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.key === "y") {
      e.preventDefault();
      redo();
      return;
    }
  }

  switch (e.key.toLowerCase()) {
    case "b":
      setTool("paint");
      break;
    case "f":
      setTool("fill");
      break;
    case "r":
      setTool("rect");
      break;
    case "l":
      setTool("line");
      break;
    case "p":
      setTool("pick");
      break;
    case "g":
      document.getElementById("btn-toggle-grid")!.click();
      break;
    case "+":
    case "=":
      zoom = Math.min(8, zoom * 1.12);
      applyPanZoom();
      break;
    case "-":
      zoom = Math.max(0.1, zoom / 1.12);
      applyPanZoom();
      break;
    case "0":
      zoom = 1;
      centerView();
      break;
  }
}

function setTool(t: Tool) {
  tool = t;
  shapeStartTx = shapeStartTy = -1;
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    const b = btn as HTMLButtonElement;
    b.classList.toggle("active", b.dataset.tool === t);
  });
}

function applyPanZoom() {
  container.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  renderBg();
}

function floodFill(startX: number, startY: number): CellDelta[] {
  if (!selectedTexture) return [];
  const deltas: CellDelta[] = [];
  const targetZ = activeZ;
  const targetCell = grid[startY]?.[startX];
  const targetId = targetCell ? (targetCell[targetZ]?.textureId ?? null) : null;
  const fillId = selectedTexture.id;
  if (targetId === fillId) return [];
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const cell = grid[y]?.[x];
    const tileId = cell ? (cell[targetZ]?.textureId ?? null) : null;
    if (tileId !== targetId) continue;
    if (!grid[y][x]) grid[y][x] = {};
    const before = grid[y][x]![targetZ] ?? null;
    const after: PlacedTile = {
      textureId: fillId,
      tileW: 1,
      tileH: 1,
      zAxis: targetZ,
    };
    deltas.push({ x, y, z: targetZ, before, after });
    grid[y][x]![targetZ] = after;
    stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  return deltas;
}

function applyRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CellDelta[] {
  if (!selectedTexture) return [];
  const deltas: CellDelta[] = [];
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(WORLD_W - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(WORLD_H - 1, Math.max(y0, y1));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!grid[y][x]) grid[y][x] = {};
      const before = grid[y][x]![activeZ] ?? null;
      const after: PlacedTile = {
        textureId: selectedTexture.id,
        tileW: 1,
        tileH: 1,
        zAxis: activeZ,
      };
      deltas.push({ x, y, z: activeZ, before, after });
      grid[y][x]![activeZ] = after;
    }
  }
  return deltas;
}

function applyLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CellDelta[] {
  if (!selectedTexture) return [];
  const deltas: CellDelta[] = [];
  const cells = bresenham(x0, y0, x1, y1);
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
    if (!grid[y][x]) grid[y][x] = {};
    const before = grid[y][x]![activeZ] ?? null;
    const after: PlacedTile = {
      textureId: selectedTexture.id,
      tileW: 1,
      tileH: 1,
      zAxis: activeZ,
    };
    deltas.push({ x, y, z: activeZ, before, after });
    grid[y][x]![activeZ] = after;
  }
  return deltas;
}

function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] {
  const pts: [number, number][] = [];
  let dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0,
    cy = y0;
  while (true) {
    pts.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return pts;
}

function pickTile(tx: number, ty: number) {
  const cell = grid[ty]?.[tx];
  if (!cell) return;
  const zKeys = Object.keys(cell)
    .map(Number)
    .sort((a, b) => b - a);
  for (const z of zKeys) {
    const placed = cell[z];
    if (!placed) continue;
    const tex = findTexture(placed.textureId);
    if (tex) {
      const cat = categories.find((c) => c.id === tex.categoryId);
      if (cat) {
        selectedCategory = cat;
        renderCategoryList();
        renderTilePalette();
      }
      selectTexture(tex);
      activeZ = placed.zAxis;
      renderLayerList();
    }
    break;
  }
}

function findTexture(id: string): TileTexture | null {
  for (const cat of categories) {
    const tex = cat.textures.find((t) => t.id === id);
    if (tex) return tex;
  }
  return null;
}

function renderAll() {
  renderBg();
  renderWorld();
  renderGrid();
}

function renderBg() {
  bgCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  bgCtx.fillStyle = "#1a1a2e";
  bgCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const scrollOffX = panX / zoom;
  const scrollOffY = panY / zoom;

  for (const bg of backgrounds) {
    if (!bg.enabled) continue;

    for (let i = 0; i < bg.layers.length; i++) {
      const img = bg.layers[i];
      if (!img || !img.naturalWidth || !img.naturalHeight) continue;

      if (i === 0) {
        bgCtx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      } else {
        const factor = bg.parallaxFactors[i] ?? 0;

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const scale = CANVAS_W / imgW;
        const maxScale = 6.0;
        const finalScale = Math.min(scale, maxScale);

        const drawW = imgW * finalScale;
        const drawH = imgH * finalScale;

        const y = ((CANVAS_H - drawH) / 2) * factor * 2;
        const baseX =
          ((CANVAS_W - drawW) / 2 - scrollOffX) * factor + scrollOffX;

        for (let dx = -1; dx <= 1; dx++) {
          const x = baseX + dx * drawW;
          bgCtx.drawImage(img, x, y, drawW, drawH);
        }
      }
    }
  }
}

function renderWorld() {
  worldCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  const visibleZ = zLayers
    .filter((l) => l.visible)
    .map((l) => l.z)
    .sort((a, b) => a - b);

  for (const z of visibleZ) {
    for (let ty = 0; ty < WORLD_H; ty++) {
      for (let tx = 0; tx < WORLD_W; tx++) {
        const cell = grid[ty]?.[tx];
        if (!cell) continue;
        const placed = cell[z];
        if (!placed) continue;

        const tex = findTexture(placed.textureId);
        if (!tex) continue;

        const frame = animEnabled
          ? tex.frames[animFrame % tex.frames.length]
          : tex.frames[0];

        // change to _Alt, only when no tile of same z directly above (ty-1)
        const hasAbove = ty > 0 && !!grid[ty - 1]?.[tx]?.[z];
        const useAlt = showAlt && tex.altFrame && !hasAbove;
        const drawImg = useAlt ? tex.altFrame! : frame;

        worldCtx.drawImage(
          drawImg,
          tx * TILE_BASE,
          ty * TILE_BASE,
          placed.tileW * TILE_BASE,
          placed.tileH * TILE_BASE,
        );
      }
    }
  }

  if (
    isDragging &&
    (tool === "rect" || tool === "line") &&
    shapeStartTx >= 0 &&
    shapeCurTx >= 0
  ) {
    drawShapePreview();
  }
}

function drawShapePreview() {
  worldCtx.save();
  worldCtx.globalAlpha = 0.5;
  const color = selectedTexture ? "#4af" : "#fa4";

  if (tool === "rect") {
    const minX = Math.min(shapeStartTx, shapeCurTx);
    const maxX = Math.max(shapeStartTx, shapeCurTx);
    const minY = Math.min(shapeStartTy, shapeCurTy);
    const maxY = Math.max(shapeStartTy, shapeCurTy);
    worldCtx.fillStyle = color;
    worldCtx.fillRect(
      minX * TILE_BASE,
      minY * TILE_BASE,
      (maxX - minX + 1) * TILE_BASE,
      (maxY - minY + 1) * TILE_BASE,
    );
  } else if (tool === "line") {
    const cells = bresenham(shapeStartTx, shapeStartTy, shapeCurTx, shapeCurTy);
    worldCtx.fillStyle = color;
    for (const [x, y] of cells) {
      worldCtx.fillRect(x * TILE_BASE, y * TILE_BASE, TILE_BASE, TILE_BASE);
    }
  }

  worldCtx.restore();
}

function renderGrid() {
  gridCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (!showGrid) return;

  gridCtx.strokeStyle = "rgba(255,255,255,0.07)";
  gridCtx.lineWidth = 0.5;
  gridCtx.beginPath();
  for (let x = 0; x <= WORLD_W; x++) {
    gridCtx.moveTo(x * TILE_BASE, 0);
    gridCtx.lineTo(x * TILE_BASE, CANVAS_H);
  }
  for (let y = 0; y <= WORLD_H; y++) {
    gridCtx.moveTo(0, y * TILE_BASE);
    gridCtx.lineTo(CANVAS_W, y * TILE_BASE);
  }
  gridCtx.stroke();

  gridCtx.strokeStyle = "rgba(100,150,255,0.3)";
  gridCtx.lineWidth = 2;
  gridCtx.strokeRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawCursorPreview(pos: { tx: number; ty: number } | null) {
  clearCursor();
  if (!pos) return;

  const { tx, ty } = pos;

  if (isErasing) {
    cursorCtx.fillStyle = "rgba(255,60,60,0.25)";
    cursorCtx.fillRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
    cursorCtx.strokeStyle = "rgba(255,80,80,0.8)";
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
    return;
  }

  if (tool === "paint" && selectedTexture) {
    const w = selectedTexture.tileW,
      h = selectedTexture.tileH;
    cursorCtx.globalAlpha = 0.6;
    cursorCtx.drawImage(
      selectedTexture.frames[animFrame % selectedTexture.frames.length],
      tx * TILE_BASE,
      ty * TILE_BASE,
      w * TILE_BASE,
      h * TILE_BASE,
    );
    cursorCtx.globalAlpha = 1;
    cursorCtx.strokeStyle = "rgba(80,180,255,0.8)";
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeRect(
      tx * TILE_BASE,
      ty * TILE_BASE,
      w * TILE_BASE,
      h * TILE_BASE,
    );
  } else if (tool === "fill" || tool === "pick") {
    cursorCtx.fillStyle =
      tool === "fill" ? "rgba(80,200,80,0.2)" : "rgba(200,160,40,0.2)";
    cursorCtx.fillRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
    cursorCtx.strokeStyle =
      tool === "fill" ? "rgba(80,220,80,0.7)" : "rgba(220,180,40,0.7)";
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
  } else if ((tool === "rect" || tool === "line") && !isDragging) {
    cursorCtx.fillStyle = "rgba(80,160,255,0.15)";
    cursorCtx.fillRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
    cursorCtx.strokeStyle = "rgba(80,160,255,0.6)";
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeRect(tx * TILE_BASE, ty * TILE_BASE, TILE_BASE, TILE_BASE);
  }
}

function clearCursor() {
  cursorCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
}

function startAnimLoop() {
  let lastTick = 0;
  const INTERVAL = 200;
  function tick(ts: number) {
    if (ts - lastTick > INTERVAL) {
      if (animEnabled) {
        animFrame++;
        renderWorld();
        updateSelectedTileInfo();
      }
      lastTick = ts;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function loadWorldState(state: WorldState) {
  grid = Array.from({ length: WORLD_H }, (_, y) =>
    Array.from({ length: WORLD_W }, (_, x) => state.grid[y]?.[x] ?? null),
  );
  for (const bgs of state.backgrounds ?? []) {
    const bg = backgrounds.find((b) => b.name === bgs.name);
    if (bg) bg.enabled = bgs.enabled;
  }
  undoStack.length = 0;
  redoStack.length = 0;
  updateHistStatus();
  renderAll();
}

function showModal(
  title: string,
  body: string,
  onOk: (() => void) | null,
  replaceContent = false,
  onClose?: () => void,
) {
  const overlay = document.getElementById("modal-overlay")!;
  const titleEl = document.getElementById("modal-title")!;
  const contentEl = document.getElementById("modal-content")!;
  const okBtn = document.getElementById("modal-ok")!;
  const cancelBtn = document.getElementById("modal-cancel")!;

  titleEl.textContent = title;
  if (!replaceContent) contentEl.textContent = body;

  overlay.classList.remove("hidden");

  const close = () => {
    overlay.classList.add("hidden");
    okBtn.removeEventListener("click", doOk);
    cancelBtn.removeEventListener("click", doCancel);
    onClose?.();
  };
  const doOk = () => {
    onOk?.();
    close();
  };
  const doCancel = () => close();

  okBtn.style.display = onOk ? "" : "none";
  cancelBtn.textContent = onOk ? "Cancel" : "Close";
  okBtn.addEventListener("click", doOk);
  cancelBtn.addEventListener("click", doCancel);
}
