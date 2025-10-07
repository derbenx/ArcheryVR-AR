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
let eventQueue;

// --- Game Objects ---
let bow, target, bowstring;
let arrowTemplate;
let arrowObject = null;
let firedArrows = [];

// --- Scoreboard ---
let score = 0;
let scoreboard;
let scoreCanvas, scoreContext, scoreTexture;
let colliderToScoreMap;

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
    eventQueue = new RAPIER.EventQueue(true);
    colliderToScoreMap = new Map();

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

function createScoreboard() {
    scoreCanvas = document.createElement('canvas');
    scoreCanvas.width = 256;
    scoreCanvas.height = 128;
    scoreContext = scoreCanvas.getContext('2d');

    scoreTexture = new THREE.CanvasTexture(scoreCanvas);

    const material = new THREE.SpriteMaterial({ map: scoreTexture });
    scoreboard = new THREE.Sprite(material);
    scoreboard.scale.set(1.0, 0.5, 1.0);

    updateScore(0);
}

function updateScore(newScore) {
    score = newScore;
    scoreContext.clearRect(0, 0, scoreCanvas.width, scoreCanvas.height);
    scoreContext.fillStyle = 'rgba(0, 0, 0, 0.5)';
    scoreContext.fillRect(0, 0, scoreCanvas.width, scoreCanvas.height);
    scoreContext.fillStyle = 'white';
    scoreContext.font = '48px sans-serif';
    scoreContext.textAlign = 'center';
    scoreContext.textBaseline = 'middle';
    scoreContext.fillText(`Score: ${score}`, scoreCanvas.width / 2, scoreCanvas.height / 2);
    scoreTexture.needsUpdate = true;
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
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.02, 0.02, arrowTemplate.userData.length / 2)
                .setMass(0.1)
                .setCollisionGroups((1 << 0) | (1 << 2)) // Arrow collides with Target and Floor
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            const collider = world.createCollider(colliderDesc, body);

            const newArrow = { mesh: newArrowMesh, body: body, hasScored: false };
            collider.userData = { type: 'arrow', arrow: newArrow };
            arrowObject = newArrow;
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
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setCollisionGroups((1 << 2) | (1 << 0));
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

    if (!scoreboard) {
        createScoreboard();
        scene.add(scoreboard);
    }
    scoreboard.position.set(target.position.x, target.position.y + 1.2, target.position.z);

    target.children.forEach(ring => {
        const ringBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
            target.position.x, target.position.y, target.position.z
        ).setRotation(target.quaternion);
        const ringBody = world.createRigidBody(ringBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.trimesh(
            ring.geometry.attributes.position.array,
            ring.geometry.index.array
        )
        .setCollisionGroups((1 << 1) | (1 << 0))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const collider = world.createCollider(colliderDesc, ringBody);

        let scoreValue = parseInt(ring.name);
        if (scoreValue === 11) scoreValue = 10;
        colliderToScoreMap.set(collider.handle, scoreValue);

        collider.userData = { type: 'target', ring: ring };
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

        // Determine the longest axis and assume the tip is at the positive end and nock at the negative end.
        if (arrowSize.x === maxDim) {
            localForward.set(1, 0, 0);
            localNock.set(arrowBox.min.x, center.y, center.z);
        } else if (arrowSize.y === maxDim) {
            localForward.set(0, 1, 0);
            localNock.set(center.x, arrowBox.min.y, center.z);
        } else {
            localForward.set(0, 0, 1);
            localNock.set(center.x, center.y, arrowBox.min.z);
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
    arrowObject = null;
    arrowController = null;
}

function cleanupScene() {
    if (scoreboard) scene.remove(scoreboard);
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
    if (scoreboard) updateScore(0);
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

        let arrow, targetCollider;

        if (collider1?.userData?.type === 'arrow' && collider2?.userData?.type === 'target') {
            arrow = collider1.userData.arrow;
            targetCollider = collider2;
        } else if (collider2?.userData?.type === 'arrow' && collider1?.userData?.type === 'target') {
            arrow = collider2.userData.arrow;
            targetCollider = collider1;
        } else {
            return;
        }

        if (arrow.hasScored) return;
        arrow.hasScored = true;

        const scoreValue = colliderToScoreMap.get(targetCollider.handle);
        if (scoreValue !== undefined) {
            updateScore(score + scoreValue);
        }

        const ring = targetCollider.userData.ring;
        if (ring && arrow.mesh) {
            const inverseMatrix = new THREE.Matrix4().copy(ring.matrixWorld).invert();
            arrow.mesh.applyMatrix4(inverseMatrix);
            ring.add(arrow.mesh);
        }

        if (arrow.body) {
            world.removeRigidBody(arrow.body);
            arrow.body = null;
        }
    });

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

    if (scoreboard) {
        const lookAtPosition = new THREE.Vector3(camera.position.x, scoreboard.position.y, camera.position.z);
        scoreboard.lookAt(lookAtPosition);
    }

    renderer.render(scene, camera);
}

init();