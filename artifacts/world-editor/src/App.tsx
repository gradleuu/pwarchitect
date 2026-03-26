import { useEffect, useRef } from "react";
import "./editor.css";

const base = import.meta.env.BASE_URL;

export default function App() {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    import("./editor/main").then((m) => m.initEditor());
  }, []);

  return (
    <div id="editor-root">
      <div id="menubar">
        <div id="menubar-left">
          <span
            id="app-title"
            style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
          >
            <img src={`${base}pwlogo.png`} height={20} alt="logo" />
            World Editor
          </span>

          <button id="btn-new-world">New</button>

          <button
            id="btn-load-world"
            style={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            <img src={`${base}buttonIcon_import.png`} height={15} />
            <span>Import World</span>
          </button>

          <button
            id="btn-export-world"
            style={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            <img src={`${base}buttonIcon_download.png`} height={15} />
            <span>Export World</span>
          </button>
        </div>

        <div id="menubar-right">
          <button
            id="btn-toggle-grid"
            className="active"
            style={{ display: "flex", alignItems: "center", gap: "5px" }}
          >
            <img src={`${base}buttonIcon_eye.png`} height={15} />
            <span>Show Grid</span>
          </button>

          <button id="btn-toggle-anim">Animations</button>
          <button id="btn-toggle-alt">Alt Textures</button>

          <label id="bg-label">
            <button id="btn-bg-manage">Change Orb</button>
          </label>
        </div>
      </div>

      <div id="main-area">
        <div id="sidebar">
          <div id="category-list-header">Available Categories</div>
          <div id="category-list"></div>

          <div id="tile-search-wrap">
            <input id="tile-search" type="search" placeholder="Search…" />
          </div>

          <div id="tile-palette-header">Tiles</div>
          <div id="tile-palette"></div>
        </div>

        <div id="canvas-area">
          <div id="viewport-container">
            <canvas id="bg-canvas"></canvas>
            <canvas id="world-canvas"></canvas>
            <canvas id="grid-canvas"></canvas>
            <canvas id="cursor-canvas"></canvas>
          </div>
        </div>

        <div id="right-panel">
          <div id="layer-header">Layers</div>
          <div id="layer-list"></div>

          <div id="tool-header">Tools</div>
          <div id="tool-list">
            <button
              className="tool-btn active"
              data-tool="paint"
              title="Paint (B)"
              style={{ display: "flex", alignItems: "center", gap: "5px" }}
            >
              <img src={`${base}weapon_paintBrush_green.png`} width={15} />
              <span>Paint</span>
            </button>

            <button
              className="tool-btn"
              data-tool="fill"
              title="Fill (F)"
              style={{ display: "flex", alignItems: "center", gap: "5px" }}
            >
              <img src={`${base}RedBucket.png`} width={15} />
              <span>Fill</span>
            </button>

            <button className="tool-btn" data-tool="rect" title="Rectangle (R)">
              ▭ Rect
            </button>

            <button className="tool-btn" data-tool="line" title="Line (L)">
              ╱ Line
            </button>

            <button
              className="tool-btn"
              data-tool="pick"
              title="Pick (P)"
              style={{ display: "flex", alignItems: "center", gap: "5px" }}
            >
              <img src={`${base}SoilBlueprint.png`} width={15} />
              <span>Pick</span>
            </button>
          </div>

          <div id="tool-hint">
            Right-click = erase
            <br />
            Middle = pan
          </div>

          <div id="selected-tile-info">
            <div id="sel-tile-preview"></div>
            <div id="sel-tile-name">No tile selected</div>
          </div>
        </div>
      </div>

      <div id="statusbar">
        <span id="status-cursor">Cursor: —</span>
        <span id="status-tile">Tile: none</span>
        <span id="status-zoom">Zoom: 100%</span>
        <span id="status-hist"></span>
      </div>

      <div id="modal-overlay" className="hidden">
        <div id="modal-box">
          <div id="modal-title"></div>
          <div id="modal-content"></div>
          <div id="modal-buttons">
            <button id="modal-cancel">Cancel</button>
            <button id="modal-ok">OK</button>
          </div>
        </div>
      </div>

      <input
        type="file"
        id="file-input"
        accept=".json"
        style={{ display: "none" }}
      />
    </div>
  );
}
