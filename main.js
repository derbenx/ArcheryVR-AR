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
const GROUP_TARGET = 1 << 1;
const GROUP_FLOOR = 1 << 2;

const ARROW_GROUP_FILTER = (GROUP_ARROW << 16) | (GROUP_TARGET | GROUP_FLOOR);
const TARGET_GROUP_FILTER = (GROUP_TARGET << 16) | GROUP_ARROW;
const FLOOR_GROUP_FILTER = (GROUP_FLOOR << 16) | GROUP_ARROW;

// --- Game Objects ---
let bow, target, bowstring;
let arrowTemplate;
let arrowObject = null;
let firedArrows = [];

// --- Controller and State ---
let bowController = null;
let arrowController = null;
let sceneSetupInitiated = false;

async function init() {
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

    await RAPIER.init();
    world = new RAPIER.World(gravity);

    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local-floor', 'plane-detection'] });
    document.body.appendChild(arButton);
    planes = new XRPlanes(renderer);
    scene.add(planes);

    setupControllers();

    renderer.xr.addEventListener('sessionend', cleanupScene);
    window.addEventListener('resize', onWindowResize);
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

        controller.addEventListener('connected', (event) => {
            controller.gamepad = event.data.gamepad;
        });

        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
    }
}

function onSelectStart(event) {
    const controller = event.target;
    if (bowController && controller !== bowController) {
        if (!arrowObject) {
            if (!arrowTemplate) return;

            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);

            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
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
    if (arrowController === event.target) {
        shootArrow();
    }
}

async function placeScene(floorY) {
    const gltf = await loader.loadAsync('3d/archery.glb');

    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER);
    world.createCollider(floorColliderDesc, floorBody);

    target = new THREE.Group();
    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            target.add(child.clone());
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

    bow = gltf.scene.getObjectByName('bow');
    if (bow) {
        scene.add(bow);
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

    const arrowMesh = gltf.scene.getObjectByName('arrow');
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

    // The shooting direction is determined by the bow's orientation
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(bow.quaternion);

    const { length: arrowLength } = arrowTemplate.userData;
    const drawDistance = Math.min(bowHand.position.distanceTo(arrowHand.position), arrowLength);
    const drawRatio = drawDistance / arrowLength;
    const maxSpeed = 30;
    const speed = drawRatio * maxSpeed;

    arrowObject.body.setLinvel(direction.multiplyScalar(speed), true);

    firedArrows.push(arrowObject);
    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) scene.remove(target);
    if (bow) scene.remove(bow);
    if (bowstring) scene.remove(bowstring);

    if (arrowObject) {
        if (arrowObject.mesh) scene.remove(arrowObject.mesh);
        if (arrowObject.body) world.removeRigidBody(arrowObject.body);
    }
    firedArrows.forEach(obj => {
        if (obj.mesh) scene.remove(obj.mesh);
        if (obj.body) world.removeRigidBody(obj.body);
    });

    if (floorBody) world.removeRigidBody(floorBody);

    target = bow = bowstring = arrowTemplate = arrowObject = bowController = arrowController = floorBody = null;
    firedArrows = [];
    sceneSetupInitiated = false;
}

function animate(timestamp, frame) {
    if (renderer.xr.isPresenting && !sceneSetupInitiated && frame) {
        if (planes.children.length > 0) {
            let floorY = 0;
            planes.children.forEach(plane => { floorY = Math.min(floorY, plane.position.y); });
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
        const arrowBody = arrowObject.body;
        const mesh = arrowObject.mesh;

        // The arrow's rotation should match the bow's rotation exactly.
        mesh.quaternion.copy(bow.quaternion);

        // The arrow's position should be at the drawing hand.
        mesh.position.copy(arrowHand.position);

        // Update the physics body to match.
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