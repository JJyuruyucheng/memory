import {
  BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, SRGBColorSpace, TextureLoader,
} from './vendor/three-0.180.0/three.module.min.js';

const grid = 57;
const count = grid * grid;
const poses = { ready: 'welcome', thinking: 'thinking', sleeping: 'idle', annoyed: 'retry', peek: 'launcher' };

function fromPortrait(texture, centered) {
  const { image } = texture;
  const mask = document.createElement('canvas');
  mask.width = mask.height = grid;
  const context = mask.getContext('2d');
  context.drawImage(image, 0, 0, grid, grid);
  const { data } = context.getImageData(0, 0, grid, grid);
  const distances = new Float32Array(count);
  let left = grid, right = 0, top = grid, bottom = 0;
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const i = row * grid + col;
      if (data[i * 4 + 3] < 24) continue;
      left = Math.min(left, col); right = Math.max(right, col);
      top = Math.min(top, row); bottom = Math.max(bottom, row);
      if (row && col && row < grid - 1 && col < grid - 1) distances[i] = grid;
    }
  }
  // Distance to the silhouette tapers the two textured surfaces to a joined edge.
  for (let i = 0; i < count; i++) {
    if (i % grid) distances[i] = Math.min(distances[i], distances[i - 1] + 1);
    if (i >= grid) distances[i] = Math.min(distances[i], distances[i - grid] + 1);
  }
  for (let i = count - 1; i >= 0; i--) {
    if (i % grid < grid - 1) distances[i] = Math.min(distances[i], distances[i + 1] + 1);
    if (i < count - grid) distances[i] = Math.min(distances[i], distances[i + grid] + 1);
  }
  const depth = Math.max(1, ...distances);
  const extent = Math.max((right - left) * image.width, (bottom - top) * image.height, 1);
  const scale = (centered ? 1.76 : 2.16) / extent;
  const centerX = (left + right) / 2, ground = centered ? (top + bottom) / 2 : bottom;
  const positions = [], uvs = [], triangles = [];
  for (const side of [1, -1]) {
    const offset = positions.length / 3;
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        const i = row * grid + col, v = i + offset;
        const rounded = Math.sqrt(distances[i] / depth);
        positions.push((col - centerX) * image.width * scale,
          (ground - row) * image.height * scale - (centered ? 0 : 1.05),
          rounded * (side > 0 ? .48 : -.31));
        uvs.push(col / (grid - 1), 1 - row / (grid - 1));
        if (row === grid - 1 || col === grid - 1) continue;
        if (side > 0) triangles.push(v, v + grid, v + 1, v + 1, v + grid, v + grid + 1);
        else triangles.push(v, v + 1, v + grid, v + 1, v + grid + 1, v + grid);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(triangles);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, alphaTest: .035, transparent: true });
  const mesh = new Mesh(geometry, material);
  const rest = new Float32Array(positions);
  let stepping = false;
  return {
    mesh,
    stride(phase, strength) {
      if (!strength && !stepping) return;
      const attribute = geometry.getAttribute('position'), vertices = attribute.array;
      for (let i = 0; i < vertices.length; i += 3) {
        const weight = Math.min(1, Math.max(0, -.48 - rest[i + 1]) * 1.9) * strength;
        const step = phase + (rest[i] < 0 ? 0 : Math.PI);
        vertices[i] = rest[i] + Math.cos(step) * .055 * weight;
        vertices[i + 1] = rest[i + 1] + Math.sin(step) * .14 * weight;
      }
      stepping = Boolean(strength);
      attribute.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); texture.dispose(); },
  };
}

export async function portraitsFromOriginals() {
  const loader = new TextureLoader();
  return Object.fromEntries(await Promise.all(Object.entries(poses).map(async ([pose, art]) => {
    const url = new URL(`../assets/assistant/tabby-${art}.png`, import.meta.url);
    const texture = await loader.loadAsync(url.href);
    return [pose, fromPortrait(texture, pose === 'peek' || pose === 'annoyed')];
  })));
}
