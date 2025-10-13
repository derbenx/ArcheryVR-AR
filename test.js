import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let camera, scene, renderer;
let world, eventQueue;
let loader;

async function init() {
    // --- Renderer and Scene ---
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);

    // --- Camera ---
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 5);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 2, 5);
    scene.add(directionalLight);

    // --- Loader ---
    loader = new GLTFLoader();

    // --- Physics ---
    await RAPIER.init();
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    eventQueue = new RAPIER.EventQueue(true);

    // --- Create Objects ---
    const gltf = await loader.loadAsync('3d/archery.glb');
    createTarget(gltf);
    startCubeSimulation();

    renderer.setAnimationLoop(animate);
}

function createTarget(gltf) {
    const targetGroup = new THREE.Group();
    scene.add(targetGroup);

    const targetBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.6, 0);
    const targetBody = world.createRigidBody(targetBodyDesc);

    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            const visualMesh = child.clone();
            targetGroup.add(visualMesh);

            const vertices = visualMesh.geometry.attributes.position.array;
            const indices = visualMesh.geometry.index.array;
            const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const collider = world.createCollider(colliderDesc, targetBody);
            let scoreValue = child.name === '11' ? 'X' : parseInt(child.name);
            collider.userData = { type: 'target', score: scoreValue };
        }
    });
    targetGroup.position.copy(targetBody.translation());
}

let currentCubeIndex = 0;
const cubeColors = {
    1: 0xff0000, 2: 0xffa500, 3: 0xffff00, 4: 0x008000, 5: 0x800080,
    6: 0xff00ff, 7: 0x00ffff, 8: 0xffc0cb, 9: 0x000000, 10: 0x808080
};
const scoresToTest = Object.keys(cubeColors).map(Number);
const yOffsets = [0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0.02, 0.01];

function startCubeSimulation() {
    fireNextCube();
}

function fireNextCube() {
    if (currentCubeIndex >= scoresToTest.length) return;

    const score = scoresToTest[currentCubeIndex];
    const color = cubeColors[score];
    const y = 1.6 + yOffsets[currentCubeIndex];

    const cubeBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, y, 5)
        .setLinvel(0, 0, -10);
    const cubeBody = world.createRigidBody(cubeBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, 0.02)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = world.createCollider(colliderDesc, cubeBody);
    collider.userData = { type: 'projectile', color: new THREE.Color(color).getHexString() };

    const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshStandardMaterial({ color }));
    cubeMesh.userData.body = cubeBody;
    scene.add(cubeMesh);

    currentCubeIndex++;
    setTimeout(fireNextCube, 500);
}


function animate() {
    world.step(eventQueue);

    scene.children.forEach(child => {
        if (child.userData.body && child.userData.body.isDynamic()) {
            child.position.copy(child.userData.body.translation());
            child.quaternion.copy(child.userData.body.rotation());
        }
    });

    const hits = new Map();

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;

        let projectileCollider, targetCollider;
        const c1 = world.getCollider(handle1);
        const c2 = world.getCollider(handle2);

        if (c1.userData.type === 'projectile' && c2.userData.type === 'target') {
            projectileCollider = c1;
            targetCollider = c2;
        } else if (c2.userData.type === 'projectile' && c1.userData.type === 'target') {
            projectileCollider = c2;
            targetCollider = c1;
        } else {
            return;
        }

        const projectileBody = projectileCollider.parent();
        if (projectileBody.isDynamic()) {
             const handle = projectileCollider.handle;
            if (!hits.has(handle)) {
                hits.set(handle, { scores: [], body: projectileBody, color: projectileCollider.userData.color });
            }
            hits.get(handle).scores.push(targetCollider.userData.score);
        }
    });

    for (const [handle, hitData] of hits) {
        const { scores, body, color } = hitData;
        const zDepth = body.translation().z.toFixed(2);
        logToPage(`Cube #${color} hit rings: [${scores.join(', ')}] at Z-depth: ${zDepth}`);
        body.setBodyType(RAPIER.RigidBodyType.Fixed);
    }

    // Miss detection
    world.bodies.forEach(body => {
        if (body.isDynamic() && body.translation().z < -5) {
             logToPage(`A projectile missed the target.`);
             world.removeRigidBody(body);
        }
    });


    renderer.render(scene, camera);
}

function logToPage(message) {
    const logContainer = document.getElementById('log-container');
    if (logContainer) {
        logContainer.innerHTML += message + '<br>';
    }
    console.log(message);
}

init();