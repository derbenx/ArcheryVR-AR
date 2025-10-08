import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRPlanes } from 'three/addons/webxr/XRPlanes.js';

/**
 * A class for creating and managing a visual scoreboard in a Three.js scene.
 */
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

/**
 * A class for creating and managing an in-game menu.
 */
class Menu {
    constructor(title, options) {
        this.title = title;
        this.options = options;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 1024;
        this.context = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
        const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(0.5, 1);
        this.mesh = new THREE.Mesh(geometry, material);
        this.draw(0);
    }
    draw(selectedIndex) {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const itemHeight = 100;
        const titleHeight = 80;
        const padding = 20;
        ctx.fillStyle = 'rgba(0, 51, 102, 0.9)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, w, h);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 60px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.title, w / 2, titleHeight);
        this.options.forEach((option, i) => {
            const y = titleHeight + padding + (i * itemHeight);
            if (i === selectedIndex) {
                ctx.fillStyle = '#FFFF00';
                ctx.fillRect(padding, y - itemHeight / 2, w - padding * 2, itemHeight);
                ctx.fillStyle = 'black';
                ctx.font = 'bold 50px sans-serif';
            } else {
                ctx.fillStyle = 'white';
                ctx.font = '50px sans-serif';
            }
            ctx.fillText(`${option}m`, w / 2, y + 15);
        });
        this.texture.needsUpdate = true;
    }
    getMesh() { return this.mesh; }
}


let camera, scene, renderer, loader, planes, floorBody = null;
let world, eventQueue, gravity = { x: 0.0, y: -5.0, z: 0.0 };
const GROUP_ARROW = 1, GROUP_TARGET = 2, GROUP_FLOOR = 4;
const ARROW_GROUP_FILTER = (GROUP_ARROW << 16) | (GROUP_TARGET | GROUP_FLOOR);
const TARGET_GROUP_FILTER = (GROUP_TARGET << 16) | GROUP_ARROW;
const FLOOR_GROUP_FILTER = (GROUP_FLOOR << 16) | GROUP_ARROW;
let bow, target, bowstring, arrowTemplate, arrowObject = null;
let firedArrows = [], currentRoundArrows = [];
let gameHistory = [], currentGame = null, runningTotal = 0, viewingGameIndex = -1;
const GameState = { SHOOTING: 'shooting', PROCESSING_SCORE: 'processing_score', INSPECTING: 'inspecting', RESETTING: 'resetting' };
let gameState = GameState.SHOOTING;
let scoreboard, distanceMenu, colliderToScoreMap;
const distanceOptions = [1, 2, 5, 10, 15, 20];
let currentDistanceIndex = 0; // Default to 1m
let isMenuOpen = false;
let bowController = null, arrowController = null, sceneSetupInitiated = false;
let aButtonPressed = [false, false], menuButtonPressed = [false, false], joystickMoved = [false, false];

async function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
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
    scoreboard = new Scoreboard();
    scoreboard.getMesh().position.set(0, 1.6, -2.5);
    scene.add(scoreboard.getMesh());
    distanceMenu = new Menu("Distance", distanceOptions);
    distanceMenu.getMesh().visible = false;
    scene.add(distanceMenu.getMesh());
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
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.userData.id = i;
        scene.add(controller);
        const grip = renderer.xr.getControllerGrip(i);
        const controllerModelFactory = new XRControllerModelFactory();
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
            arrowObject = { mesh: newArrowMesh, body: body, hasScored: false, score: 'M' };
            collider.userData = { type: 'arrow', arrow: arrowObject };
        }
        arrowController = controller;
    }
}

function onSelectEnd(event) { if (arrowController === event.target) shootArrow(); }

async function placeScene(floorY) {
    const gltf = await loader.loadAsync('3d/archery.glb');
    if (floorBody) world.removeRigidBody(floorBody);
    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorY, 0);
    floorBody = world.createRigidBody(floorBodyDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups(FLOOR_GROUP_FILTER);
    world.createCollider(floorColliderDesc, floorBody).userData = { type: 'floor' };
    target = new THREE.Group();
    gltf.scene.traverse(child => { if (child.isMesh && !isNaN(parseInt(child.name))) target.add(child.clone()); });
    const targetBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    const targetBody = world.createRigidBody(targetBodyDesc);
    target.children.forEach(ring => {
        const colliderDesc = RAPIER.ColliderDesc.trimesh(ring.geometry.attributes.position.array, ring.geometry.index.array)
            .setTranslation(ring.position.x, ring.position.y, ring.position.z).setRotation(ring.quaternion)
            .setCollisionGroups(TARGET_GROUP_FILTER).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = world.createCollider(colliderDesc, targetBody);
        let scoreValue = ring.name === '11' ? 'X' : ring.name;
        colliderToScoreMap.set(collider.handle, scoreValue);
        collider.userData = { type: 'target', ringName: ring.name };
    });
    scene.add(target);
    const startDistance = distanceOptions[currentDistanceIndex];
    const startPosition = new THREE.Vector3(0, floorY + 1.2, -startDistance);
    target.position.copy(startPosition);
    targetBody.setTranslation(startPosition, true);
    target.userData.originalPosition = startPosition.clone();
    target.userData.scoringPosition = new THREE.Vector3(0, startPosition.y, -3);
    target.userData.inScoringPosition = false;
    target.userData.ringBodies = [targetBody];
    bow = gltf.scene.getObjectByName('bow');
    if (bow) {
        scene.add(bow);
        bow.geometry.computeBoundingBox();
        const bowBox = bow.geometry.boundingBox;
        const bowSize = new THREE.Vector3();
        bowBox.getSize(bowSize);
        const bowBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        const bowBody = world.createRigidBody(bowBodyDesc);
        const bowColliderDesc = RAPIER.ColliderDesc.cuboid(bowSize.x / 2, bowSize.y / 2, bowSize.z / 2).setMass(0.5);
        world.createCollider(bowColliderDesc, bowBody);
        bow.userData.body = bowBody;
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
    arrowTemplate = gltf.scene.getObjectByName('arrow');
    if (arrowTemplate) {
        arrowTemplate.geometry.computeBoundingBox();
        const arrowBox = arrowTemplate.geometry.boundingBox;
        const arrowSize = new THREE.Vector3();
        arrowBox.getSize(arrowSize);
        const maxDim = Math.max(arrowSize.x, arrowSize.y, arrowSize.z);
        arrowTemplate.userData.length = maxDim;
        const localForward = new THREE.Vector3();
        const localNock = new THREE.Vector3();
        const center = arrowBox.getCenter(new THREE.Vector3());
        if (arrowSize.x === maxDim) { localForward.set(-1, 0, 0); localNock.set(arrowBox.max.x, center.y, center.z); }
        else if (arrowSize.y === maxDim) { localForward.set(0, -1, 0); localNock.set(center.x, arrowBox.max.y, center.z); }
        else { localForward.set(0, 0, -1); localNock.set(center.x, center.y, arrowBox.max.z); }
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
    const speed = drawRatio * 30;
    body.setLinvel(worldDirection.multiplyScalar(speed), true);
    firedArrows.push(arrowObject);
    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (target) { target.userData.ringBodies.forEach(body => world.removeRigidBody(body)); scene.remove(target); }
    if (bow) scene.remove(bow);
    if (bowstring) scene.remove(bowstring);
    if (arrowObject) { if (arrowObject.mesh) scene.remove(arrowObject.mesh); if (arrowObject.body) world.removeRigidBody(arrowObject.body); }
    firedArrows.forEach(obj => { if (obj.mesh) scene.remove(obj.mesh); if (obj.body) world.removeRigidBody(obj.body); });
    currentRoundArrows.forEach(obj => { if (obj.mesh) scene.remove(obj.mesh); if (obj.body) world.removeRigidBody(obj.body); });
    if (floorBody) world.removeRigidBody(floorBody);
    target = bow = bowstring = arrowTemplate = arrowObject = bowController = arrowController = floorBody = null;
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
    const collisionsThisFrame = new Map();
    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return;
        const collider1 = world.getCollider(handle1);
        const collider2 = world.getCollider(handle2);
        let arrow, otherCollider;
        if (collider1?.userData?.type === 'arrow') { arrow = collider1.userData.arrow; otherCollider = collider2; }
        else if (collider2?.userData?.type === 'arrow') { arrow = collider2.userData.arrow; otherCollider = collider1; }
        else { return; }
        if (arrow.hasScored) return;
        if (!collisionsThisFrame.has(arrow)) { collisionsThisFrame.set(arrow, []); }
        collisionsThisFrame.get(arrow).push(otherCollider);
    });
    collisionsThisFrame.forEach((colliders, arrow) => {
        if (arrow.hasScored) return;
        let highestScore = 'M', highestScoreValue = 0, hitObjectNames = [], hitTarget = false, highestScoringRingName = null;
        const scoreValueForSort = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
        colliders.forEach(otherCollider => {
            if (otherCollider?.userData?.type === 'target') {
                hitTarget = true;
                const ringName = otherCollider.userData.ringName || 'unknown';
                hitObjectNames.push(ringName);
                const currentScore = colliderToScoreMap.get(otherCollider.handle);
                const currentScoreValue = scoreValueForSort(currentScore);
                if (currentScoreValue > highestScoreValue) {
                    highestScoreValue = currentScoreValue;
                    highestScore = currentScore;
                    highestScoringRingName = ringName;
                }
            } else if (otherCollider?.userData?.type === 'floor') {
                hitObjectNames.push('floor');
            }
        });
        logHit(hitObjectNames.join(', '), highestScore);
        arrow.score = highestScore;
        arrow.hasScored = true;
        if (hitTarget) {
            if (arrow.body) {
                const ringToAttach = target.children.find(child => child.name === highestScoringRingName);
                if (ringToAttach) { ringToAttach.attach(arrow.mesh); } else { target.attach(arrow.mesh); }
                world.removeRigidBody(arrow.body);
                arrow.body = null;
            }
        } else {
            if (arrow.body) { arrow.body.setBodyType(RAPIER.RigidBodyType.Fixed); }
        }
    });
    if (gameState === GameState.SHOOTING) {
        const roundSize = 3;
        const currentRoundStartIndex = currentGame.scores.length;
        const expectedArrowCount = currentRoundStartIndex + roundSize;
        if (firedArrows.length >= expectedArrowCount) {
            const roundArrows = firedArrows.slice(currentRoundStartIndex, expectedArrowCount);
            const allLanded = roundArrows.every(arrow => arrow.hasScored);
            if (allLanded) { gameState = GameState.PROCESSING_SCORE; }
        }
    }
    switch (gameState) {
        case GameState.PROCESSING_SCORE:
            processScores();
            gameState = GameState.INSPECTING;
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
        case GameState.RESETTING: break;
    }
    if (renderer.xr.isPresenting) {
        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            if (controller && controller.gamepad) {
                const gripPressed = controller.gamepad.buttons[1].pressed;
                if (gripPressed) {
                    if (!bowController && bow && bow.userData.body) {
                        bowController = controller;
                        bow.userData.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
                    }
                } else {
                    if (bowController === controller) {
                        bowController = null;
                        if (bow && bow.userData.body) {
                            bow.userData.body.setBodyType(RAPIER.RigidBodyType.Dynamic);
                        }
                    }
                }
                if (gameState === GameState.INSPECTING && controller.gamepad.buttons[4] && controller.gamepad.buttons[4].pressed) {
                    if (!aButtonPressed[i]) { aButtonPressed[i] = true; gameState = GameState.RESETTING; }
                } else { aButtonPressed[i] = false; }
                const menuButton = controller.gamepad.buttons[3]; // Thumbstick click
                if (menuButton && menuButton.pressed && !menuButtonPressed[i]) {
                    menuButtonPressed[i] = true;
                    isMenuOpen = !isMenuOpen;
                    distanceMenu.getMesh().visible = isMenuOpen;
                    if (isMenuOpen) {
                        const menu = distanceMenu.getMesh();
                        const controllerGrip = renderer.xr.getControllerGrip(bowController ? 1 - bowController.userData.id : 0);
                        menu.position.copy(controllerGrip.position).add(new THREE.Vector3(0, 0.2, -0.5));
                        menu.quaternion.copy(camera.quaternion);
                    } else {
                        moveTargetToDistance(distanceOptions[currentDistanceIndex]);
                    }
                } else if (menuButton && !menuButton.pressed) {
                    menuButtonPressed[i] = false;
                }
                if (isMenuOpen && controller.gamepad.axes.length > 3) {
                    const joystickY = controller.gamepad.axes[3];
                    if (Math.abs(joystickY) > 0.8 && !joystickMoved[i]) {
                        joystickMoved[i] = true;
                        if (joystickY < 0) { currentDistanceIndex = (currentDistanceIndex - 1 + distanceOptions.length) % distanceOptions.length; }
                        else { currentDistanceIndex = (currentDistanceIndex + 1) % distanceOptions.length; }
                        distanceMenu.draw(currentDistanceIndex);
                    } else if (Math.abs(joystickY) < 0.2) {
                        joystickMoved[i] = false;
                    }
                }
            }
        }
    }
    if (gameState === GameState.RESETTING) { cleanupRound(); gameState = GameState.SHOOTING; }
    if (bow && bow.userData.body) {
        if (bowController) {
            const controller = renderer.xr.getController(bowController.userData.id);
            const offsetRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            const finalRotation = controller.quaternion.clone().multiply(offsetRotation);
            bow.position.copy(controller.position);
            bow.quaternion.copy(finalRotation);
            bow.userData.body.setNextKinematicTranslation(controller.position, true);
            bow.userData.body.setNextKinematicRotation(finalRotation, true);
        } else {
            bow.position.copy(bow.userData.body.translation());
            bow.quaternion.copy(bow.userData.body.rotation());
        }
    }
    if (arrowController && arrowObject && arrowObject.body && bowController) {
        const arrowHand = renderer.xr.getController(arrowController.userData.id);
        const bowHand = renderer.xr.getController(bowController.userData.id);
        const { mesh, body } = arrowObject;
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
        body.setNextKinematicTranslation(mesh.position);
        body.setNextKinematicRotation(mesh.quaternion);
        arrowObject.nockPosition = clampedNockPosition;
    } else if (arrowObject) { arrowObject.nockPosition = null; }
    firedArrows.forEach(obj => {
        if (obj.body && obj.body.isDynamic()) {
            obj.mesh.position.copy(obj.body.translation());
            const velocity = obj.body.linvel();
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
            if (speed > 0.1) {
                const forward = arrowTemplate.userData.forward.clone();
                const velocityDirection = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
                const rotation = new THREE.Quaternion().setFromUnitVectors(forward, velocityDirection);
                obj.mesh.quaternion.copy(rotation);
                obj.body.setRotation(rotation, true);
            } else {
                obj.mesh.quaternion.copy(obj.body.rotation());
            }
        } else if (obj.body) {
            obj.mesh.position.copy(obj.body.translation());
            obj.mesh.quaternion.copy(obj.body.rotation());
        }
    });
    if (bow && bowstring) {
        const positions = bowstring.geometry.attributes.position.array;
        const topPointWorld = bow.userData.top.clone().applyMatrix4(bow.matrixWorld);
        const bottomPointWorld = bow.userData.bottom.clone().applyMatrix4(bow.matrixWorld);
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
    if (firedArrows.length < startIndex + roundSize) return;
    currentRoundArrows = firedArrows.slice(startIndex, startIndex + roundSize);
    const scores = currentRoundArrows.map(arrow => arrow.score || 'M');
    const scoreValueForSort = (s) => (s === 'X' ? 11 : (s === 'M' ? 0 : parseInt(s, 10)));
    scores.sort((a, b) => scoreValueForSort(b) - scoreValueForSort(a));
    currentGame.scores.push(...scores);
    currentGame = calculateGameTotals(currentGame);
    scoreboard.displayGame(currentGame);
}

function cleanupRound() {
    currentRoundArrows.forEach(obj => {
        if (obj.mesh) obj.mesh.removeFromParent();
        if (obj.body) { try { world.removeRigidBody(obj.body); } catch (e) {} obj.body = null; }
    });
    currentRoundArrows = [];
    if (target) {
        target.userData.inScoringPosition = false;
        target.position.copy(target.userData.originalPosition);
        target.userData.ringBodies.forEach(body => {
            body.setNextKinematicTranslation(target.position, true);
            body.setNextKinematicRotation(target.quaternion, true);
        });
    }
    if (currentGame.scores.length >= 12) {
        gameHistory.push(currentGame);
        runningTotal = currentGame.runningTotal;
        startNewGame();
    }
}

function moveTargetToDistance(distance) {
    if (!target || !target.userData.originalPosition) return;
    const newStartPosition = new THREE.Vector3(0, target.userData.originalPosition.y, -distance);
    target.userData.originalPosition.copy(newStartPosition);
    target.userData.scoringPosition.set(0, newStartPosition.y, -3);
    target.position.copy(newStartPosition);
    target.userData.ringBodies.forEach(body => {
        body.setNextKinematicTranslation(newStartPosition, true);
    });
    target.userData.inScoringPosition = false;
}

function logHit(hitObjectName, assignedScore) {
    const data = new FormData();
    data.append('hit', hitObjectName);
    data.append('score', assignedScore);
    fetch('savelog.php', { method: 'POST', body: data })
        .then(response => response.text())
        .then(text => console.log('Log response:', text))
        .catch(error => console.error('Error logging hit:', error));
}

function startNewGame() {
    currentGame = {
        gameNumber: gameHistory.length + 1,
        scores: [], end1Total: 0, end2Total: 0, dozenTotal: 0,
        hits: 0, golds: 0, runningTotal: runningTotal
    };
    firedArrows = [];
    currentRoundArrows = [];
    viewingGameIndex = -1;
    scoreboard.displayGame(currentGame);
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