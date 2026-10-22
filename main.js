import * as THREE from 'three';

const names = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vivaan', 'Isha', 'Arjun', 'Meera', 'Kabir', 'Saanvi', 'Dev', 'Lakshmi', 'Hari', 'Radha', 'Maya', 'Leo'];
const anonName = names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 99);
document.getElementById('name').textContent = `You are ${anonName}`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 140);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 7, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
sun.position.set(40, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 180;
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x4a9c3a, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Water pond
const water = new THREE.Mesh(
  new THREE.CircleGeometry(9, 32),
  new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 })
);
water.rotation.x = -Math.PI / 2;
water.position.set(18, 0.05, -8);
scene.add(water);

// Paths
function addPath(x, z, w, l) {
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshStandardMaterial({ color: 0xc4a484, roughness: 1 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(x, 0.02, z);
  path.receiveShadow = true;
  scene.add(path);
}
addPath(0, 8, 5, 30);
addPath(0, -18, 4, 16);
addPath(-25, 0, 20, 4);
addPath(15, -5, 4, 18);

// Central gathering circle + singing ring
const mandapa = new THREE.Mesh(
  new THREE.CylinderGeometry(7, 7.5, 0.3, 40),
  new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.65 })
);
mandapa.position.set(0, 0.15, 0);
mandapa.receiveShadow = true;
scene.add(mandapa);

const singingRing = new THREE.Mesh(
  new THREE.TorusGeometry(8.5, 0.12, 8, 40),
  new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x553300, emissiveIntensity: 0.4 })
);
singingRing.rotation.x = Math.PI / 2;
singingRing.position.y = 0.2;
singingRing.visible = false;
scene.add(singingRing);

// Huts
function addHut(x, z) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 2.4, 4),
    new THREE.MeshStandardMaterial({ color: 0xe8d5b7, roughness: 0.8 })
  );
  base.position.set(x, 1.2, z);
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 2, 4),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 })
  );
  roof.position.set(x, 3.1, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);
}
addHut(-15, 10);
addHut(16, 8);
addHut(-10, -22);
addHut(22, -15);

// Dense trees + plants
function addTree(x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.28 * scale, 2.8 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c4033 })
  );
  trunk.position.set(x, 1.4 * scale, z);
  trunk.castShadow = true;
  scene.add(trunk);
  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(1.7 * scale, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 })
  );
  foliage.position.set(x, 3.4 * scale, z);
  foliage.castShadow = true;
  scene.add(foliage);
}
function addBush(x, z) {
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.9 })
  );
  bush.position.set(x, 0.4, z);
  bush.castShadow = true;
  scene.add(bush);
}
for (let i = 0; i < 40; i++) {
  const angle = Math.random() * Math.PI * 2;
  const r = 22 + Math.random() * 28;
  addTree(Math.cos(angle) * r, Math.sin(angle) * r, 0.7 + Math.random() * 0.7);
}
for (let i = 0; i < 30; i++) {
  addBush((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
}

// Farm plots
const crops = [];
function addCropPlot(x, z) {
  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.12, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x5d4037 })
  );
  soil.position.set(x, 0.06, z);
  soil.receiveShadow = true;
  scene.add(soil);
  const crop = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x66bb6a })
  );
  crop.position.set(x, 0.75, z);
  crop.castShadow = true;
  crop.userData = { type: 'crop', harvested: false, originalY: 0.75 };
  scene.add(crop);
  crops.push(crop);
}
[[-28,-6],[-24,-6],[-20,-6],[-28,-10],[-24,-10],[-20,-10],[-28,-14],[-24,-14]].forEach(([x,z]) => addCropPlot(x,z));

// Animals (simple roaming)
const animals = [];
function addAnimal(x, z, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.35, 0.4),
    new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, 0, 0.1) })
  );
  head.position.set(0, 0.55, 0.6);
  group.add(head);
  group.position.set(x, 0, z);
  group.userData = {
    target: new THREE.Vector3(x + (Math.random()-0.5)*12, 0, z + (Math.random()-0.5)*12),
    speed: 0.015 + Math.random()*0.02
  };
  scene.add(group);
  animals.push(group);
}
addAnimal(10, 15, new THREE.Color(0x8d6e63));
addAnimal(-8, 18, new THREE.Color(0xa1887f));
addAnimal(25, 5, new THREE.Color(0x6d4c41));
addAnimal(-20, 12, new THREE.Color(0xbcaaa4));

// NPCs
const npcs = [];
const npcDialogues = [
  "Hey, welcome. Come join the singing later.",
  "Crops look good today. Want to help harvest?",
  "We gather at the circle in the evening.",
  "Press Sing and people usually come over.",
  "Simple life. Grow, eat, share, rest.",
  "Dance whenever you feel like it.",
  "Grab some greens if you're hungry."
];
function createNPC(x, z, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.05, 4, 8), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffdbac }));
  head.position.y = 1.95;
  group.add(head);
  group.position.set(x, 0, z);
  group.userData = {
    type: 'npc',
    name: names[Math.floor(Math.random()*names.length)],
    dialogue: npcDialogues[Math.floor(Math.random()*npcDialogues.length)],
    target: new THREE.Vector3(x+(Math.random()-0.5)*12, 0, z+(Math.random()-0.5)*12),
    speed: 0.018 + Math.random()*0.015,
    singing: false
  };
  scene.add(group);
  npcs.push(group);
}
createNPC(5,4,0xe74c3c); createNPC(-6,7,0x3498db); createNPC(9,-6,0xf39c12);
createNPC(-4,-9,0x9b59b6); createNPC(3,14,0x1abc9c); createNPC(-12,2,0xe67e22);

// Player
const player = new THREE.Group();
const pBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.15, 4, 8), new THREE.MeshStandardMaterial({ color: 0x6c5ce7 }));
pBody.position.y = 1.15;
pBody.castShadow = true;
player.add(pBody);
const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffdbac }));
pHead.position.y = 2.1;
player.add(pHead);
player.position.set(0, 0, 12);
scene.add(player);

// Controls: keyboard + touch joystick
const keys = {};
let joyX = 0, joyY = 0;
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

const joystick = document.getElementById('joystick');
const knob = document.getElementById('joystick-knob');
let joyActive = false;
joystick.addEventListener('pointerdown', e => { joyActive = true; updateJoy(e); });
window.addEventListener('pointermove', e => { if (joyActive) updateJoy(e); });
window.addEventListener('pointerup', () => {
  joyActive = false;
  joyX = 0; joyY = 0;
  knob.style.transform = 'translate(0,0)';
});
function updateJoy(e) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const max = 40;
  const dist = Math.min(Math.hypot(dx, dy), max);
  const ang = Math.atan2(dy, dx);
  dx = Math.cos(ang) * dist;
  dy = Math.sin(ang) * dist;
  joyX = dx / max;
  joyY = -dy / max; // invert Y so up is forward
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const infoEl = document.getElementById('info');
function showMessage(msg, duration = 3200) {
  const old = infoEl.querySelector('.msg');
  if (old) old.remove();
  const el = document.createElement('p');
  el.className = 'msg';
  el.style.marginTop = '8px';
  el.style.fontSize = '13px';
  el.textContent = msg;
  infoEl.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

window.addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('#joystick')) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects([...crops, ...npcs], true);
  if (!hits.length) return;
  let obj = hits[0].object;
  while (obj.parent && !obj.userData.type) obj = obj.parent;
  if (obj.userData.type === 'crop' && !obj.userData.harvested) {
    obj.userData.harvested = true;
    obj.scale.y = 0.15;
    obj.position.y = 0.15;
    showMessage('Harvested greens. Community shares the food.');
    setTimeout(() => { obj.userData.harvested = false; obj.scale.y = 1; obj.position.y = obj.userData.originalY; }, 10000);
  }
  if (obj.userData.type === 'npc') showMessage(`${obj.userData.name}: "${obj.userData.dialogue}"`);
});

function updatePlayer() {
  const speed = 0.22;
  const dir = new THREE.Vector3();
  if (keys['w'] || keys['arrowup']) dir.z -= 1;
  if (keys['s'] || keys['arrowdown']) dir.z += 1;
  if (keys['a'] || keys['arrowleft']) dir.x -= 1;
  if (keys['d'] || keys['arrowright']) dir.x += 1;
  dir.x += joyX;
  dir.z -= joyY;
  if (dir.length()) {
    dir.normalize().multiplyScalar(speed);
    player.position.add(dir);
    player.rotation.y = Math.atan2(dir.x, dir.z);
  }
  player.position.x = Math.max(-55, Math.min(55, player.position.x));
  player.position.z = Math.max(-55, Math.min(55, player.position.z));
  const ideal = new THREE.Vector3(player.position.x, 6.2, player.position.z + 11);
  camera.position.lerp(ideal, 0.07);
  camera.lookAt(player.position.x, 1.5, player.position.z);
}

function updateNPCs() {
  npcs.forEach(npc => {
    const d = npc.userData;
    if (d.singing) {
      // move toward circle
      const toCenter = new THREE.Vector3(-npc.position.x, 0, -npc.position.z);
      if (toCenter.length() > 9) {
        toCenter.normalize().multiplyScalar(d.speed * 1.8);
        npc.position.add(toCenter);
        npc.rotation.y = Math.atan2(toCenter.x, toCenter.z);
      }
      return;
    }
    const toTarget = new THREE.Vector3().subVectors(d.target, npc.position);
    if (toTarget.length() < 1.2) {
      d.target.set(npc.position.x + (Math.random()-0.5)*16, 0, npc.position.z + (Math.random()-0.5)*16);
      d.target.x = Math.max(-50, Math.min(50, d.target.x));
      d.target.z = Math.max(-50, Math.min(50, d.target.z));
    } else {
      toTarget.normalize().multiplyScalar(d.speed);
      npc.position.add(toTarget);
      npc.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
  });
}

function updateAnimals() {
  animals.forEach(a => {
    const d = a.userData;
    const to = new THREE.Vector3().subVectors(d.target, a.position);
    if (to.length() < 1) {
      d.target.set(a.position.x + (Math.random()-0.5)*14, 0, a.position.z + (Math.random()-0.5)*14);
      d.target.x = Math.max(-50, Math.min(50, d.target.x));
      d.target.z = Math.max(-50, Math.min(50, d.target.z));
    } else {
      to.normalize().multiplyScalar(d.speed);
      a.position.add(to);
      a.rotation.y = Math.atan2(to.x, to.z);
    }
  });
}

let singing = false;
window.sayHello = () => showMessage(`${anonName} greets everyone.`);
window.startSinging = () => {
  singing = !singing;
  singingRing.visible = singing;
  npcs.forEach(n => n.userData.singing = singing);
  showMessage(singing ? `${anonName} starts a song. Others come join the circle.` : 'Singing stops.');
};
window.dance = () => {
  showMessage(`${anonName} dances.`);
  const startY = player.position.y;
  let t = 0;
  const hop = () => {
    t += 0.13;
    player.position.y = startY + Math.sin(t) * 0.55;
    if (t < Math.PI * 8) requestAnimationFrame(hop);
    else player.position.y = startY;
  };
  hop();
};
window.pray = () => showMessage(`${anonName} sits in quiet prayer at the circle.`);
window.harvestNearby = () => {
  let found = false;
  crops.forEach(c => {
    if (!c.userData.harvested && c.position.distanceTo(player.position) < 4) {
      c.userData.harvested = true;
      c.scale.y = 0.15;
      c.position.y = 0.15;
      found = true;
      setTimeout(() => { c.userData.harvested = false; c.scale.y = 1; c.position.y = c.userData.originalY; }, 10000);
    }
  });
  showMessage(found ? 'Harvested nearby crops.' : 'No crops close enough.');
};
window.sit = () => showMessage(`${anonName} sits down for a moment.`);

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  updateNPCs();
  updateAnimals();
  if (singing) singingRing.rotation.z += 0.008;
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

showMessage('Use the joystick (or WASD) to roam. Click crops/people. Try Sing.');
console.log('Vibe Explorer upgraded with touch controls, water, animals, singing circle.');