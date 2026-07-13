/* Paraquedas local visível em primeira pessoa: velame segmentado, linhas e
   arnês. O BR só alterna window.__BR_chuteOpen; este módulo cuida do visual. */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export function createParachute({ scene, player }) {
  const root = new THREE.Group();
  root.name = 'paraquedasLocal';
  root.visible = false;
  scene.add(root);

  const canopy = new THREE.Group();
  canopy.name = 'velameParaquedas';
  root.add(canopy);
  const lightPanels = [], redPanels = [];
  const panels = 12;
  for (let i = 0; i < panels; i++) {
    const g = new THREE.SphereGeometry(2.85, 5, 5, i / panels * Math.PI * 2, Math.PI * 2 / panels, 0, Math.PI / 2);
    g.scale(1.28, 0.72, 1.02);
    g.translate(0, 4.75, 0);
    (i % 3 === 0 || i % 3 === 1 ? redPanels : lightPanels).push(g);
  }
  const redMat = new THREE.MeshStandardMaterial({ color: 0xb6292f, roughness: 0.82, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xe7e1ce, roughness: 0.88, side: THREE.DoubleSide });
  const red = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(redPanels), redMat);
  const light = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lightPanels), lightMat);
  red.name = 'paineisVermelhos'; light.name = 'paineisClaros';
  red.castShadow = light.castShadow = false;
  canopy.add(red, light);

  const linePoints = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const sx = Math.cos(a) * 3.58, sz = Math.sin(a) * 2.86;
    const hx = Math.cos(a) * 0.26, hz = Math.sin(a) * 0.18;
    linePoints.push(new THREE.Vector3(hx, 1.3, hz), new THREE.Vector3(sx, 4.75, sz));
  }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x24211d, transparent: true, opacity: 0.92 }));
  lines.name = 'linhasParaquedas';
  root.add(lines);

  const harnessPts = [
    new THREE.Vector3(-0.26, 1.3, 0), new THREE.Vector3(-0.18, 0.75, 0.08),
    new THREE.Vector3(0.26, 1.3, 0), new THREE.Vector3(0.18, 0.75, 0.08),
    new THREE.Vector3(-0.18, 0.76, 0.08), new THREE.Vector3(0.18, 0.76, 0.08),
  ];
  const harness = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(harnessPts),
    new THREE.LineBasicMaterial({ color: 0x17191c }));
  harness.name = 'arnesParaquedas';
  root.add(harness);

  let openK = 0;
  function update(dt, t) {
    const wanted = !!window.__BR_chuteOpen;
    const target = wanted ? 1 : 0;
    openK += (target - openK) * (1 - Math.exp(-dt * (wanted ? 7.5 : 11)));
    root.visible = openK > 0.015;
    if (!root.visible) return;
    root.position.copy(player.pos);
    canopy.scale.set(Math.max(0.08, openK), 0.7 + openK * 0.3, Math.max(0.08, openK));
    lines.scale.set(Math.max(0.12, openK), 1, Math.max(0.12, openK));
    const sway = Math.sin(t * 1.7) * 0.035 * openK;
    root.rotation.set(Math.cos(t * 1.3) * 0.018 * openK, Math.sin(t * 0.23) * 0.04, sway);
  }

  return { root, canopy, lines, harness, lineCount: 8, update, get openK() { return openK; } };
}
