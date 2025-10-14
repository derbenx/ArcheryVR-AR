import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

var myLine;

const OFFSET_DISTANCE = 0.015;
let offsetDirection,LOCAL_LEFT;

/**
 * A class for creating and managing a visual scoreboard in a Three.js scene.
 * The scoreboard is a "dumb" component that only renders game data passed to it.
 * All calculation and state management is handled externally.
 */
class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048; // High-resolution canvas for clarity
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        // Plane geometry is sized to match the new aspect ratio
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(4.2, 0.5);
        this.mesh = new THREE.Mesh(geometry, material);

        this.headers = ["#", "1", "2", "3", "4", "5", "6", "END", "7", "8", "9", "10", "11", "12", "END", "H", "G", "Dozen", "R/T"];

        this.drawEmptyBoard(); // Draw the initial empty board
    }

    /**
     * Draws the static background, grid, and headers for the scoreboard.
     */
    drawEmptyBoard() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Background
        ctx.fillStyle = '#003366';
        ctx.fillRect(0, 0, w, h);

        // Grid and Headers
        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const cellWidth = w / this.headers.length;

        this.headers.forEach((header, i) => {
            const x = i * cellWidth;
            ctx.strokeRect(x, 0, cellWidth, h / 2); // Header boxes
            ctx.fillText(header, x + cellWidth / 2, h * 0.25);
            ctx.strokeRect(x, h / 2, cellWidth, h / 2); // Empty score boxes
        });

        this.texture.needsUpdate = true;
    }

    /**
     * Displays a complete game's data on the scoreboard.
     * @param {object} gameData - An object containing all data for one game.
     * Example: { gameNumber: 1, scores: ['X', '10', ...], end1Total: 55, ... }
     */
    displayGame(gameData) {
        this.drawEmptyBoard(); // Start with a clean slate

        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cellWidth = w / this.headers.length;
        const scoreY = h * 0.75;

        ctx.fillStyle = 'white';
        ctx.font = '48px sans-serif';

        // --- Draw Game Number ---
        ctx.fillText(`#${gameData.gameNumber}`, cellWidth / 2, scoreY);

        // --- Draw Individual Arrow Scores ---
        const getCellIndex = (scoreIndex) => {
            if (scoreIndex < 6) return scoreIndex + 1;      // Scores 0-5  -> Cells 1-6
            if (scoreIndex < 12) return scoreIndex + 2; // Scores 6-11 -> Cells 8-13
            return -1;
        };

        gameData.scores.forEach((score, i) => {
            const cellIndex = getCellIndex(i);
            if (cellIndex !== -1) {
                const x = cellIndex * cellWidth + cellWidth / 2;
                ctx.fillText(score.toString(), x, scoreY);
            }
        });

        // --- Draw Totals ---
        const end1Cell = 7;
        const end2Cell = 14;
        const hCell = 15;
        const gCell = 16;
        const dozenCell = 17;
        const rtCell = 18;

        if (gameData.scores.length >= 6) {
            ctx.fillText(gameData.end1Total.toString(), end1Cell * cellWidth + cellWidth / 2, scoreY);
        }
        if (gameData.scores.length >= 12) {
            ctx.fillText(gameData.end2Total.toString(), end2Cell * cellWidth + cellWidth / 2, scoreY);
            ctx.fillText(gameData.dozenTotal.toString(), dozenCell * cellWidth + cellWidth / 2, scoreY);
            ctx.fillText(gameData.runningTotal.toString(), rtCell * cellWidth + cellWidth / 2, scoreY);
        }

        // Hits and Golds are updated continuously
        ctx.fillText(gameData.hits.toString(), hCell * cellWidth + cellWidth / 2, scoreY);
        ctx.fillText(gameData.golds.toString(), gCell * cellWidth + cellWidth / 2, scoreY);

        this.texture.needsUpdate = true;
    }

    /**
     * Resets the scoreboard to its initial empty state.
     */
    reset() {
        this.drawEmptyBoard();
    }

    getMesh() {
        return this.mesh;
    }
}

/**
 * A class for creating and managing a visual in-VR menu.
 */
class Menu {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 1024;
        this.context = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;

        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(0.5, 1); // Aspect ratio 1:2
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.visible = false; // Initially hidden
    }

    /**
     * Draws the menu options on the canvas.
     * @param {string[]} options - The array of text strings to display.
     * @param {number} highlightedIndex - The index of the option to highlight.
     */
    draw(options, highlightedIndex) {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Background
        ctx.fillStyle = 'rgba(0, 51, 102, 0.8)'; // Semi-transparent blue
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, w, h);


        // Text properties
        ctx.font = 'bold 60px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lineHeight = h / (options.length + 1); // Add padding

        options.forEach((option, i) => {
            const y = lineHeight * (i + 1);

            if (i === highlightedIndex) {
                ctx.fillStyle = '#FFD700'; // Gold for highlighted
            } else {
                ctx.fillStyle = 'white'; // White for others
            }
            ctx.fillText(option, w / 2, y);
        });

        this.texture.needsUpdate = true;
    }

    show() {
        this.mesh.visible = true;
    }

    hide() {
        this.mesh.visible = false;
    }

    getMesh() {
        return this.mesh;
    }
}

class RapierDebugRenderer {
  mesh
  world
  enabled = true

  constructor(scene, world) {
    this.world = world
    this.mesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, vertexColors: true }))
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  update() {
    if (this.enabled) {
      const { vertices, colors } = this.world.debugRender()
      this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      this.mesh.visible = true
    } else {
      this.mesh.visible = false
    }
  }
}

function moveTargetToDistance(distance) {
    if (!target || !target.userData.body) return;

    // Update the stored shooting position
    target.userData.shootingPosition.z = -distance;

    // Immediately move the visual group to the new position
    target.position.copy(target.userData.shootingPosition);

    // Sync the single physics body to the new position
    target.userData.body.setNextKinematicTranslation(target.position, true);
    target.userData.body.setNextKinematicRotation(target.quaternion, true);
}


// --- Three.js and Global Variables ---
let camera, scene, renderer;
let loader;
let planes;
let floorBody = null;

// --- Physics ---
let world;
const gravity = { x: 0.0, y: -9.8, z: 0.0 };

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
let firedArrows = []; // Master list of all arrows shot in the current 12-shot game
let currentRoundArrows = []; // The 3 arrows being processed after a round

// --- Game Data and State ---
let gameHistory = [];
let currentGame = null;
let runningTotal = 0;
let viewingGameIndex = -1; // -1 indicates viewing the current game. 0+ for history.

// --- Menu ---
let menu;
let isMenuOpen = false;
const targetDistances = [1, 6, 9, 15, 20, 25, 30, 40, 50];
let selectedDistanceIndex = 0;

// --- Game State Machine ---
const GameState = {
    SHOOTING: 'shooting',
    PROCESSING_SCORE: 'processing_score',
    INSPECTING: 'inspecting',
    RESETTING: 'resetting'
};
let gameState = GameState.SHOOTING;

// --- Scoreboard ---
let scoreboard;
let eventQueue;
let colliderToScoreMap;

// --- Controller and State ---
let rapierDebugRenderer;
let bowController = null;
let arrowController = null;
let sceneSetupInitiated = false;
let aButtonPressed = [false, false]; // To track 'A' button state for each controller
let joystickMoved = [false, false]; // To prevent rapid-fire history navigation
let button12Pressed = [false, false]; // To track button 12 state for each controller

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
    world.integrationParameters.dt = 1 / 120; // Use a smaller timestep for more accurate physics
    eventQueue = new RAPIER.EventQueue(true);
    colliderToScoreMap = new Map();
    rapierDebugRenderer = new RapierDebugRenderer(scene, world);

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

    // Create and add the menu
    menu = new Menu();
    scene.add(menu.getMesh());


    startNewGame();


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

    // --- Menu Selection ---
    if (isMenuOpen) {
        const newDistance = targetDistances[selectedDistanceIndex];
        moveTargetToDistance(newDistance);
        console.log(`Target distance set to: ${newDistance}m`);

        isMenuOpen = false;
        menu.hide();
        return; // Prevent drawing an arrow
    }


    // If viewing history, snap back to the current game upon drawing an arrow
    if (viewingGameIndex !== -1) {
        viewingGameIndex = -1;
        scoreboard.displayGame(currentGame);
        console.log("Switched back to current game due to drawing arrow.");
    }

    if (bowController && controller !== bowController) {
        // Only allow drawing a new arrow if in SHOOTING state and menu is closed
        if (gameState === GameState.SHOOTING && !arrowObject && !isMenuOpen) {
            if (!arrowTemplate) return;

            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);

            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true);
            const body = world.createRigidBody(arrowBodyDesc);
            const vertices = arrowTemplate.geometry.attributes.position.array;
            const indices = arrowTemplate.geometry.index.array;
            const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
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

 const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
 const points = [new THREE.Vector3(), new THREE.Vector3()];
 const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
 myLine = new THREE.Line(lineGeometry, lineMaterial);
 scene.add(myLine);

    const gltf = await loader.loadAsync('3d/archery.glb');

    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER);
    const floorCollider = world.createCollider(floorColliderDesc, floorBody);
    floorCollider.userData = { type: 'floor' };

    const initialDistance = targetDistances[selectedDistanceIndex];
    target = new THREE.Group();
    target.userData.shootingPosition = target.position.clone();
    target.userData.shootingPosition = target.position.clone();
    target.userData.scoringPosition = new THREE.Vector3(0, target.position.y, -3);
    target.userData.inScoringPosition = false;

    // Create a single, kinematic rigid body for the entire target.
    // It starts at the origin; its position will be set later.
    const targetBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    const targetBody = world.createRigidBody(targetBodyDesc);
    target.userData.body = targetBody; // Store the single body.
    const bodyPosition = new THREE.Vector3().copy(targetBody.translation());


    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) { // Find meshes with numeric names (target rings)
            const visualMesh = child.clone();
            target.add(visualMesh); // Add visual mesh to the target group

            // Ensure the child's world matrix is up-to-date
            visualMesh.updateMatrixWorld(true);

            // Get vertices and indices from the mesh's geometry
            const vertices = visualMesh.geometry.attributes.position.array;
            const indices = visualMesh.geometry.index.array;
            const transformedVertices = new Float32Array(vertices.length);
            const tempVec = new THREE.Vector3();

            // The key is to transform the vertices into the *local space* of the parent rigid body.
            for (let i = 0; i < vertices.length; i += 3) {
                tempVec.set(vertices[i], vertices[i+1], vertices[i+2]);
                // Transform the vertex from the mesh's local space to world space...
                tempVec.applyMatrix4(visualMesh.matrixWorld);
                // ...and then subtract the parent body's world position to get the vertex's local position relative to the body.
                tempVec.sub(bodyPosition);
                transformedVertices[i] = tempVec.x;
                transformedVertices[i+1] = tempVec.y;
                transformedVertices[i+2] = tempVec.z;
            }

            // Create a trimesh collider with the correctly transformed vertices and add it to the single targetBody
            const colliderDesc = RAPIER.ColliderDesc.trimesh(transformedVertices, indices)
                .setCollisionGroups(TARGET_GROUP_FILTER)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

            const collider = world.createCollider(colliderDesc, targetBody);

            // Map the collider to its score value
            let scoreValue = child.name === '11' ? 'X' : child.name;
            colliderToScoreMap.set(collider.handle, scoreValue);
            collider.userData = { type: 'target' };
        }
    });
console.log(target);

    scene.add(target);
    moveTargetToDistance(targetDistances[selectedDistanceIndex]);


    bow = gltf.scene.getObjectByName('bow');
    if (bow) {
        scene.add(bow);
        //bow.geometry.computeBoundingBox();
        const bowBox = bow.geometry.boundingBox;
        //const bowBox = new THREE.Box3().setFromObject(bow);
        const bowSize = bowBox.getSize(new THREE.Vector3());
        const bowCenter = bowBox.getCenter(new THREE.Vector3());

        //const bowCenterX = bowBox.getCenter(new THREE.Vector3()).x;
        const backZ = bowBox.min.z;
        bow.userData.top = new THREE.Vector3(bowCenter.x, bowBox.max.y, backZ);
        bow.userData.bottom = new THREE.Vector3(bowCenter.x, bowBox.min.y, backZ);

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

    const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(bowHand.quaternion);
    const arrowRestPosition = new THREE.Vector3()
            .copy(bowHand.position)
            .add(worldLeftDirection.multiplyScalar(OFFSET_DISTANCE));

    const worldDirection = new THREE.Vector3().subVectors(arrowRestPosition, arrowHand.position).normalize();
    //offsetDirection
    //const drawDistance = Math.min(arrowHand.position.distanceTo(bowHand.position), arrowTemplate.userData.length);
    //const drawRatio = drawDistance / arrowTemplate.userData.length;

        // To ensure the arrow flies straight, get its forward direction from its rotation.
    //const worldDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(mesh.quaternion);

    // The draw distance is still based on the hands for calculating power.
    const drawDistance = arrowHand.position.distanceTo(bowHand.position);
    const drawRatio = Math.min(drawDistance, arrowTemplate.userData.length) / arrowTemplate.userData.length;

    const maxSpeed = 30;
    const speed = drawRatio * maxSpeed;

    body.setLinvel(worldDirection.multiplyScalar(speed), true);

    firedArrows.push(arrowObject);

    // State transition is now handled in the animate loop once all arrows have landed.

    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) {
        // Remove the single physics body associated with the target
        if (target.userData.body) world.removeRigidBody(target.userData.body);
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
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) scene.remove(obj.mesh);
        if (obj.body) world.removeRigidBody(obj.body);
    });

    if (floorBody) world.removeRigidBody(floorBody);

    target = bow = bowstring = arrowTemplate = arrowObject = bowController = arrowController = floorBody = null;

    // Reset game state
    gameHistory = [];
    runningTotal = 0;
    startNewGame();

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

            // To make arrow "stick," remove its physics body and parent it to the target.
            // The `attach` method correctly handles preserving the world transform.
            if (arrow.body) {
                target.attach(arrow.mesh);
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

    // --- Game State Machine ---

    // Check if the current round is over and ready for scoring
    if (gameState === GameState.SHOOTING) {
        const roundSize = 3;
        // Determine the start index of the arrows for the current round
        const currentRoundStartIndex = currentGame.scores.length;
        const expectedArrowCount = currentRoundStartIndex + roundSize;

        // Only proceed if enough arrows for the current round have been fired
        if (firedArrows.length >= expectedArrowCount) {
            // Get the specific arrows for this round
            const roundArrows = firedArrows.slice(currentRoundStartIndex, expectedArrowCount);

            // Check if all of them have landed by checking their `hasScored` flag
            const allLanded = roundArrows.every(arrow => arrow.hasScored);

            if (allLanded) {
                gameState = GameState.PROCESSING_SCORE;
                console.log(`Round ${currentGame.scores.length / 3 + 1} complete, all arrows landed. Processing scores.`);
            }
        }
    }

    switch (gameState) {
        case GameState.PROCESSING_SCORE:
            processScores();
            gameState = GameState.INSPECTING;
            console.log("Transitioning to INSPECTING state.");
            break;

        case GameState.INSPECTING:
            if (target && !target.userData.inScoringPosition) {
                target.userData.inScoringPosition = true;
                // Move the visual group first, then sync the physics body to it.
                target.position.copy(target.userData.scoringPosition);
                if (target.userData.body) {
                    target.userData.body.setNextKinematicTranslation(target.position, true);
                    target.userData.body.setNextKinematicRotation(target.quaternion, true);
                }
            }
            break;

        case GameState.RESETTING:
            // This state will be handled by the button press logic below
            break;
    }


    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                // --- Grip button for holding the bow ---
                if (controller.gamepad.buttons[1].pressed) {
                    if (!bowController) bowController = controller;
                } else {
                    if (bowController === controller) bowController = null;
                }

                // --- 'A' button for scoring ---
                if (gameState === GameState.INSPECTING && controller.gamepad.buttons[4] && controller.gamepad.buttons[4].pressed) {
                    if (!aButtonPressed[i]) {
                        aButtonPressed[i] = true;
                        gameState = GameState.RESETTING;
                        console.log("Entering RESETTING state.");
                    }
                } else {
                    aButtonPressed[i] = false;
                }

                // --- Menu Toggle (Button 12) ---
                // This button is often the 'home' or 'system' button on many controllers
                if (controller.gamepad.buttons[12] && controller.gamepad.buttons[12].pressed) {
                    if (!button12Pressed[i]) {
                        button12Pressed[i] = true;
                        isMenuOpen = !isMenuOpen;

                        if (isMenuOpen) {
                            const menuMesh = menu.getMesh();
                            // Position the menu in front of the camera
                            const cameraDirection = new THREE.Vector3();
                            camera.getWorldDirection(cameraDirection);
                            const distance = 1.5;
                            menuMesh.position.copy(camera.position).add(cameraDirection.multiplyScalar(distance));
                            menuMesh.quaternion.copy(camera.quaternion);

                            // Initial draw
                            const distanceOptions = targetDistances.map(d => `${d} meters`);
                            menu.draw(distanceOptions, selectedDistanceIndex);
                            menu.show();
                            console.log("Menu opened.");
                        } else {
                            menu.hide();
                            console.log("Menu closed.");
                        }
                    }
                } else {
                    button12Pressed[i] = false;
                }


                // --- Joystick Navigation (History and Menu) ---
                if (controller.gamepad.axes.length > 3) {
                    const joystickY = controller.gamepad.axes[3]; // Typically the Y-axis of the right stick

                    if (Math.abs(joystickY) > 0.8) {
                        if (!joystickMoved[i]) {
                            joystickMoved[i] = true;
                            const distanceOptions = targetDistances.map(d => `${d} meters`);

                            if (isMenuOpen) {
                                // --- Menu Navigation ---
                                if (joystickY < 0) { // Up
                                    selectedDistanceIndex = Math.max(0, selectedDistanceIndex - 1);
                                } else { // Down
                                    selectedDistanceIndex = Math.min(distanceOptions.length - 1, selectedDistanceIndex + 1);
                                }
                                menu.draw(distanceOptions, selectedDistanceIndex);
                                console.log(`Selected distance index: ${selectedDistanceIndex}`);

                            } else {
                                // --- History Navigation ---
                                if (joystickY < 0) { // Stick moved up
                                    if (viewingGameIndex > -1) {
                                        viewingGameIndex--;
                                    } else if (gameHistory.length > 0) { // Wrap from current to last historical
                                        viewingGameIndex = gameHistory.length - 1;
                                    }
                                } else { // Stick moved down
                                    if (viewingGameIndex < gameHistory.length - 1) {
                                        viewingGameIndex++;
                                    } else if (viewingGameIndex !== -1) { // Wrap from last historical to current
                                        viewingGameIndex = -1;
                                    }
                                }

                                // Update scoreboard to show the selected game
                                if (viewingGameIndex === -1) {
                                    scoreboard.displayGame(currentGame);
                                    console.log("Viewing current game");
                                } else {
                                    scoreboard.displayGame(gameHistory[viewingGameIndex]);
                                    console.log(`Viewing historical game #${gameHistory[viewingGameIndex].gameNumber}`);
                                }
                            }
                        }
                    } else {
                        joystickMoved[i] = false; // Reset flag when stick is centered
                    }
                }
            }
        }
    }

    if (gameState === GameState.RESETTING) {
        cleanupRound();
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


if (bowController) {
  const LINE_LENGTH = 0.05;
    // 1. Get the controller object for the bow hand.
    const bowHand = renderer.xr.getController(bowController.userData.id);

    // 2. Define the "left" direction and the desired line length.
        const offsetDirection = (bowController.userData.id === 0) ? 1 : -1; // Left hand is 0, right is 1
        const LOCAL_LEFT = new THREE.Vector3(offsetDirection, 0, 0);


    // 3. Get the controller's current world position and rotation.
    const controllerPosition = new THREE.Vector3();
    const controllerQuaternion = new THREE.Quaternion();
    bowHand.getWorldPosition(controllerPosition);
    bowHand.getWorldQuaternion(controllerQuaternion);

    // 4. The near point of your line is the controller's position.
    const nearPoint = controllerPosition;

    // 5. Transform the local "left" vector into a world-space direction.
    const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(controllerQuaternion);

    // 6. Calculate the far point.
    const farPoint = new THREE.Vector3()
        .copy(controllerPosition)
        .add(worldLeftDirection.multiplyScalar(LINE_LENGTH));

    // 7. Update the line's geometry with the new points.
    //    (Assuming 'myLine' is the THREE.Line object you created earlier)
    myLine.geometry.attributes.position.setXYZ(0, nearPoint.x, nearPoint.y, nearPoint.z);
    myLine.geometry.attributes.position.setXYZ(1, farPoint.x, farPoint.y, farPoint.z);
    myLine.geometry.attributes.position.needsUpdate = true;
}

    if (arrowController && arrowObject && arrowObject.body && bowController) {
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const arrowBody = arrowObject.body;
        const mesh = arrowObject.mesh;
        const { forward: localForward, nock: localNock, length: arrowLength } = arrowTemplate.userData;
        offsetDirection = (bowController.userData.id === 0) ? 1 : -1; // Left hand is 0, right is 1
        LOCAL_LEFT = new THREE.Vector3(offsetDirection, 0, 0);
        console.log(offsetDirection);

        // 2. Transform the local "left" vector into a world-space direction.





        const worldLeftDirection = LOCAL_LEFT.clone().applyQuaternion(bowHand.quaternion);

        // 3. Calculate the arrow rest position by starting at the bow hand and moving along the new direction.
        const arrowRestPosition = new THREE.Vector3()
            .copy(bowHand.position)
            .add(worldLeftDirection.multiplyScalar(OFFSET_DISTANCE));

        // 2. Calculate the direction from the arrow hand to the arrow rest.
        const directionToRest = new THREE.Vector3().subVectors(arrowRestPosition, arrowHand.position);

        // 3. The actual draw direction is from the arrow rest back towards the arrow hand.
        const drawDirection = directionToRest.clone().negate().normalize();

        // 4. Calculate and clamp the draw distance.
        const drawDistance = directionToRest.length();
        const clampedDrawDistance = Math.min(drawDistance, arrowLength);

        // 5. Calculate the clamped nock position. It's pulled back from the arrow rest along the draw direction.
        const clampedNockPosition = new THREE.Vector3().copy(arrowRestPosition).add(drawDirection.clone().multiplyScalar(clampedDrawDistance));

        // 6. The arrow's rotation is based on pointing from the nock to the rest.
        const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, drawDirection.clone().negate());
        mesh.quaternion.copy(rotation);

        // 7. Calculate the rotated nock offset from the arrow's origin.
        const rotatedNockOffset = localNock.clone().applyQuaternion(rotation);

        // 8. Set the arrow's final position. Its origin is the nock's position minus the offset.
        mesh.position.copy(clampedNockPosition).sub(rotatedNockOffset);

        // 9. Update the physics body to match the visual mesh.
        arrowBody.setNextKinematicTranslation(mesh.position);
        arrowBody.setNextKinematicRotation(mesh.quaternion);

        // 10. The bowstring should connect to the nock's world position.
        arrowObject.nockPosition = clampedNockPosition;

    } else if (arrowObject) {
        arrowObject.nockPosition = null;
    }


    firedArrows.forEach(obj => {
        if (obj.body) {
            // Always update the mesh position from the physics body
            obj.mesh.position.copy(obj.body.translation());

            const velocity = obj.body.linvel();
            const speedSq = velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z;

            // For arrows in flight with significant velocity, align their visual mesh with the velocity vector
            if (obj.body.isDynamic() && speedSq > 0.01 && arrowTemplate) {
                const worldVelocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
                const localForward = arrowTemplate.userData.forward;

                // Create a quaternion that rotates the local forward vector to align with the world velocity
                const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, worldVelocity);
                obj.body.setRotation(rotation, true);
            }
            // Always update the mesh quaternion from the physics body
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

    rapierDebugRenderer.update();
    renderer.render(scene, camera);
}

function processScores() {
    const roundSize = 3;
    const startIndex = currentGame.scores.length;
    if (firedArrows.length < startIndex + roundSize) {
        return;
    }

    // Identify and store the arrows for the current round
    currentRoundArrows = firedArrows.slice(startIndex, startIndex + roundSize);

    const scores = currentRoundArrows.map(arrow => arrow.score || 'M');

    // Sort scores for display (X is highest)
    const scoreValueForSort = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
    scores.sort((a, b) => scoreValueForSort(b) - scoreValueForSort(a));

    // Add new scores to the current game object
    currentGame.scores.push(...scores);

    // Recalculate all totals for the current game
    currentGame = calculateGameTotals(currentGame);

    // Update the scoreboard with the new data
    scoreboard.displayGame(currentGame);
}

function cleanupRound() {
    // Clean up the arrows from the round that was just inspected
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) obj.mesh.removeFromParent();
        if (obj.body) {
            try { world.removeRigidBody(obj.body); } catch (e) {}
            obj.body = null; // Nullify the body to prevent future access
        }
    });
    currentRoundArrows = []; // Clear the temporary array

    // Reset target position
    if (target) {
        target.userData.inScoringPosition = false;
        // Move the visual group first, then sync the physics body to it.
        target.position.copy(target.userData.shootingPosition);
        if (target.userData.body) {
            target.userData.body.setNextKinematicTranslation(target.position, true);
            target.userData.body.setNextKinematicRotation(target.quaternion, true);
        }
    }

    // After 12 arrows are scored, finalize the game
    if (currentGame.scores.length >= 12) {
        console.log("Full 12-shot game finished. Saving to history.");
        gameHistory.push(currentGame);
        runningTotal = currentGame.runningTotal;
        startNewGame();
    }
}

// --- Game Logic ---

function startNewGame() {
    currentGame = {
        gameNumber: gameHistory.length + 1,
        scores: [],
        end1Total: 0,
        end2Total: 0,
        dozenTotal: 0,
        hits: 0,
        golds: 0,
        runningTotal: runningTotal // Carry over the running total
    };
    firedArrows = [];
    currentRoundArrows = [];
    viewingGameIndex = -1; // View the new current game
    scoreboard.displayGame(currentGame);
    console.log(`Starting Game #${currentGame.gameNumber}`);
}

function calculateGameTotals(game) {
    const parseScore = (s) => (s === 'X' ? 10 : (s === 'M' ? 0 : parseInt(s, 10)));
    const scoresNumeric = game.scores.map(parseScore);

    game.end1Total = scoresNumeric.slice(0, 6).reduce((a, b) => a + b, 0);
    game.end2Total = scoresNumeric.slice(6, 12).reduce((a, b) => a + b, 0);
    game.dozenTotal = game.end1Total + game.end2Total;
    game.hits = game.scores.filter(s => s !== 'M').length;
    game.golds = game.scores.filter(s => s === 'X' || s === '10').length;

    // R/T is the sum of previous games' dozen totals plus the current game's dozen total
    game.runningTotal = runningTotal + game.dozenTotal;

    return game;
}


init();