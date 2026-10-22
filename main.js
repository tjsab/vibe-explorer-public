import * as THREE from 'three';

const names = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vivaan', 'Isha', 'Arjun', 'Meera', 'Kabir', 'Saanvi', 'Dev', 'Lakshmi', 'Hari', 'Radha'];
const anonName = names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 99);
document.getElementById('name').textContent = `You are ${anonName}`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lights
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e6, 1.1);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 150;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x3a7d34, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

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
addPath(0, 5, 4, 20);
addPath(0, -15, 3, 12);
addPath(-20, 0, 16, 3);

// Central gathering circle
const mandapa = new THREE.Mesh(
  new THREE.CylinderGeometry(6, 6.5, 0.25, 32),
  new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.7 })
);
mandapa.position.set(0, 0.12, 0);
mandapa.receiveShadow = true;
scene.add(mandapa);

// Simple huts
function addHut(x, z) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4, 2.2, 3.5),
    new THREE.MeshStandardMaterial({ color: 0xe8d5b7, roughness: 0.8 })
  );
  base.position.set(x, 1.1, z);
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.8, 4),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 })
  );
  roof.position.set(x, 2.8, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);
}
addHut(-12, 8);
addHut(14, 6);
addHut(-8, -18);

// Trees
function addTree(x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25 * scale, 0.3 * scale, 2.5 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c4033 })
  );
  trunk.position.set(x, 1.25 * scale, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(1.6 * scale, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.85 })
  );
  foliage.position.set(x, 3.2 * scale, z);
  foliage.castShadow = true;
  scene.add(foliage);
}
for (let i = 0; i < 25; i++) {
  const angle = Math.random() * Math.PI * 2;
  const r = 25 + Math.random() * 20;
  addTree(Math.cos(angle) * r, Math.sin(angle) * r, 0.8 + Math.random() * 0.6);
}

// Farm plots + crops
const crops = [];
function addCropPlot(x, z) {
  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.15, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 })
  );
  soil.position.set(x, 0.08, z);
  soil.receiveShadow = true;
  scene.add(soil);

  const crop = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x4caf50 })
  );
  crop.position.set(x, 0.7, z);
  crop.castShadow = true;
  crop.userData = { type: 'crop', harvested: false, originalY: 0.7 };
  scene.add(crop);
  crops.push(crop);
}
const plotPositions = [[-22, -4], [-18, -4], [-14, -4], [-22, -8], [-18, -8], [-14, -8], [-22, -12], [-18, -12]];
plotPositions.forEach(([x, z]) => addCropPlot(x, z));

// NPCs / bots
const npcs = [];
const npcDialogues = [
  "Namaste! Come join the kirtan later.",
  "The crops are ready if you want to help harvest.",
  "We gather for prayer at the mandapa every evening.",
  "Want to sing with us? Just press the Sing button.",
  "Life is simple here. Grow, eat, share, remember the Divine.",
  "You can dance anytime. The ground is soft.",
  "Hari bol! Welcome to the community."
];

function createNPC(x, z, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 1;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffdbac })
  );
  head.position.y = 1.9;
  group.add(head);

  group.position.set(x, 0, z);
  group.userData = {
    type: 'npc',
    name: names[Math.floor(Math.random() * names.length)],
    dialogue: npcDialogues[Math.floor(Math.random() * npcDialogues.length)],
    target: new THREE.Vector3(x + (Math.random() - 0.5) * 10, 0, z + (Math.random() - 0.5) * 10),
    speed: 0.02 + Math.random() * 0.015
  };
  scene.add(group);
  npcs.push(group);
}
createNPC(4, 3, 0xe74c3c);
createNPC(-5, 6, 0x3498db);
createNPC(8, -5, 0xf39c12);
createNPC(-3, -8, 0x9b59b6);
createNPC(2, 12, 0x1abc9c);

// Player
const player = new THREE.Group();
const pBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.1, 4, 8),
  new THREE.MeshStandardMaterial({ color: 0x6c5ce7 })
);
pBody.position.y = 1.1;
pBody.castShadow = true;
player.add(pBody);
const pHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xffdbac })
);
pHead.position.y = 2.05;
player.add(pHead);
player.position.set(0, 0, 10);
scene.add(player);

// Controls
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const infoEl = document.getElementById('info');

function showMessage(msg, duration = 3000) {
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
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects([...crops, ...npcs], true);
  if (intersects.length) {
    let obj = intersects[0].object;
    while (obj.parent && !obj.userData.type) obj = obj.parent;

    if (obj.userData.type === 'crop' && !obj.userData.harvested) {
      obj.userData.harvested = true;
      obj.scale.y = 0.2;
      obj.position.y = 0.2;
      showMessage('Harvested some greens. The community eats together.');
      setTimeout(() => {
        obj.userData.harvested = false;
        obj.scale.y = 1;
        obj.position.y = obj.userData.originalY;
      }, 8000);
    }

    if (obj.userData.type === 'npc') {
      showMessage(`${obj.userData.name}: "${obj.userData.dialogue}"`);
    }
  }
});

function updatePlayer() {
  const speed = 0.18;
  const dir = new THREE.Vector3();
  if (keys['w'] || keys['arrowup']) dir.z -= 1;
  if (keys['s'] || keys['arrowdown']) dir.z += 1;
  if (keys['a'] || keys['arrowleft']) dir.x -= 1;
  if (keys['d'] || keys['arrowright']) dir.x += 1;
  if (dir.length()) {
    dir.normalize().multiplyScalar(speed);
    player.position.add(dir);
    player.rotation.y = Math.atan2(dir.x, dir.z);
  }

  // Bounds
  player.position.x = Math.max(-45, Math.min(45, player.position.x));
  player.position.z = Math.max(-45, Math.min(45, player.position.z));

  // Camera
  const ideal = new THREE.Vector3(player.position.x, 5.5, player.position.z + 10);
  camera.position.lerp(ideal, 0.08);
  camera.lookAt(player.position.x, 1.4, player.position.z);
}

function updateNPCs() {
  npcs.forEach(npc => {
    const data = npc.userData;
    const toTarget = new THREE.Vector3().subVectors(data.target, npc.position);
    if (toTarget.length() < 1) {
      data.target.set(
        npc.position.x + (Math.random() - 0.5) * 14,
        0,
        npc.position.z + (Math.random() - 0.5) * 14
      );
      data.target.x = Math.max(-40, Math.min(40, data.target.x));
      data.target.z = Math.max(-40, Math.min(40, data.target.z));
    } else {
      toTarget.normalize().multiplyScalar(data.speed);
      npc.position.add(toTarget);
      npc.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
  });
}

// Action buttons
window.sayHello = () => showMessage(`${anonName} greets the community.`);
window.startSinging = () => showMessage(`${anonName} starts a kirtan. Others may join.`);
window.dance = () => {
  showMessage(`${anonName} starts dancing.`);
  const startY = player.position.y;
  let t = 0;
  const hop = () => {
    t += 0.12;
    player.position.y = startY + Math.sin(t) * 0.5;
    if (t < Math.PI * 6) requestAnimationFrame(hop);
    else player.position.y = startY;
  };
  hop();
};
window.pray = () => showMessage(`${anonName} joins in prayer / Bhakti at the mandapa.`);

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  updateNPCs();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

showMessage('WASD to walk. Click crops to harvest. Click people to talk.');
console.log('Vibe Explorer upgraded. Roam, harvest, talk to the bots.');