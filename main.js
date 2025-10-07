import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';
import { Scoreboard } from './js/Scoreboard.js';

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

// --- Game State ---
const GameState = {
    SHOOTING: 'shooting',
    INSPECTING: 'inspecting', // Target is close for inspection
    ROUND_OVER: 'round_over'  // Round is over, processing score
};
let gameState = GameState.SHOOTING;

// --- Scoreboard ---
let scoreboard;
let eventQueue;
let colliderToScoreMap;

// --- Controller and State ---
let bowController = null;
let arrowController = null;
let sceneSetupInitiated = false;
let aButtonPressed = [false, false]; // To track 'A' button state for each controller

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
    eventQueue = new RAPIER.EventQueue(true);
    colliderToScoreMap = new Map();

    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local-floor', 'plane-detection'] });
    document.body.appendChild(arButton);
    planes = new XRPlanes(renderer);
    scene.add(planes);

    setupControllers();

    // Create and position the scoreboard
    scoreboard = new Scoreboard();
    const scoreboardMesh = scoreboard.getMesh();
    // Position it in a fixed location in the world.
    scoreboardMesh.position.set(0, 1.6, -2.5);
    scene.add(scoreboardMesh);


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
        // Only allow drawing a new arrow if in SHOOTING state
        if (gameState === GameState.SHOOTING && !arrowObject) {
            if (!arrowTemplate) return;

            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);

            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
            const body = world.createRigidBody(arrowBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, arrowTemplate.userData.length / 2) // Rapier cuboids are half-extents
                .setMass(0.1)
                .setCollisionGroups(ARROW_GROUP_FILTER)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const collider = world.createCollider(colliderDesc, body);

            arrowObject = { mesh: newArrowMesh, body: body, hasScored: false, score: 'M' }; // Default score is Miss
            collider.userData = { type: 'arrow', arrow: arrowObject };
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
    const floorCollider = world.createCollider(floorColliderDesc, floorBody);
    floorCollider.userData = { type: 'floor' };

    target = new THREE.Group();
    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            target.add(child.clone());
        }
    });
    target.position.set(0, floorY + 1.2, -10);
    target.rotation.y = Math.PI;
    scene.add(target);

    target.userData.originalPosition = target.position.clone();
    target.userData.scoringPosition = new THREE.Vector3(0, target.position.y, -3);
    target.userData.inScoringPosition = false;
    target.userData.ringBodies = [];

    target.children.forEach(ring => {
        const ringBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            target.position.x, target.position.y, target.position.z
        ).setRotation(target.quaternion);
        const ringBody = world.createRigidBody(ringBodyDesc);
        target.userData.ringBodies.push(ringBody);
        const colliderDesc = RAPIER.ColliderDesc.trimesh(
            ring.geometry.attributes.position.array,
            ring.geometry.index.array
        )
        .setCollisionGroups(TARGET_GROUP_FILTER)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const collider = world.createCollider(colliderDesc, ringBody);

        let scoreValue = ring.name === '11' ? 'X' : ring.name;
        colliderToScoreMap.set(collider.handle, scoreValue);

        collider.userData = { type: 'target' };
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
        const arrowSize = new THREE.Vector3();
        arrowBox.getSize(arrowSize);

        const maxDim = Math.max(arrowSize.x, arrowSize.y, arrowSize.z);
        arrowTemplate.userData.length = maxDim;

        const localForward = new THREE.Vector3();
        const localNock = new THREE.Vector3();
        const center = arrowBox.getCenter(new THREE.Vector3());

        // Determine the longest axis and assume the tip is at the negative end and nock at the positive end.
        if (arrowSize.x === maxDim) {
            localForward.set(-1, 0, 0);
            localNock.set(arrowBox.max.x, center.y, center.z);
        } else if (arrowSize.y === maxDim) {
            localForward.set(0, -1, 0);
            localNock.set(center.x, arrowBox.max.y, center.z);
        } else {
            localForward.set(0, 0, -1);
            localNock.set(center.x, center.y, arrowBox.max.z);
        }

        arrowTemplate.userData.forward = localForward;
        arrowTemplate.userData.nock = localNock;

        arrowTemplate.visible = false;
    }
}

function shootArrow() {
    if (!bowController || !arrowController || !arrowObject || !arrowObject.body) return;

    const { mesh, body } = arrowObject;

    body.setTranslation(mesh.position, true);
    body.setRotation(mesh.quaternion, true);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic);

    const arrowHand = renderer.xr.getController(arrowController.userData.id);
    const bowHand = renderer.xr.getController(bowController.userData.id);

    const worldDirection = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position).normalize();
    const drawDistance = Math.min(arrowHand.position.distanceTo(bowHand.position), arrowTemplate.userData.length);
    const drawRatio = drawDistance / arrowTemplate.userData.length;
    const maxSpeed = 30;
    const speed = drawRatio * maxSpeed;

    body.setLinvel(worldDirection.multiplyScalar(speed), true);

    firedArrows.push(arrowObject);

    if (firedArrows.length % 3 === 0) {
        gameState = GameState.INSPECTING;
        console.log("Entering INSPECTING state.");
    }

    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) {
        // Remove physics bodies associated with the target
        target.userData.ringBodies.forEach(body => world.removeRigidBody(body));
        scene.remove(target);
    }
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
    if (scoreboard) scoreboard.reset();
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

    if (world) world.step(eventQueue);

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;

        const collider1 = world.getCollider(handle1);
        const collider2 = world.getCollider(handle2);

        let arrow, otherCollider;
        if (collider1?.userData?.type === 'arrow') {
            arrow = collider1.userData.arrow;
            otherCollider = collider2;
        } else if (collider2?.userData?.type === 'arrow') {
            arrow = collider2.userData.arrow;
            otherCollider = collider1;
        } else {
            return;
        }

        if (arrow.hasScored) return;

        if (otherCollider?.userData?.type === 'target') {
            arrow.hasScored = true;
            const scoreValue = colliderToScoreMap.get(otherCollider.handle);
            arrow.score = scoreValue;
            console.log(`Arrow hit target for score: ${arrow.score}`);

            // To make arrow "stick," remove its physics body and parent it to the target
            if (arrow.body) {
                // 1. Get current world transform of the arrow
                const worldPos = arrow.mesh.position.clone();
                const worldQuat = arrow.mesh.quaternion.clone();

                // 2. Attach to target and set local transform
                target.attach(arrow.mesh);

                // This maintains the arrow's visual position and orientation relative to the target
                arrow.mesh.position.copy(worldPos);
                arrow.mesh.quaternion.copy(worldQuat);

                // 3. Remove physics body
                world.removeRigidBody(arrow.body);
                arrow.body = null;
            }

        } else if (otherCollider?.userData?.type === 'floor') {
            arrow.hasScored = true;
            arrow.score = 'M'; // Miss
            console.log('Arrow hit floor. Miss.');
             // Make arrow stick to floor
            if (arrow.body) {
                arrow.body.setBodyType(RAPIER.RigidBodyType.Fixed);
            }
        }
    });

    // Sync target visual mesh with its physics body
    if (target && target.userData.ringBodies.length > 0) {
        target.position.copy(target.userData.ringBodies[0].translation());
        target.quaternion.copy(target.userData.ringBodies[0].rotation());
    }

    // State machine for game flow
    if (gameState === GameState.INSPECTING) {
        if (target && !target.userData.inScoringPosition) {
            target.userData.inScoringPosition = true;
            target.userData.ringBodies.forEach(body => {
                body.setNextKinematicTranslation(target.userData.scoringPosition, true);
            });
        }
    }

    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                // Grip button for holding the bow
                if (controller.gamepad.buttons[1].pressed) {
                    if (!bowController) bowController = controller;
                } else {
                    if (bowController === controller) bowController = null;
                }

                // 'A' button (or equivalent) for scoring
                if (gameState === GameState.INSPECTING && controller.gamepad.buttons[4] && controller.gamepad.buttons[4].pressed) {
                    if (!aButtonPressed[i]) {
                        aButtonPressed[i] = true;
                        gameState = GameState.ROUND_OVER;
                        console.log("Entering ROUND_OVER state, processing scores.");
                    }
                } else {
                    aButtonPressed[i] = false;
                }
            }
        }
    }

    // Process the round end and immediately transition back to shooting
    if (gameState === GameState.ROUND_OVER) {
        processEnd();
        gameState = GameState.SHOOTING;
        console.log("Returning to SHOOTING state.");
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
        const { forward: localForward, nock: localNock, length: arrowLength } = arrowTemplate.userData;

        // 1. Calculate the direction from the drawing hand to the bow hand.
        const worldDirection = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position);
        const drawDistance = worldDirection.length();
        worldDirection.normalize();

        // 2. Create the rotation to align the arrow model with this world direction.
        const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, worldDirection);
        mesh.quaternion.copy(rotation);

        // 3. Calculate the offset from the model's origin to its nock, in world space.
        const rotatedNockOffset = localNock.clone().applyQuaternion(rotation);

        // 4. Calculate the clamped position for the nock.
        const clampedDrawDistance = Math.min(drawDistance, arrowLength);
        const clampedNockPosition = new THREE.Vector3().copy(bowHand.position).sub(worldDirection.clone().multiplyScalar(clampedDrawDistance));

        // 5. Set the arrow's final position.
        mesh.position.copy(clampedNockPosition).sub(rotatedNockOffset);

        // 6. Update the physics body.
        arrowBody.setNextKinematicTranslation(mesh.position);
        arrowBody.setNextKinematicRotation(mesh.quaternion);

        // Store the clamped nock position for the bowstring visual.
        arrowObject.nockPosition = clampedNockPosition;

    } else if (arrowObject) {
        arrowObject.nockPosition = null;
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

        if (arrowController && arrowObject && arrowObject.nockPosition) {
            const nockPosition = arrowObject.nockPosition;
            positions[0] = topPointWorld.x; positions[1] = topPointWorld.y; positions[2] = topPointWorld.z;
            positions[3] = nockPosition.x; positions[4] = nockPosition.y; positions[5] = nockPosition.z;
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

function processEnd() {
    const roundSize = 3;
    if (firedArrows.length < roundSize) {
        return;
    }

    const arrowsToScore = firedArrows.slice(-roundSize);

    const scores = arrowsToScore.map(arrow => arrow.score || 'M');
    const scoreValueForSort = (s) => {
        if (s === 'X') return 11;
        if (s === 'M') return 0;
        return parseInt(s, 10);
    };
    scores.sort((a, b) => scoreValueForSort(b) - scoreValueForSort(a));

    scoreboard.updateScores(scores);

    arrowsToScore.forEach(obj => {
        if (obj.mesh) obj.mesh.removeFromParent();
        if (obj.body) {
            try { world.removeRigidBody(obj.body); } catch (e) {}
        }
    });

    firedArrows.splice(-roundSize);

    if (target) {
        target.userData.inScoringPosition = false;
        target.userData.ringBodies.forEach(body => {
            body.setNextKinematicTranslation(target.userData.originalPosition, true);
        });
    }

    if (scoreboard.scores.length >= 6) {
        console.log("Full game finished. Ready for a new one.");
        scoreboard.reset();
    }
}

init();