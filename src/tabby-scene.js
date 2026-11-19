import { Group, OrthographicCamera, Scene, WebGLRenderer } from './vendor/three-0.180.0/three.module.min.js';
import { portraitsFromOriginals } from './tabby-model.js';

const blend = (a, b, t) => a + (b - a) * t;
const ease = n => n * n * (3 - 2 * n);

function travel(time) {
  const cycle = time % 6.8;
  if (cycle < 2.2) return { name: 'walk', x: blend(-.24, .35, ease(cycle / 2.2)), yaw: .25, stride: .65, beat: 10, air: .008 };
  if (cycle < 3.7) return { name: 'run', x: blend(.35, -.38, ease((cycle - 2.2) / 1.5)), yaw: -.29, stride: 1, beat: 17, air: .035 };
  if (cycle < 4.55) {
    const hop = (cycle - 3.7) / .85;
    return { name: 'jump', x: blend(-.38, -.24, hop), yaw: .08, stride: 0, beat: 0, air: .29 * Math.sin(Math.PI * hop) };
  }
  return { name: 'look', x: -.24, yaw: .05, stride: 0, beat: 0, air: 0 };
}

export async function mountTabbyScene(canvas, launcher, signal) {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!context) return;
  const portraits = await portraitsFromOriginals();
  const dispose = () => Object.values(portraits).forEach(portrait => portrait.dispose());
  if (signal.aborted) { dispose(); return; }
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.setSize(148, 148, false);
  const scene = new Scene(), cat = new Group();
  const camera = new OrthographicCamera(-1.4, 1.4, 1.4, -1.4, .1, 30);
  camera.position.z = 5;
  for (const portrait of Object.values(portraits)) {
    portrait.mesh.visible = false; cat.add(portrait.mesh);
  }
  scene.add(cat);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame, lastPose = '', lastDraw = 0, since = 0, visible = portraits.ready;

  function draw(timestamp) {
    frame = requestAnimationFrame(draw);
    const dock = launcher.dataset.dock;
    const pose = dock ? 'peek' : launcher.classList.contains('is-dragging') ? 'lift' : launcher.dataset.pose;
    if (pose !== lastPose) { since = timestamp; lastPose = pose; }
    const sleeping = pose === 'sleeping', happy = pose === 'happy', annoyed = pose === 'annoyed';
    if (lastDraw && timestamp - lastDraw < (sleeping || dock ? 80 : 30)) return;
    lastDraw = timestamp;
    const still = reduced.matches, time = still ? 0 : (timestamp - since) / 1000;
    const moving = pose === 'active' && !still ? travel(time) : null;
    const next = portraits[pose] ?? portraits.ready;
    visible.mesh.visible = false; visible = next; visible.mesh.visible = true;
    const ripple = Math.sin(time * 2.35);
    const bounce = happy ? Math.abs(Math.sin(time * 8)) * .16 : 0;
    const air = moving ? moving.air + Math.abs(Math.sin(time * moving.beat)) * (moving.stride * .045) : bounce;
    cat.position.x = blend(cat.position.x, dock ? 0 : moving?.x || 0, .26);
    cat.position.y = blend(cat.position.y, pose === 'lift' ? .11 : air, .34);
    cat.rotation.y = blend(cat.rotation.y, moving?.yaw ?? (dock ? ripple * .16 : annoyed ? Math.sin(time * 12) * .10 : ripple * .035), .22);
    cat.rotation.z = blend(cat.rotation.z, annoyed ? Math.sin(time * 12) * .092 : moving?.name === 'jump' ? -.085 : ripple * (happy ? .062 : .017), .29);
    cat.scale.y = 1 + ripple * (sleeping ? .033 : .011);
    visible.stride(moving ? time * moving.beat : 0, moving?.stride || 0);
    camera.zoom = dock ? 1.83 : 1;
    camera.updateProjectionMatrix();
    launcher.dataset.motion = moving?.name || pose;
    renderer.render(scene, camera);
  }
  launcher.dataset.figure = '3d';
  frame = requestAnimationFrame(draw);
  signal.addEventListener('abort', () => { cancelAnimationFrame(frame); dispose(); renderer.dispose(); }, { once: true });
}
