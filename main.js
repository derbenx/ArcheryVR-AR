import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

// Three.js and Global Variables
let camera, scene, renderer;
let loader;
let planes;

// Physics
let world;
const gravity = { x: 0.0, y: -5.0, z: 0.0 }; // Reduced gravity for a more floaty arrow

// Game Objects
let bow, arrow, target;
let arrowObject = null; // Will store { mesh, body }

// Controller and State
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
    renderer.xr.addEventListener('sessionstart', () => console.log('XR session started.'));
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

        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
    }
}

function onSelectStart(event) {
    const controller = event.target;

    // If a bow is held, the other controller can nock an arrow
    if (bowController && controller !== bowController) {
        arrowController = controller;
        if (arrowObject && arrowObject.body) {
            // Set to kinematic so we can control it
            arrowObject.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
        }
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
    // Load model
    const gltf = await loader.loadAsync('3d/archery.glb');

    // --- Target Setup ---
    target = new THREE.Group();
    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            const ring = child.clone();
            target.add(ring);
        }
    });
    target.position.set(0, floorY + 1.2, -10);
    target.rotation.y = Math.PI; // Face the player
    scene.add(target);

    // Create static colliders for each target ring
    target.children.forEach(ring => {
        const ringBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
            target.position.x, target.position.y, target.position.z
        ).setRotation(target.quaternion);
        const ringBody = world.createRigidBody(ringBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.trimesh(
            ring.geometry.attributes.position.array,
            ring.geometry.index.array
        );
        world.createCollider(colliderDesc, ringBody);
    });

    // --- Bow and Arrow Setup ---
    bow = gltf.scene.getObjectByName('bow');
    arrow = gltf.scene.getObjectByName('arrow');
    if (bow) scene.add(bow);
    if (arrow) {
        scene.add(arrow);
        // Create the single, reusable physics body for the arrow
        const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(0, floorY + 1.5, -0.5); // Initial position
        const body = world.createRigidBody(arrowBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, 0.4).setMass(0.1);
        world.createCollider(colliderDesc, body);
        arrowObject = { mesh: arrow, body: body };
    }
}

function shootArrow() {
    if (!bow || !arrowObject || !arrowObject.body) return;

    // 1. Set arrow to be a dynamic body
    arrowObject.body.setBodyType(RAPIER.RigidBodyType.Dynamic);

    // 2. Calculate shooting direction from the bow's orientation
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(bow.quaternion);
    direction.normalize();

    // 3. Calculate power based on draw distance
    const drawDistance = bow.position.distanceTo(arrow.position);
    const power = Math.min(drawDistance, 1.0) * 60; // Capped power

    // 4. Apply impulse
    arrowObject.body.applyImpulse(direction.multiplyScalar(power), true);

    // 5. Create a new arrow to be nocked next time
    setTimeout(() => {
        if (arrow) {
            const newArrow = arrow.clone();
            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(0, -100, 0); // Hide it away
            const body = world.createRigidBody(arrowBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, 0.4).setMass(0.1);
            world.createCollider(colliderDesc, body);

            arrow = newArrow;
            arrowObject = { mesh: newArrow, body: body };
            scene.add(newArrow);
        }
    }, 1000); // Respawn after 1 second
}

function cleanupScene() {
    if (target) scene.remove(target);
    if (bow) scene.remove(bow);
    if (arrowObject && arrowObject.mesh) scene.remove(arrowObject.mesh);
    if (arrowObject && arrowObject.body) world.removeRigidBody(arrowObject.body);

    target = null;
    bow = null;
    arrow = null;
    arrowObject = null;
    bowController = null;
    arrowController = null;
    sceneSetupInitiated = false;
    console.log("Scene cleaned up.");
}

function animate(timestamp, frame) {
    // --- Scene Placement ---
    if (renderer.xr.isPresenting && !sceneSetupInitiated && frame) {
        if (planes.children.length > 0) {
            let floorY = 0;
            planes.children.forEach(plane => {
                floorY = Math.min(floorY, plane.position.y);
            });
            placeScene(floorY);
            sceneSetupInitiated = true;
            planes.visible = false; // Hide planes once scene is placed
        }
    }

    // Step physics world
    if (world) {
        world.step();
    }

    // --- Controller Logic ---
    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller.gamepad) {
                // Grip button to hold the bow
                if (controller.gamepad.buttons[1].pressed) {
                    if (!bowController) bowController = controller;
                } else {
                    if (bowController === controller) bowController = null;
                }
            }
        }
    }

    // --- Update Game Objects ---
    if (bowController && bow) {
        const controller = renderer.xr.getController(bowController.userData.id);
        bow.position.copy(controller.position);
        bow.quaternion.copy(controller.quaternion);
    }

    if (arrowController && arrowObject) {
        // Arrow is nocked and being drawn
        const controller = renderer.xr.getController(arrowController.userData.id);
        const arrowBody = arrowObject.body;

        // Move the kinematic body to the controller's position
        arrowBody.setNextKinematicTranslation(controller.position);

        // Align arrow with the bow
        const bowQuaternion = bow ? bow.quaternion : controller.quaternion;
        arrowBody.setNextKinematicRotation(bowQuaternion);
    }

    // Sync all physics bodies with their meshes
    if (arrowObject && arrowObject.body) {
        arrowObject.mesh.position.copy(arrowObject.body.translation());
        arrowObject.mesh.quaternion.copy(arrowObject.body.rotation());
    }

    renderer.render(scene, camera);
}

init();