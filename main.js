import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048;
        this.canvas.height = 256;
        this.context = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = 16;
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(4.2, 0.5);
        this.mesh = new THREE.Mesh(geometry, material);
        this.headers = ["#", "1", "2", "3", "4", "5", "6", "END", "7", "8", "9", "10", "11", "12", "END", "H", "G", "Dozen", "R/T"];
        this.drawEmptyBoard();
    }
    drawEmptyBoard() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.fillStyle = '#003366';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'white';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cellWidth = w / this.headers.length;
        this.headers.forEach((header, i) => {
            const x = i * cellWidth;
            ctx.strokeRect(x, 0, cellWidth, h / 2);
            ctx.fillText(header, x + cellWidth / 2, h * 0.25);
            ctx.strokeRect(x, h / 2, cellWidth, h / 2);
        });
        this.texture.needsUpdate = true;
    }
    displayGame(gameData) {
        this.drawEmptyBoard();
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cellWidth = w / this.headers.length;
        const scoreY = h * 0.75;
        ctx.fillStyle = 'white';
        ctx.font = '48px sans-serif';
        ctx.fillText(`#${gameData.gameNumber}`, cellWidth / 2, scoreY);
        const getCellIndex = (scoreIndex) => {
            if (scoreIndex < 6) return scoreIndex + 1;
            if (scoreIndex < 12) return scoreIndex + 2;
            return -1;
        };
        gameData.scores.forEach((score, i) => {
            const cellIndex = getCellIndex(i);
            if (cellIndex !== -1) {
                const x = cellIndex * cellWidth + cellWidth / 2;
                ctx.fillText(score.toString(), x, scoreY);
            }
        });
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
        ctx.fillText(gameData.hits.toString(), hCell * cellWidth + cellWidth / 2, scoreY);
        ctx.fillText(gameData.golds.toString(), gCell * cellWidth + cellWidth / 2, scoreY);
        this.texture.needsUpdate = true;
    }
    reset() { this.drawEmptyBoard(); }
    getMesh() { return this.mesh; }
}

let camera, scene, renderer;
let loader;
let planes;
let floorBody = null;
let world;
const gravity = { x: 0.0, y: -5.0, z: 0.0 };
const GROUP_ARROW = 1 << 0, GROUP_TARGET = 1 << 1, GROUP_FLOOR = 1 << 2;
const ARROW_GROUP_FILTER = (GROUP_ARROW << 16) | (GROUP_TARGET | GROUP_FLOOR);
const TARGET_GROUP_FILTER = (GROUP_TARGET << 16) | GROUP_ARROW;
const FLOOR_GROUP_FILTER = (GROUP_FLOOR << 16) | GROUP_ARROW;
let bow, target, bowstring;
let arrowTemplate;
let arrowObject = null;
let firedArrows = [];
let currentRoundArrows = [];
let gameHistory = [];
let currentGame = null;
let runningTotal = 0;
let viewingGameIndex = -1;
const GameState = { SHOOTING: 'shooting', PROCESSING_SCORE: 'processing_score', INSPECTING: 'inspecting', RESETTING: 'resetting' };
let gameState = GameState.SHOOTING;
let scoreboard;
let eventQueue;
let colliderToScoreMap;
let colliderToRawNameMap;
let debugDisplay;
let last3HitsRaw = [];
let debugMaterial;
let bowController = null;
let arrowController = null;
let realFloorDetected = false;
let aButtonPressed = [false, false];
let joystickMoved = [false, false];

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
    colliderToRawNameMap = new Map();
    const arButton = ARButton.createButton(renderer, { requiredFeatures: ['local-floor', 'plane-detection'] });
    document.body.appendChild(arButton);
    planes = new XRPlanes(renderer);
    scene.add(planes);
    setupControllers();
    scoreboard = new Scoreboard();
    const scoreboardMesh = scoreboard.getMesh();
    scoreboardMesh.position.set(0, 1.6, -2.5);
    scene.add(scoreboardMesh);
    createDebugDisplay();
    debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, opacity: 0.5, transparent: true });

    await placeScene(0);

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
        controller.addEventListener('connected', (event) => { controller.gamepad = event.data.gamepad; });
        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
    }
}

function onSelectStart(event) {
    const controller = event.target;
    if (viewingGameIndex !== -1) {
        viewingGameIndex = -1;
        scoreboard.displayGame(currentGame);
        logToServer("Switched back to current game due to drawing arrow.");
    }
    if (bowController && controller !== bowController) {
        if (gameState === GameState.SHOOTING && !arrowObject) {
            if (!arrowTemplate) return;
            const newArrowMesh = arrowTemplate.clone();
            newArrowMesh.visible = true;
            scene.add(newArrowMesh);
            const arrowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
            const body = world.createRigidBody(arrowBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, arrowTemplate.userData.length / 2).setMass(0.1).setCollisionGroups(ARROW_GROUP_FILTER).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const collider = world.createCollider(colliderDesc, body);
            arrowObject = { mesh: newArrowMesh, body: body, hasScored: false, score: 'M', contacts: [] };
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
    if (target) {
        if (target.userData && target.userData.ringBodies) {
            target.userData.ringBodies.forEach(body => world.removeRigidBody(body));
        }
        scene.remove(target);
    }
    if (floorBody) world.removeRigidBody(floorBody);

    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER), floorBody);
    floorCollider.userData = { type: 'floor' };

    target = new THREE.Group();
    scene.add(target);

    const gltf = await loader.loadAsync('3d/archery.glb');
    gltf.scene.traverse(child => {
        if (child.isMesh && !isNaN(parseInt(child.name))) {
            target.add(child.clone());
        }
    });

    const inspectionPos = new THREE.Vector3(0, floorY + 1.2, -3);
    target.position.copy(inspectionPos);
    target.rotation.y = Math.PI;
    target.updateMatrixWorld(); // Ensure world matrix is up-to-date before creating physics bodies

    target.userData.originalPosition = new THREE.Vector3(0, floorY + 1.2, -10);
    target.userData.scoringPosition = inspectionPos;
    target.userData.inScoringPosition = true;
    target.userData.ringBodies = [];

    target.children.forEach(ring => {
        // Get the world position of the ring mesh
        const worldPos = new THREE.Vector3();
        ring.getWorldPosition(worldPos);
        const worldQuat = new THREE.Quaternion();
        ring.getWorldQuaternion(worldQuat);

        // Create the physics body at the correct world position
        const ringBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(worldPos.x, worldPos.y, worldPos.z)
            .setRotation(worldQuat);
        const ringBody = world.createRigidBody(ringBodyDesc);
        target.userData.ringBodies.push(ringBody);

        const vertices = ring.geometry.attributes.position.array;
        const indices = ring.geometry.index.array;
        const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(TARGET_GROUP_FILTER).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = world.createCollider(colliderDesc, ringBody);

        // Create the cyan debug mesh and parent it to the ring
        const debugMesh = new THREE.Mesh(ring.geometry, debugMaterial);
        ring.add(debugMesh);

        let scoreValue = ring.name === '11' ? 'X' : ring.name;
        colliderToScoreMap.set(collider.handle, scoreValue);
        colliderToRawNameMap.set(collider.handle, ring.name);
        collider.userData = { type: 'target' };
    });

    if (!arrowTemplate) {
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

    if (!bow) {
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
    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) {
        if(target.userData.ringBodies) target.userData.ringBodies.forEach(body => world.removeRigidBody(body));
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
    gameHistory = [];
    runningTotal = 0;
    startNewGame();
    realFloorDetected = false;
}

function animate(timestamp, frame) {
    if (renderer.xr.isPresenting && !realFloorDetected && frame) {
        if (planes.children.length > 0) {
            let floorY = 0;
            planes.children.forEach(plane => { floorY = Math.min(floorY, plane.position.y); });
            placeScene(floorY);
            realFloorDetected = true;
            planes.visible = false;
            logToServer("Real floor detected. Scene repositioned.");
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
        } else { return; }

        if (otherCollider?.userData?.type === 'target') {
            if (arrow.score === 'M') return;
            const rawName = colliderToRawNameMap.get(otherCollider.handle);
            logToServer(`Arrow Contact: Ring ${rawName}`);
            if (!arrow.contacts.includes(rawName)) {
                arrow.contacts.push(rawName);
            }
            if (!arrow.hasScored) {
                arrow.hasScored = true;
                if (arrow.body) {
                    target.attach(arrow.mesh);
                    world.removeRigidBody(arrow.body);
                    arrow.body = null;
                }
            }
        } else if (otherCollider?.userData?.type === 'floor') {
            if (arrow.hasScored) return;
            arrow.hasScored = true;
            arrow.score = 'M';
            logToServer('Arrow Contact: Floor (Miss)');
            if (arrow.body) {
                arrow.body.setBodyType(RAPIER.RigidBodyType.Fixed);
            }
        }
    });

    if (gameState === GameState.SHOOTING) {
        const roundSize = 3;
        const currentRoundStartIndex = currentGame.scores.length;
        const expectedArrowCount = currentRoundStartIndex + roundSize;
        if (firedArrows.length >= expectedArrowCount) {
            const roundArrows = firedArrows.slice(currentRoundStartIndex, expectedArrowCount);
            const allLanded = roundArrows.every(arrow => arrow.hasScored);
            if (allLanded) {
                gameState = GameState.PROCESSING_SCORE;
                logToServer(`Round ${currentGame.scores.length / 3 + 1} complete, all arrows landed. Processing scores.`);
            }
        }
    }

    switch (gameState) {
        case GameState.PROCESSING_SCORE:
            processScores();
            gameState = GameState.INSPECTING;
            logToServer("Transitioning to INSPECTING state.");
            break;
        case GameState.INSPECTING:
            if (target && !target.userData.inScoringPosition) {
                target.userData.inScoringPosition = true;
                target.position.copy(target.userData.scoringPosition);
                target.userData.ringBodies.forEach(body => {
                    body.setNextKinematicTranslation(target.position, true);
                    body.setNextKinematicRotation(target.quaternion, true);
                });
            }
            break;
        case GameState.RESETTING:
            break;
    }

    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                if (controller.gamepad.buttons[1].pressed) {
                    if (!bowController) bowController = controller;
                } else {
                    if (bowController === controller) bowController = null;
                }
                if (gameState === GameState.INSPECTING && controller.gamepad.buttons[4] && controller.gamepad.buttons[4].pressed) {
                    if (!aButtonPressed[i]) {
                        aButtonPressed[i] = true;
                        gameState = GameState.RESETTING;
                        logToServer("Entering RESETTING state.");
                    }
                } else {
                    aButtonPressed[i] = false;
                }
                if (controller.gamepad.axes.length > 3) {
                    const joystickY = controller.gamepad.axes[3];
                    if (Math.abs(joystickY) > 0.8) {
                        if (!joystickMoved[i]) {
                            joystickMoved[i] = true;
                            if (joystickY < 0) {
                                if (viewingGameIndex > -1) {
                                    viewingGameIndex--;
                                } else if (gameHistory.length > 0) {
                                    viewingGameIndex = gameHistory.length - 1;
                                }
                            } else {
                                if (viewingGameIndex < gameHistory.length - 1) {
                                    viewingGameIndex++;
                                } else if (viewingGameIndex !== -1) {
                                    viewingGameIndex = -1;
                                }
                            }
                            if (viewingGameIndex === -1) {
                                scoreboard.displayGame(currentGame);
                                logToServer("Viewing current game");
                            } else {
                                scoreboard.displayGame(gameHistory[viewingGameIndex]);
                                logToServer(`Viewing historical game #${gameHistory[viewingGameIndex].gameNumber}`);
                            }
                        }
                    } else {
                        joystickMoved[i] = false;
                    }
                }
            }
        }
    }

    if (gameState === GameState.RESETTING) {
        cleanupRound();
        gameState = GameState.SHOOTING;
        logToServer("Returning to SHOOTING state.");
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
        const worldDirection = new THREE.Vector3().subVectors(bowHand.position, arrowHand.position);
        const drawDistance = worldDirection.length();
        worldDirection.normalize();
        const rotation = new THREE.Quaternion().setFromUnitVectors(localForward, worldDirection);
        mesh.quaternion.copy(rotation);
        const rotatedNockOffset = localNock.clone().applyQuaternion(rotation);
        const clampedDrawDistance = Math.min(drawDistance, arrowLength);
        const clampedNockPosition = new THREE.Vector3().copy(bowHand.position).sub(worldDirection.clone().multiplyScalar(clampedDrawDistance));
        mesh.position.copy(clampedNockPosition).sub(rotatedNockOffset);
        arrowBody.setNextKinematicTranslation(mesh.position);
        arrowBody.setNextKinematicRotation(mesh.quaternion);
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

function processScores() {
    const roundSize = 3;
    const startIndex = currentGame.scores.length;
    if (firedArrows.length < startIndex + roundSize) { return; }

    currentRoundArrows = firedArrows.slice(startIndex, startIndex + roundSize);
    logToServer(`Processing arrows. Arrow 1 contacts: [${currentRoundArrows[0].contacts.join(', ')}], Arrow 2 contacts: [${currentRoundArrows[1].contacts.join(', ')}], Arrow 3 contacts: [${currentRoundArrows[2].contacts.join(', ')}]`);

    const finalScores = currentRoundArrows.map(arrow => {
        if (arrow.score === 'M') return 'M';
        if (arrow.contacts.length === 0) return 'M';

        let highestScore = 0;
        arrow.contacts.forEach(contact => {
            const scoreVal = parseInt(contact, 10);
            if (scoreVal > highestScore) {
                highestScore = scoreVal;
            }
        });

        if (highestScore === 11) return 'X';
        if (highestScore === 0) return 'M';
        return highestScore.toString();
    });

    logToServer(`Final scores after line-breaker: ${JSON.stringify(finalScores)}`);
    last3HitsRaw = finalScores;
    updateDebugDisplay();

    const scoreValueForSort = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
    finalScores.sort((a, b) => scoreValueForSort(b) - scoreValueForSort(a));
    logToServer(`Scores after sorting for scoreboard: ${JSON.stringify(finalScores)}`);

    currentGame.scores.push(...finalScores);
    logToServer(`All game scores so far: ${JSON.stringify(currentGame.scores)}`);

    currentGame = calculateGameTotals(currentGame);
    scoreboard.displayGame(currentGame);
}

function cleanupRound() {
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) obj.mesh.removeFromParent();
        if (obj.body) {
            try { world.removeRigidBody(obj.body); } catch (e) {}
            obj.body = null;
        }
    });
    currentRoundArrows = [];
    if (target) {
        target.userData.inScoringPosition = false;
        // For debugging, keep the target at the close position.
        // target.position.copy(target.userData.originalPosition);
        // target.userData.ringBodies.forEach(body => {
        //     body.setNextKinematicTranslation(target.position, true);
        //     body.setNextKinematicRotation(target.quaternion, true);
        // });
    }
    if (currentGame.scores.length >= 12) {
        logToServer("Full 12-shot game finished. Saving to history.");
        gameHistory.push(currentGame);
        runningTotal = currentGame.runningTotal;
        startNewGame();
    }
}

function logToServer(message) {
    fetch('savelog.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ log_data: message }),
    }).catch(error => { console.error('Could not save log to server:', error); });
}

function createDebugDisplay() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const geometry = new THREE.PlaneGeometry(1, 0.25);
    debugDisplay = { canvas, context, texture, mesh: new THREE.Mesh(geometry, material) };
    debugDisplay.mesh.position.set(0, 1.2, -2.5);
    scene.add(debugDisplay.mesh);
    updateDebugDisplay();
}

function updateDebugDisplay() {
    if (!debugDisplay) return;
    const { context, canvas, texture } = debugDisplay;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'lime';
    context.font = 'bold 32px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const text = `Chosen Scores: [${last3HitsRaw.join(', ')}]`;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
}

function startNewGame() {
    currentGame = {
        gameNumber: gameHistory.length + 1,
        scores: [],
        end1Total: 0,
        end2Total: 0,
        dozenTotal: 0,
        hits: 0,
        golds: 0,
        runningTotal: runningTotal
    };
    firedArrows = [];
    currentRoundArrows = [];
    last3HitsRaw = [];
    if (debugDisplay) updateDebugDisplay();
    viewingGameIndex = -1;
    scoreboard.displayGame(currentGame);
    logToServer(`Starting Game #${currentGame.gameNumber}`);
}

function calculateGameTotals(game) {
    const parseScore = (s) => (s === 'X' ? 10 : (s === 'M' ? 0 : parseInt(s, 10)));
    const scoresNumeric = game.scores.map(parseScore);
    game.end1Total = scoresNumeric.slice(0, 6).reduce((a, b) => a + b, 0);
    game.end2Total = scoresNumeric.slice(6, 12).reduce((a, b) => a + b, 0);
    game.dozenTotal = game.end1Total + game.end2Total;
    game.hits = game.scores.filter(s => s !== 'M').length;
    game.golds = game.scores.filter(s => s === 'X' || s === '10').length;
    game.runningTotal = runningTotal + game.dozenTotal;
    return game;
}

init();