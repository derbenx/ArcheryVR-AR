import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

// --- Three.js and Global Variables ---
let camera, scene, renderer;
let loader;
let planes;
let floorBody = null;

// --- Physics ---
let world;
const gravity = { x: 0.0, y: -5.0, z: 0.0 };

// --- Collision Groups ---
const GROUP_ARROW = 1 << 0;
const GROUP_BOW = 1 << 1;
const GROUP_TARGET = 1 << 2;
const GROUP_FLOOR = 1 << 3;

// Arrow collides with Target and Floor
const ARROW_GROUP_FILTER = (GROUP_ARROW << 16) | (GROUP_TARGET | GROUP_FLOOR);
// Bow collides with nothing (it's kinematic and visual only)
const BOW_GROUP_FILTER = (GROUP_BOW << 16) | 0;
// Target collides with Arrow
const TARGET_GROUP_FILTER = (GROUP_TARGET << 16) | GROUP_ARROW;
// Floor collides with Arrow
const FLOOR_GROUP_FILTER = (GROUP_FLOOR << 16) | GROUP_ARROW;


// --- Game Objects ---
let bow, target, bowstring;
let arrowTemplate; // To clone new arrows from
let arrowObject = null; // The currently active/nocked arrow { mesh, body }
let firedArrows = []; // Store arrows that have been shot

// --- Controller and State ---
let bowController = null;
let arrowController = null;
let sceneSetupInitiated = false;

async function init() {
    // Basic Three.js setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 2, -5);
    scene.add(directionalLight);

    loader = new GLTFLoader();

    // Physics World
    await RAPIER.init();
    world = new RAPIER.World(gravity);

    // AR Setup
    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ['local-floor', 'plane-detection']
    });
    document.body.appendChild(arButton);
    planes = new XRPlanes(renderer);
    scene.add(planes);

    // Controller Setup
    setupControllers();

    // Event Listeners
    renderer.xr.addEventListener('sessionend', cleanupScene);
    window.addEventListener('resize', onWindowResize);

    // Start render loop
    renderer.setAnimationLoop(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupControllers() {
    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.userData.id = i;
        scene.add(controller);

        const grip = renderer.xr.getControllerGrip(i);
        grip.add(controllerModelFactory.createControllerModel(grip));
        scene.add(grip);

        controller.addEventListener('connected', function(event) {
            this.gamepad = event.data.gamepad;
        });

        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
    }
}

function onSelectStart(event) {
    const controller = event.target;

    // A non-bow controller can nock an arrow
    if (bowController && controller !== bowController) {
        // If there's no arrow ready, create one.
        if (!arrowObject) {
            if (!arrowTemplate) return;

            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);

            const bowPosition = bow.position;
            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(bowPosition.x, bowPosition.y, bowPosition.z);
            const body = world.createRigidBody(arrowBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, 0.4)
                .setMass(0.1)
                .setCollisionGroups(ARROW_GROUP_FILTER);
            world.createCollider(colliderDesc, body);

            arrowObject = { mesh: newArrowMesh, body: body };
        }

        arrowController = controller;
    }
}

function onSelectEnd(event) {
    const controller = event.target;
    if (arrowController === controller) {
        shootArrow();
        arrowController = null;
    }
}

async function placeScene(floorY) {
    const gltf = await loader.loadAsync('3d/archery.glb');

    // --- Invisible Floor ---
    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER);
    world.createCollider(floorColliderDesc, floorBody);

    // --- Target Setup ---
    target = new THREE.Group();
    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            const ring = child.clone();
            target.add(ring);
        }
    });
    target.position.set(0, floorY + 1.2, -10);
    target.rotation.y = Math.PI;
    scene.add(target);

    target.children.forEach(ring => {
        const ringBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
            target.position.x, target.position.y, target.position.z
        ).setRotation(target.quaternion);
        const ringBody = world.createRigidBody(ringBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.trimesh(
            ring.geometry.attributes.position.array,
            ring.geometry.index.array
        ).setCollisionGroups(TARGET_GROUP_FILTER);
        world.createCollider(colliderDesc, ringBody);
    });

    // --- Bow and Arrow Template Setup ---
    bow = gltf.scene.getObjectByName('bow');
    const arrowMesh = gltf.scene.getObjectByName('arrow');
    if (bow) {
        scene.add(bow);

        // --- Bowstring Setup ---
        bow.geometry.computeBoundingBox();
        const bowBox = bow.geometry.boundingBox;
        const bowCenterX = bowBox.getCenter(new THREE.Vector3()).x;
        const backZ = bowBox.min.z;
        bow.userData.top = new THREE.Vector3(bowCenterX, bowBox.max.y, backZ);
        bow.userData.bottom = new THREE.Vector3(bowCenterX, bowBox.min.y, backZ);

        const stringMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        const points = new Float32Array(3 * 3);
        const stringGeometry = new THREE.BufferGeometry();
        stringGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

        bowstring = new THREE.Line(stringGeometry, stringMaterial);
        scene.add(bowstring);
    }
    if (arrowMesh) {
        arrowTemplate = arrowMesh;
        arrowTemplate.geometry.computeBoundingBox();
        const arrowBox = arrowTemplate.geometry.boundingBox;
        arrowTemplate.userData.length = arrowBox.max.z - arrowBox.min.z;
        arrowTemplate.visible = false;
    }
}

function shootArrow() {
    if (!bowController || !arrowController || !arrowObject || !arrowObject.body) return;

    arrowObject.body.setBodyType(RAPIER.RigidBodyType.Dynamic);

    const arrowHand = renderer.xr.getController(arrowController.userData.id);
    const bowHand = renderer.xr.getController(bowController.userData.id);
    const direction = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position).normalize();

    const { length: arrowLength } = arrowTemplate.userData;
    const drawDistance = Math.min(bowHand.position.distanceTo(arrowHand.position), arrowLength);
    const drawRatio = drawDistance / arrowLength;
    const maxSpeed = 30;
    const speed = drawRatio * maxSpeed;

    arrowObject.body.setLinvel(direction.multiplyScalar(speed), true);

    firedArrows.push(arrowObject);
    arrowObject = null;
}

function cleanupScene() {
    if (target) scene.remove(target);
    if (bow) scene.remove(bow);
    if (bowstring) scene.remove(bowstring);
    if (arrowObject && arrowObject.mesh) scene.remove(arrowObject.mesh);
    if (arrowObject && arrowObject.body) world.removeRigidBody(arrowObject.body);
    firedArrows.forEach(obj => {
        if (obj.mesh) scene.remove(obj.mesh);
        if (obj.body) world.removeRigidBody(obj.body);
    });

    if (floorBody) {
        world.removeRigidBody(floorBody);
        floorBody = null;
    }

    target = null;
    bow = null;
    bowstring = null;
    arrowTemplate = null;
    arrowObject = null;
    firedArrows = [];
    bowController = null;
    arrowController = null;
    sceneSetupInitiated = false;
}

function animate(timestamp, frame) {
    if (renderer.xr.isPresenting && !sceneSetupInitiated && frame) {
        if (planes.children.length > 0) {
            let floorY = 0;
            planes.children.forEach(plane => {
                floorY = Math.min(floorY, plane.position.y);
            });
            placeScene(floorY);
            sceneSetupInitiated = true;
            planes.visible = false;
        }
    }

    if (world) world.step();

    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                if (controller.gamepad.buttons[1].pressed) {
                    if (!bowController) bowController = controller;
                } else {
                    if (bowController === controller) bowController = null;
                }
            }
        }
    }

    if (bowController && bow) {
        const controller = renderer.xr.getController(bowController.userData.id);
        const offsetRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const finalRotation = controller.quaternion.clone().multiply(offsetRotation);

        bow.position.copy(controller.position);
        bow.quaternion.copy(finalRotation);
    }

    if (arrowController && arrowObject && arrowObject.body && bowController) {
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const arrowBody = arrowObject.body;
        const mesh = arrowObject.mesh;
        const arrowLength = arrowTemplate.userData.length;

        // 1. Aim the arrow from the drawing hand towards the bow hand
        mesh.position.copy(arrowHand.position);
        mesh.lookAt(bowHand.position);

        // 2. Correct the orientation since the model's "front" is its tail
        mesh.rotateY(Math.PI);

        // 3. Offset the arrow's position so its nock is at the hand
        const direction = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position).normalize();
        const offset = direction.clone().multiplyScalar(arrowLength / 2);
        mesh.position.add(offset);

        // 4. Update the physics body
        arrowBody.setNextKinematicTranslation(mesh.position);
        arrowBody.setNextKinematicRotation(mesh.quaternion);
    }

    firedArrows.forEach(obj => {
        if (obj.body) {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        }
    });

    if (bow && bowstring) {
        const positions = bowstring.geometry.attributes.position.array;

        const topPointLocal = bow.userData.top;
        const bottomPointLocal = bow.userData.bottom;

        const topPointWorld = topPointLocal.clone().applyMatrix4(bow.matrixWorld);
        const bottomPointWorld = bottomPointLocal.clone().applyMatrix4(bow.matrixWorld);

        if (arrowController) {
            const controllerPosition = renderer.xr.getController(arrowController.userData.id).position;
            positions[0] = topPointWorld.x; positions[1] = topPointWorld.y; positions[2] = topPointWorld.z;
            positions[3] = controllerPosition.x; positions[4] = controllerPosition.y; positions[5] = controllerPosition.z;
            positions[6] = bottomPointWorld.x; positions[7] = bottomPointWorld.y; positions[8] = bottomPointWorld.z;
        } else {
            positions[0] = topPointWorld.x; positions[1] = topPointWorld.y; positions[2] = topPointWorld.z;
            positions[3] = bottomPointWorld.x; positions[4] = bottomPointWorld.y; positions[5] = bottomPointWorld.z;
            positions[6] = bottomPointWorld.x; positions[7] = bottomPointWorld.y; positions[8] = bottomPointWorld.z;
        }

        bowstring.geometry.attributes.position.needsUpdate = true;
        bowstring.geometry.computeBoundingSphere();
    }

    renderer.render(scene, camera);
}

init();