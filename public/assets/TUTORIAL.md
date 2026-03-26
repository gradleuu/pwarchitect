## Completely manually adding tile textures
1. Correct folder structure inside public/assets/:
```
  assets/
  ├── _index.json            ← lists all category folder names
  ├── block.metadata         ← metadata sits HERE (next to the folder, NOT inside it)
  ├── block/                 ← the actual tile images go inside the folder
  │   ├── _textures.json
  │   ├── Soil.png
  │   ├── Vortex Portal_0.png
  │   ├── Vortex Portal_1.png
  │   └── Soil_Alt.png
  ├── prop.metadata
  ├── prop/
  │   ├── _textures.json
  │   └── Tree Trunk.png
  └── backgrounds/
      ├── _index.json
      └── Cave Wall.png
```
2. List every category folder name:
  ```
  {
    "folders": ["block", "background", "water", "prop"...]
  }
  ```

3. Ensure: in `assets/<Folder Name>.metadata`  (next to the folder, NOT inside it), must be named exactly like the folder with .metadata extension:
```
name = display name shown in the editor
z    = draw layer depth (0, 1, 2...)
```
4. List every .png file in the `assets/<Folder Name>/_textures.json` (inside the folder, should be done already by GitHub actions automatically)
  ```
  {
    "files": ["Soil.png", "Vortex Portal_0.png", "Vortex Portal_1.png", "Soil_Alt.png"...]
  }
  ```
- Static tile:  Soil.png
- Animated frames: Vortex Portal_0.png, Vortex Portal_0.png, Vortex Portal_0.png (start from _0)
- Alt top texture: Soil_Alt.png  (drawn only on the topmost tile in a column)

## Adding own backgrounds (orbs)
  ```
  backgrounds/
  ├── _index.json        ← lists background group names
  ├── sky_0.png          ← base layer (stretched to fill screen)
  ├── sky_1.png          ← parallax layer 1
  └── sky_2.png          ← parallax layer 2
  ```
  `backgrounds/_index.json`:
  ```
  {
    "groups": ["sky", "forest", "star"...]
  }
  ```
- Layer 0 is stretched to fill the whole canvas (can be 1px wide).
