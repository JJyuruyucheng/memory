import {
  DirectionalLight, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer,
} from './vendor/three-0.180.0/three.module.min.js';
import { makeTabby } from './tabby-model.js';

const ease = value => value * value * (3 - 2 * value);
const blend = (a, b, t) => a + (b - a) * t;

function travel(time) {
  const cycle = time % 6.8;
  if (cycle < 2.2) return { name: 'walk', x: blend(-.27, .42, ease(cycle / 2.2)), yaw: .96, step: .36, beat: 9.6, air: 0 };
  if (cycle < 3.7) return { name: 'run', x: blend(.42, -.44, ease((cycle - 2.2) / 1.5)), yaw: -.92, step: .61, beat: 16, air: .045 };
  if (cycle < 4.55) {
    const hop = (cycle - 3.7) / .85;
    return { name: 'jump', x: blend(-.44, -.27, hop), yaw: .26, step: 0, beat: 0, air: .34 * Math.sin(Math.PI * hop) };
  }
  return { name: 'look', x: -.27, yaw: .38, step: 0, beat: 0, air: 0 };
}

export function mountTabbyScene(canvas, launcher, signal) {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!context) return;
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.setSize(148, 148, false);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1.39, 1.39, 1.39, -1.39, .1, 30);
  const { cat, head, legs, ears, eyes, lids, brows, tail, textures } = makeTabby();
  const light = new DirectionalLight('#fff0db', 2.5);
  light.position.set(-3, 6, 4);
  const rim = new DirectionalLight('#fff5e6', 1.35);
  rim.position.set(2, 4, -3);
  scene.add(cat, light, rim, new HemisphereLight('#f7f0e7', '#8a8282', 2.25));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame, previous = '', lastDraw = 0, since = 0;

  function draw(timestamp) {
    frame = requestAnimationFrame(draw);
    const dock = launcher.dataset.dock;
    const pose = dock ? 'peek' : launcher.classList.contains('is-dragging') ? 'lift' : launcher.dataset.pose;
    if (pose !== previous) { previous = pose; since = timestamp; }
    const still = reduced.matches;
    const resting = pose === 'sleeping', happy = pose === 'happy', annoyed = pose === 'annoyed';
    if (timestamp - lastDraw < (resting || dock ? 82 : 31) && lastDraw) return;
    lastDraw = timestamp;
    const time = still ? .25 : (timestamp - since) / 1000;
    const moving = pose === 'active' && !still ? travel(time) : null;
    const ripple = Math.sin(time * 2.4);
    const bounce = happy && !still ? Math.abs(Math.sin(time * 8)) * .19 : 0;
    const air = moving?.air ?? bounce;
    const x = moving?.x ?? 0, yaw = moving?.yaw ?? (dock ? 0 : resting ? 1.18 : annoyed ? .16 : .69);
    cat.position.x = blend(cat.position.x, x, .25);
    cat.position.y = blend(cat.position.y, air - (resting ? .28 : 0) + (pose === 'lift' ? .13 : 0), .3);
    cat.rotation.y = blend(cat.rotation.y, yaw, .23);
    cat.rotation.z = blend(cat.rotation.z, still ? 0 : (annoyed ? -.06 : moving?.name === 'jump' ? -.09 : 0), .25);
    cat.scale.y = 1 + (resting && !still ? .027 * ripple : 0);
    cat.scale.z = blend(cat.scale.z, resting ? .82 : 1, .22);
    head.position.x = blend(head.position.x, resting ? .12 : 0, .19);
    head.position.y = blend(head.position.y, resting ? .71 : .94, .19);
    head.rotation.y = blend(head.rotation.y, resting ? -.63 : dock ? -.13 : moving?.name === 'run' ? .17 : -.22, .21);
    head.rotation.x = blend(head.rotation.x, resting ? .44 : pose === 'thinking' ? -.20 : annoyed ? .17 : 0, .21);
    head.rotation.z = still ? 0 : happy ? .10 * ripple : pose === 'thinking' ? -.17 : dock ? .055 * ripple : 0;
    tail.rotation.x = blend(tail.rotation.x, resting ? -.29 : happy ? .48 : .12, .18);
    tail.rotation.y = blend(tail.rotation.y, resting ? -1.55 : still ? 0 : (annoyed ? .65 * Math.sin(time * 15) : .26 * ripple), .22);

    const blinking = !still && time % 3.36 > 3.19;
    eyes.forEach((eye, index) => {
      const side = index * 2 - 1;
      ears[index].rotation.z = -side * (annoyed ? .8 : resting ? .35 : .16);
      ears[index].rotation.x = annoyed ? -.59 : happy ? .04 * ripple : 0;
      eye.visible = !resting && !blinking;
      eye.scale.y = annoyed ? .46 : happy ? .68 : 1;
      eye.rotation.z = annoyed ? side * .25 : 0;
      lids[index].visible = !eye.visible;
      brows[index].visible = annoyed;
      brows[index].rotation.z = side * .43;
    });
    for (const { upper, lower, front, side } of legs) {
      const phase = time * (moving?.beat || 0) + (side > 0 ? Math.PI : 0) + (front ? 0 : Math.PI / 2);
      const swing = Math.sin(phase) * (moving?.step || 0);
      const pickedUp = pose === 'lift' || moving?.name === 'jump' || happy;
      const bend = resting ? (front ? .82 : -.83) : pickedUp ? (front ? .44 : -.24) : swing;
      upper.rotation.x = blend(upper.rotation.x, bend, .39);
      lower.rotation.x = blend(lower.rotation.x, resting ? (front ? .85 : -.82) : pickedUp ? .63 : Math.max(0, -swing) * .89, .39);
      upper.rotation.z = resting ? side * .15 : 0;
    }

    camera.zoom = dock ? 2.15 : 1;
    camera.position.set(dock ? .04 : .35, dock ? 1.41 : 2.34, 5.4);
    camera.lookAt(0, dock ? .99 : .79, dock ? .55 : 0);
    camera.updateProjectionMatrix();
    launcher.dataset.motion = dock ? 'peek' : moving?.name || pose;
    renderer.render(scene, camera);
  }

  launcher.dataset.figure = '3d';
  frame = requestAnimationFrame(draw);
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    cat.traverse(part => { part.geometry?.dispose(); part.material?.dispose(); });
    textures.forEach(texture => texture.dispose());
    renderer.dispose();
  }, { once: true });
}
