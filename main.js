import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';
import { Scoreboard } from './js/Scoreboard.js';

// Three.js and Global Variables
let camera, scene, renderer;
let loader;
let planes;
let floorBody = null;

// Physics
let world, eventQueue;
const gravity = { x: 0.0, y: -5.0, z: 0.0 };

// Game Objects
let bow, target, bowstring, scoreboard;
let arrowTemplate; // To clone new arrows from
let arrowObject = null; // The currently active/nocked arrow { mesh, body }
let dozenArrows = []; // Store all 12 arrows for a full dozen round

// Game State
const gameState = {
    arrowsShotInDozen: 0,
    isScoring: false,
};

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
    eventQueue = new RAPIER.EventQueue(true);

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
            if (!arrowTemplate) return; // Guard against missing template

            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);

            const bowPosition = bow.position;
            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(bowPosition.x, bowPosition.y, bowPosition.z); // Start at bow
            const body = world.createRigidBody(arrowBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, 0.4).setMass(0.1);
            const collider = world.createCollider(colliderDesc, body);

            arrowObject = { mesh: newArrowMesh, body: body, collider: collider, hasScored: false, score: 0 };
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
    // Load model
    const gltf = await loader.loadAsync('3d/archery.glb');

    // --- Invisible Floor ---
    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
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
    target.rotation.y = Math.PI; // Face the player
    scene.add(target);

    target.children.forEach(ring => {
        const ringBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
            target.position.x, target.position.y, target.position.z
        ).setRotation(target.quaternion);
        const ringBody = world.createRigidBody(ringBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.trimesh(
            ring.geometry.attributes.position.array,
            ring.geometry.index.array
        ).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const ringCollider = world.createCollider(colliderDesc, ringBody);

        // Store the score value in the collider's user data
        const score = parseInt(ring.name);
        ringCollider.userData = { score: score };
    });

    // --- Scoreboard ---
    scoreboard = new Scoreboard();
    scoreboard.mesh.position.set(2.5, floorY + 1.5, -10); // Position it next to the target
    scene.add(scoreboard.mesh);

    // --- Bow and Arrow Template Setup ---
    bow = gltf.scene.getObjectByName('bow');
    const arrowMesh = gltf.scene.getObjectByName('arrow');
    if (bow) {
        scene.add(bow);

        // --- Bowstring Setup ---
        bow.geometry.computeBoundingBox();
        const bowBox = bow.geometry.boundingBox;
        const bowSize = new THREE.Vector3();
        bowBox.getSize(bowSize);
        const bowCenter = new THREE.Vector3();
        bowBox.getCenter(bowCenter);

        // Determine the longest axis to be the bow's height
        let heightAxis = 'y';
        if (bowSize.x > bowSize.y && bowSize.x > bowSize.z) heightAxis = 'x';
        else if (bowSize.z > bowSize.y) heightAxis = 'z';

        // Assume the back of the bow is along the minimum Z axis in local space
        const backZ = bowBox.min.z;

        switch (heightAxis) {
            case 'x':
                bow.userData.top = new THREE.Vector3(bowBox.max.x, bowCenter.y, backZ);
                bow.userData.bottom = new THREE.Vector3(bowBox.min.x, bowCenter.y, backZ);
                break;
            case 'y':
                bow.userData.top = new THREE.Vector3(bowCenter.x, bowBox.max.y, backZ);
                bow.userData.bottom = new THREE.Vector3(bowCenter.x, bowBox.min.y, backZ);
                break;
            case 'z': // This case is unlikely but handled. Assumes X is depth.
                bow.userData.top = new THREE.Vector3(bowBox.max.x, bowCenter.y, bowBox.max.z);
                bow.userData.bottom = new THREE.Vector3(bowBox.max.x, bowCenter.y, bowBox.min.z);
                break;
        }

        const stringMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        const points = new Float32Array(3 * 3); // 3 vertices, 3 coordinates each
        const stringGeometry = new THREE.BufferGeometry();
        stringGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

        bowstring = new THREE.Line(stringGeometry, stringMaterial);
        scene.add(bowstring);
    }
    if (arrowMesh) {
        arrowTemplate = arrowMesh;
        arrowTemplate.geometry.computeBoundingBox();
        const arrowBox = arrowTemplate.geometry.boundingBox;
        const arrowSize = new THREE.Vector3();
        arrowBox.getSize(arrowSize);

        // Determine the longest axis to be the 'forward' direction
        let longestAxis = 'z';
        let maxLength = arrowSize.z;
        if (arrowSize.x > maxLength) {
            longestAxis = 'x';
            maxLength = arrowSize.x;
        }
        if (arrowSize.y > maxLength) {
            longestAxis = 'y';
            maxLength = arrowSize.y;
        }

        arrowTemplate.userData.length = maxLength;

        // Define forward and nock vectors based on the longest axis.
        // The nock is the back-end of the arrow.
        switch (longestAxis) {
            case 'x':
                arrowTemplate.userData.forward = new THREE.Vector3(1, 0, 0);
                arrowTemplate.userData.nock = new THREE.Vector3(arrowBox.min.x, 0, 0);
                break;
            case 'y':
                arrowTemplate.userData.forward = new THREE.Vector3(0, 1, 0);
                arrowTemplate.userData.nock = new THREE.Vector3(0, arrowBox.min.y, 0);
                break;
            default: // 'z'
                arrowTemplate.userData.forward = new THREE.Vector3(0, 0, 1);
                arrowTemplate.userData.nock = new THREE.Vector3(0, 0, arrowBox.min.z);
                break;
        }

        arrowTemplate.visible = false; // The template is never visible
    }
}

function shootArrow() {
    if (!bowController || !arrowController || !arrowObject || !arrowObject.body || gameState.isScoring) return;

    // 1. Set arrow to be a dynamic body and enable collision events
    arrowObject.body.setBodyType(RAPIER.RigidBodyType.Dynamic);
    arrowObject.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    // 2. Calculate shooting direction from arrow hand to bow hand
    const arrowHand = renderer.xr.getController(arrowController.userData.id);
    const bowHand = renderer.xr.getController(bowController.userData.id);
    const direction = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position).normalize();

    // 3. Calculate power based on draw distance
    const drawDistance = bowHand.position.distanceTo(arrowHand.position);
    const power = Math.min(drawDistance, 1.0) * 60; // Capped power

    // 4. Apply impulse
    arrowObject.body.applyImpulse(direction.multiplyScalar(power), true);

    // 5. Move the fired arrow to the dozen list and update game state
    dozenArrows.push(arrowObject);
    gameState.arrowsShotInDozen++;
    arrowObject = null;
    arrowController = null;
}

function processEnd() {
    // This function is called when an end of 3 arrows is complete.
    // It updates the scoreboard and, if a dozen is complete, handles cleanup.

    // 1. Get scores from the relevant 3 arrows.
    const startIdx = scoreboard.scores.length;
    const endArrows = dozenArrows.slice(startIdx, startIdx + 3);
    const endScores = endArrows.map(arrow => arrow.score || 0);

    // 2. Update the scoreboard
    scoreboard.addScores(endScores);

    // 3. Check if the dozen is complete
    if (gameState.arrowsShotInDozen >= 12) {
        gameState.isScoring = true; // Prevent shooting during cleanup
        // After a delay, clean up the entire dozen
        setTimeout(() => {
            dozenArrows.forEach(obj => {
                if (obj.mesh) scene.remove(obj.mesh);
                if (obj.body) world.removeRigidBody(obj.body);
            });

            // Reset for the next dozen
            dozenArrows = [];
            gameState.arrowsShotInDozen = 0;
            scoreboard.clear(); // Clear the visual scoreboard
            gameState.isScoring = false; // Allow shooting again

        }, 5000); // 5-second delay to view final scores
    }
}

function cleanupScene() {
    if (target) scene.remove(target);
    if (bow) scene.remove(bow);
    if (bowstring) scene.remove(bowstring);
    if (scoreboard) scene.remove(scoreboard.mesh);
    if (arrowObject && arrowObject.mesh) scene.remove(arrowObject.mesh);
    if (arrowObject && arrowObject.body) world.removeRigidBody(arrowObject.body);
    dozenArrows.forEach(obj => {
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
    scoreboard = null;
    arrowTemplate = null;
    arrowObject = null;
    dozenArrows = [];
    bowController = null;
    arrowController = null;
    sceneSetupInitiated = false;

    // Reset game state
    gameState.arrowsShotInDozen = 0;
    gameState.isScoring = false;

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

    if (world) world.step(eventQueue);

    // --- Game Loop Logic ---
    if (gameState.arrowsShotInDozen > 0 && gameState.arrowsShotInDozen % 3 === 0) {
        const processedEnds = scoreboard.scores.length / 3;
        const currentEnd = gameState.arrowsShotInDozen / 3;
        if (currentEnd > processedEnds) {
             processEnd();
        }
    }

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;

        const collider1 = world.getCollider(handle1);
        const collider2 = world.getCollider(handle2);

        const arrow = dozenArrows.find(a => a.collider.handle === handle1 || a.collider.handle === handle2);
        if (!arrow || arrow.hasScored) return;

        let targetCollider;
        if (arrow.collider.handle === handle1) {
            targetCollider = collider2;
        } else {
            targetCollider = collider1;
        }

        if (targetCollider.userData && typeof targetCollider.userData.score === 'number') {
            arrow.hasScored = true;
            arrow.score = targetCollider.userData.score;
            arrow.body.setBodyType(RAPIER.RigidBodyType.Fixed); // Make it stick
            console.log(`Arrow hit target, score: ${arrow.score}`);
        }
    });

    // --- Controller Logic ---
    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
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

        // Apply a 180-degree rotation to correct the bow's orientation
        const offsetRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const finalRotation = controller.quaternion.clone().multiply(offsetRotation);
        bow.quaternion.copy(finalRotation);
    }

    if (arrowController && arrowObject && arrowObject.body && bowController) {
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const arrowBody = arrowObject.body;
        const { forward: localForward, nock: localNock } = arrowTemplate.userData;

        // 1. Get world-space direction from arrow hand to bow hand
        const worldDirection = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position).normalize();

        // 2. Create rotation quaternion
        const rotationQuaternion = new THREE.Quaternion().setFromUnitVectors(localForward, worldDirection);

        // Apply a 180-degree spin to correct the model's orientation
        const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        rotationQuaternion.multiply(spin);

        // 3. Calculate the rotated nock offset
        const rotatedNockOffset = localNock.clone().applyQuaternion(rotationQuaternion);

        // 4. Calculate the final position for the arrow's center
        const newArrowPosition = new THREE.Vector3().subVectors(arrowHand.position, rotatedNockOffset);

        // 5. Update the kinematic body
        arrowBody.setNextKinematicTranslation(newArrowPosition);
        arrowBody.setNextKinematicRotation(rotationQuaternion);
    }

    // Sync all physics bodies with their meshes
    if (arrowObject && arrowObject.body) {
        arrowObject.mesh.position.copy(arrowObject.body.translation());
        arrowObject.mesh.quaternion.copy(arrowObject.body.rotation());
    }
    dozenArrows.forEach(obj => {
        if (obj.body && obj.body.bodyType() === RAPIER.RigidBodyType.Dynamic) { // Only sync dynamic arrows
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        }
    });

    // --- Update Bowstring ---
    if (bow && bowstring) {
        const positions = bowstring.geometry.attributes.position.array;

        // Get bowstring attachment points from bow's userData
        const topPointLocal = bow.userData.top;
        const bottomPointLocal = bow.userData.bottom;

        // Transform these points to world space
        const topPointWorld = topPointLocal.clone().applyMatrix4(bow.matrixWorld);
        const bottomPointWorld = bottomPointLocal.clone().applyMatrix4(bow.matrixWorld);

        if (arrowController) {
            // Drawn state: top -> controller -> bottom
            const controllerPosition = renderer.xr.getController(arrowController.userData.id).position;

            positions[0] = topPointWorld.x;
            positions[1] = topPointWorld.y;
            positions[2] = topPointWorld.z;

            positions[3] = controllerPosition.x;
            positions[4] = controllerPosition.y;
            positions[5] = controllerPosition.z;

            positions[6] = bottomPointWorld.x;
            positions[7] = bottomPointWorld.y;
            positions[8] = bottomPointWorld.z;

        } else {
            // Idle state: top -> bottom
            positions[0] = topPointWorld.x;
            positions[1] = topPointWorld.y;
            positions[2] = topPointWorld.z;

            positions[3] = bottomPointWorld.x;
            positions[4] = bottomPointWorld.y;
            positions[5] = bottomPointWorld.z;

            // Hide the second segment by making it zero-length
            positions[6] = bottomPointWorld.x;
            positions[7] = bottomPointWorld.y;
            positions[8] = bottomPointWorld.z;
        }

        bowstring.geometry.attributes.position.needsUpdate = true;
        bowstring.geometry.computeBoundingSphere();
    }


    renderer.render(scene, camera);
}

init();