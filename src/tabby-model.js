import {
  CatmullRomCurve3, DataTexture, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial,
  Shape, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from './vendor/three-0.180.0/three.module.min.js';

const material = (color, map) => new MeshStandardMaterial({ color, map: map ?? null, roughness: .85 });
const point = values => new Vector3(...values);

function coat(pattern) {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let v = 0; v < size; v++) {
    const theta = Math.PI * (1 - v / (size - 1));
    for (let u = 0; u < size; u++) {
      const angle = 2 * Math.PI * u / (size - 1);
      const x = -Math.cos(angle) * Math.sin(theta), y = Math.cos(theta), z = Math.sin(angle) * Math.sin(theta);
      const band = Math.max(0, Math.min(1, (Math.sin(pattern(x, y, z, u / size)) + .14) * 1.13));
      const chin = Math.max(0, -.37 - y);
      const hair = 4 * Math.sin(u * 3.1 + v * 1.9) + 3 * Math.sin(v * 2.7 + u * .73);
      const gray = 142 - band * 70 + chin * 52 + hair;
      pixels.set([gray + 8, gray + 2, gray - 7, 255], (v * size + u) * 4);
    }
  }
  const texture = new DataTexture(pixels, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function makeTabby() {
  const bodyCoat = coat((x, y, z) => 20 * z + 2.2 * Math.sin(4 * y + 2 * x) + 1.1 * x);
  const headCoat = coat((x, y, z) => y > -.03 && z > .12
    ? 20 * Math.abs(x) + 5 * y + Math.sin(7 * y - 2 * Math.abs(x))
    : 19 * y + 2.6 * z - 3 * Math.abs(x));
  const legCoat = coat((x, y, z) => 11.8 * y + 2.8 * x + 1.9 * z);
  const tailCoat = coat((x, y, z, u) => 48 * u + .6 * Math.sin(4 * y));
  const fur = material('#ffffff', bodyCoat), face = material('#ffffff', headCoat);
  const limbs = material('#ffffff', legCoat), tailFur = material('#ffffff', tailCoat);
  const cream = material('#c3b09b'), gray = material('#7b6d60'), earPink = material('#a8857d');
  const dark = material('#352c28'), noseTint = material('#805c53'), gold = material('#b9974b');
  const glint = material('#fbf6dc'), whisker = material('#b9aa9c');
  const sphere = new SphereGeometry(1, 28, 20);
  const cat = new Group();
  const oval = (parent, mat, at, dimensions) => {
    const mesh = new Mesh(sphere, mat);
    mesh.position.set(...at);
    mesh.scale.set(...dimensions);
    parent.add(mesh);
    return mesh;
  };
  const curve = (parent, mat, marks, radius) => {
    const mesh = new Mesh(new TubeGeometry(new CatmullRomCurve3(marks.map(point)), 20, radius, 6, false), mat);
    parent.add(mesh);
    return mesh;
  };
  const joint = (parent, at) => {
    const group = new Group();
    group.position.set(...at);
    parent.add(group);
    return group;
  };
  const shape = (parent, mat, path, bevel) => {
    const mesh = new Mesh(new ExtrudeGeometry(path, { depth: .022, bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 9, steps: 1 }), mat);
    parent.add(mesh);
    return mesh;
  };

  oval(cat, fur, [0, .64, -.18], [.38, .36, .69]);
  oval(cat, fur, [0, .63, .29], [.32, .34, .39]);
  oval(cat, cream, [0, .53, .49], [.225, .225, .14]);
  const head = joint(cat, [0, .94, .52]);
  oval(head, face, [0, 0, 0], [.40, .35, .36]);

  const ears = [], eyes = [], lids = [], brows = [];
  for (const side of [-1, 1]) {
    const ear = joint(head, [side * .235, .19, -.07]);
    const outline = new Shape().moveTo(-.124, 0).quadraticCurveTo(-.105, .18, -.022, .327)
      .quadraticCurveTo(.005, .372, .044, .327).quadraticCurveTo(.122, .19, .132, 0).closePath();
    shape(ear, gray, outline, .048);
    const inside = shape(ear, earPink, outline, .024);
    inside.scale.set(.61, .68, 1);
    inside.position.set(0, .055, .04);
    ears.push(ear);

    const eye = joint(head, [side * .175, .026, .312]);
    eye.rotation.y = side * .29;
    oval(eye, dark, [0, 0, 0], [.088, .073, .033]);
    oval(eye, gold, [0, .002, .029], [.072, .058, .017]);
    oval(eye, dark, [0, .005, .045], [.024, .050, .009]);
    oval(eye, glint, [-.019, .026, .052], [.013, .011, .005]);
    eyes.push(eye);
    const lid = curve(head, dark, [[side * .093, .019, .344], [side * .164, .043, .354], [side * .237, .023, .318]], .010);
    lids.push(lid);
    const brow = joint(head, [side * .17, .105, .334]);
    curve(brow, dark, [[-.068, 0, 0], [0, .014, -.005], [.068, .006, -.008]], .014);
    brows.push(brow);

    oval(head, cream, [side * .092, -.112, .310], [.118, .076, .085]);
    for (let i = 0; i < 3; i++) {
      const height = -.105 - i * .023;
      curve(head, whisker, [[side * .117, height, .378], [side * .313, height + .016, .322],
        [side * (.474 - i * .027), height + .067 - i * .038, .27]], .0038);
    }
  }
  oval(head, cream, [0, -.191, .246], [.123, .053, .067]);
  const nose = new Shape().moveTo(-.058, .025).quadraticCurveTo(0, .042, .058, .025)
    .quadraticCurveTo(.018, -.024, 0, -.028).quadraticCurveTo(-.028, -.015, -.058, .025).closePath();
  shape(head, noseTint, nose, .012).position.set(0, -.080, .378);
  curve(head, dark, [[0, -.102, .40], [0, -.145, .399], [.042, -.167, .377], [.087, -.152, .366]], .007);
  curve(head, dark, [[0, -.145, .399], [-.042, -.167, .377], [-.087, -.152, .366]], .007);

  const legs = [];
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const upper = joint(cat, [side * .219, .560, front ? .3 : -.54]);
      oval(upper, limbs, [0, -.14, 0], [front ? .096 : .135, .195, front ? .105 : .15]);
      const lower = joint(upper, [0, -.258, 0]);
      oval(lower, limbs, [0, -.119, 0], [.074, .143, .08]);
      oval(lower, gray, [0, -.247, .033], [.091, .056, .128]);
      legs.push({ upper, lower, front, side });
    }
  }
  const tail = joint(cat, [0, .61, -.72]);
  curve(tail, tailFur, [[0, 0, 0], [.09, .03, -.25], [.25, .16, -.45], [.40, .37, -.47], [.45, .53, -.31]], .075);
  oval(tail, dark, [.45, .53, -.31], [.076, .080, .077]);
  return { cat, head, ears, eyes, lids, brows, legs, tail, textures: [bodyCoat, headCoat, legCoat, tailCoat] };
}
