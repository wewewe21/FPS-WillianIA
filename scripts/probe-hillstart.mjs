#!/usr/bin/env node
/* Probe determinístico de hill-start: rampas sintéticas (Heightfield) ×
   inclinação × resolução da célula (5 m vs 2,5 m) × tração (RWD vs 4x4
   de arranque). Replica os parâmetros REAIS de js/car.js:40-98 — se
   mudar lá, mude aqui. Saída: JSON no stdout. */
/* global console */ // eslint.config.js só dá globals de node a scripts/**/*.js
import * as CANNON from 'cannon-es';

const SUSP_REST = 0.55;                       // js/car.js:15
const suspStatic = k => SUSP_REST - 9.82 / (4 * k);
const VEHS = {
  buggy: { mass: 280, half: [1.8, 0.38, 0.85], comDrop: 0.65, suspStiff: 24, force: 1650, grip: 1.9,
    wheels: [[1.147, -0.993, 0.612], [1.147, -0.993, -0.612], [-0.814, -0.993, 0.612], [-0.814, -0.993, -0.612]],
    wheelR: [0.207, 0.207, 0.207, 0.207] },
  truck: { mass: 680, half: [2.7, 0.55, 1.05], comDrop: 0.3, suspStiff: 20, force: 3600, grip: 2.0,
    wheels: [[1.673, -0.387, 0.916], [1.673, -0.387, -0.916], [-0.812, -0.343, 0.916], [-0.812, -0.343, -0.916]],
    wheelR: [0.437, 0.437, 0.481, 0.481] },
};

function rampWorld(deg, cell) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  const t = Math.tan(deg * Math.PI / 180), n = Math.round(160 / cell) + 1;
  const data = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i * cell * t);
    data.push(row);
  }
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(new CANNON.Heightfield(data, { elementSize: cell }));
  body.position.set(-80, 0, 80);
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(body);
  return { world, hAt: x => (x + 80) * t };
}

function makeVehicle(world, cfg, hAt) {
  let spawnY = -Infinity;                      // nasce apoiado (js/car.js:44-50)
  for (let i = 0; i < 4; i++)
    spawnY = Math.max(spawnY, hAt(cfg.wheels[i][0]) + cfg.wheelR[i] - cfg.wheels[i][1] + 0.03);
  const chassis = new CANNON.Body({ mass: cfg.mass, position: new CANNON.Vec3(0, spawnY - cfg.comDrop, 0) });
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(...cfg.half)), new CANNON.Vec3(0, cfg.comDrop, 0));
  chassis.angularDamping = 0.42; chassis.linearDamping = 0.02;
  chassis.allowSleep = false;                  // probe controla o arranque
  const veh = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
  for (let i = 0; i < 4; i++) {
    const [wx, wy, wz] = cfg.wheels[i];
    veh.addWheel({
      radius: cfg.wheelR[i], directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: cfg.suspStiff, suspensionRestLength: SUSP_REST,
      frictionSlip: cfg.grip, dampingRelaxation: 3.5, dampingCompression: 4.4,
      maxSuspensionForce: 100000, rollInfluence: 0.01, axleLocal: new CANNON.Vec3(0, 0, 1),
      chassisConnectionPointLocal: new CANNON.Vec3(wx, wy + cfg.comDrop + suspStatic(cfg.suspStiff), wz),
      maxSuspensionTravel: 0.3, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    });
  }
  veh.addToWorld(world);
  return { chassis, veh };
}

function run(vName, deg, cell, mode) {
  const { world, hAt } = rampWorld(deg, cell);
  const { chassis, veh } = makeVehicle(world, VEHS[vName], hAt);
  for (let s = 0; s < 120; s++) {              // 2 s assentando com freio de mão
    for (let i = 0; i < 4; i++) { veh.setBrake(12, i); veh.applyEngineForce(0, i); }
    world.step(1 / 60);
  }
  const x0 = chassis.position.x;
  const force = VEHS[vName].force;
  for (let s = 0; s < 360; s++) {              // 6 s de acelerador
    for (let i = 0; i < 4; i++) veh.setBrake(0, i);
    const kmh = chassis.velocity.length() * 3.6;
    let awdK = 0;
    if (mode === 'hill4x4' && kmh < 15) awdK = Math.min(1, (15 - kmh) / 5);
    const perFront = force * 0.5 * awdK, perRear = force * (1 - 0.5 * awdK);
    veh.applyEngineForce(perFront, 0); veh.applyEngineForce(perFront, 1);
    veh.applyEngineForce(perRear, 2); veh.applyEngineForce(perRear, 3);
    world.step(1 / 60);
  }
  return +(chassis.position.x - x0).toFixed(2);
}

const out = {};
for (const v of ['buggy', 'truck'])
  for (const deg of [0, 12, 14, 16, 18, 20])
    for (const cell of [5, 2.5])
      for (const mode of v === 'truck' ? ['rwd', 'hill4x4'] : ['rwd'])
        (out[`${v}_${deg}deg_${cell}m_${mode}`] = run(v, deg, cell, mode));
console.log(JSON.stringify(out, null, 2));
