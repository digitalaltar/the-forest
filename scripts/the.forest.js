//-----------------------
// Imports
//-----------------------

import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { VRButton } from 'VRButton';
import { Reflector } from 'Reflector';
import { GLTFLoader } from 'GLTFLoader';
import { RGBELoader } from 'RGBELoader';

//-----------------------
// Variables
//-----------------------

let scene, camera, cameraRig, renderer;
let wall; // Reference to the wall mesh
let loadedTexture; // Define texture at a higher scope if needed
let clock = new THREE.Clock(); // Clock to manage uniform time updates
let controls, controller1, controller2;
let floorGeometry;
let reflector;

let selectedObject = null; // Global variable to store the selected object
let raycaster = new THREE.Raycaster();
let tempMatrix = new THREE.Matrix4();
let isDragging = false;
let previousMousePosition = {
    x: 0,
    y: 0
};

let hdrEnvironment; // Global variable to store the HDR environment map

let wallMaterial = new THREE.ShaderMaterial({
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D uTexture;
        uniform float time; // Declare time uniform
        varying vec2 vUv;

        void main() {
            // Sample the texture at the original UV coordinate for all channels
            vec4 texColor = texture2D(uTexture, vUv);
            
            // Calculate luminance
            float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
            
            // Add pulsating effect based on time
            float pulse = sin(time) * 0.5 + 0.5;
            
            // Apply glow effect with adjusted intensity to brighten the image
            float glowIntensity = 1.5; // Adjust this value to control the brightness
            vec3 glow = texColor.rgb * (luminance * (1.0 + pulse) * glowIntensity);
            
            // Output final color
            gl_FragColor = vec4(glow, texColor.a);
        }
    `,
    uniforms: {
        uTexture: { type: "t", value: null },
        time: { value: 0.0 }
    },
    transparent: true,
    side: THREE.DoubleSide // Adjusted to DoubleSide for visibility from both sides
});

//-----------------------
// Run It
//-----------------------

init();
addListeners();

//-----------------------
// Main Function
//-----------------------

function init() {
    scene = new THREE.Scene();
    const aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(90, aspectRatio, 0.1, 1000);
    camera.position.set(0, 0, 5); // Adjusted position

    // Create a camera rig, and add the camera to the rig
    cameraRig = new THREE.Group();
    cameraRig.position.set(0, 0, 0);
    cameraRig.add(camera);

    cameraRig.lookAt(new THREE.Vector3(0, 0, 0)); // Adjust as needed based on your scene's layout

    // Then add the cameraRig to the scene instead of the camera
    scene.add(cameraRig);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.gammaOutput = true;
    renderer.gammaFactor = 2.2;
    renderer.setClearColor(new THREE.Color('black')); // Set to a bright color for testing
    document.body.appendChild(renderer.domElement);
    renderer.xr.enabled = true; // Enable WebXR

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('./assets/da.png', function(texture) {
        // Update shader material with the loaded texture
        wallMaterial.uniforms.uTexture.value = texture;
        loadedTexture = texture;

        const imgAspectRatio = loadedTexture.image.width / loadedTexture.image.height;
        const initialGeometry = new THREE.PlaneGeometry(10, 10);

        wall = new THREE.Mesh(initialGeometry, wallMaterial);
        wall.position.set(0, 1, 0); // Adjust the wall's position here
        scene.add(wall);

        floorGeometry = new THREE.PlaneGeometry(10, 10);
        
        reflector = new Reflector(floorGeometry, {
          clipBias: 0.003,
          textureWidth: window.innerWidth * window.devicePixelRatio,
          textureHeight: window.innerHeight * window.devicePixelRatio,
          color: 'gray'
        });
        reflector.position.y = -2.5;
        reflector.rotation.x = -Math.PI / 2;
        scene.add(reflector);

        adjustWallAndFloorGeometry(imgAspectRatio); // Adjust both wall and floor geometry

        // Start the animation loop after everything is set up
        animate();
    });

    addLights();
    loadGLBModel();
    addHdrEnvironment();
    checkVR();
    startControllers();
}

//-----------------------
// Animation Functions
//-----------------------

function animate() {
    renderer.setAnimationLoop(function () {
        update();
        renderer.render(scene, camera);
    });
}

function update() {
    // Update uniforms, controls, or any animations
    wallMaterial.uniforms.time.value = clock.getElapsedTime();
}

//-----------------------
// Floor & Wall Set Up
//-----------------------

function adjustWallAndFloorGeometry(imgAspectRatio) {
    let wallWidth, wallHeight, wallGeometry;

    if (camera.aspect > imgAspectRatio) {
        // Adjust geometry to maintain image aspect ratio
        wallWidth = window.innerWidth;
        wallHeight = wallWidth / imgAspectRatio;
        wallGeometry = new THREE.PlaneGeometry(wallWidth / 100, wallHeight / 100);
    } else {
        wallHeight = window.innerHeight;
        wallWidth = wallHeight * imgAspectRatio;
        wallGeometry = new THREE.PlaneGeometry(wallWidth / 100, wallHeight / 100);
    }

    // Adjust wall geometry
    wallGeometry = new THREE.PlaneGeometry(wallWidth / 100, wallHeight / 100);
    if (wall) {
        wall.geometry.dispose(); // Dispose of the old geometry
        wall.geometry = wallGeometry;
    }

    // Adjust floor geometry to match wall width and a fixed depth
    floorGeometry = new THREE.PlaneGeometry(wallWidth / 100, 10); // Assuming a fixed depth of 10
    if (reflector) {
        reflector.geometry.dispose(); // Dispose of the old geometry
        reflector.geometry = floorGeometry;
    }

    addGradientOverlay(wallWidth / 100, 10); // Assuming 10 is the desired depth for the floor
}

//-----------------------
// Load GLB Model
//-----------------------

function loadGLBModel() {
    const loader = new GLTFLoader();
    loader.load('./assets/the-forest.glb', function(gltf) {
        const model = gltf.scene;

        model.position.set(-1.3, -8, 4); // Adjust this value as needed to position the model correctly
        model.scale.set(8, 8, 8); // Adjust scale as needed
        model.name = 'interactiveModel'; // Assign a name for easy identification

        model.traverse((child) => {
            if (child.isMesh && child.material && hdrEnvironment) {
                // Apply the HDR environment map to each material for reflections
                child.material.envMap = hdrEnvironment;
                child.material.needsUpdate = true;

                // Optional: Adjust material properties for better reflection visuals
                if (child.material.type === 'MeshStandardMaterial' || child.material.type === 'MeshPhysicalMaterial') {
                    child.material.metalness = 0.5; // Adjust as needed
                    child.material.roughness = 0.1; // Adjust as needed
                }
            }
        });
        scene.add(model);
    }, undefined, function(error) {
        console.error(error);
    });
}

//-----------------------
// Lighting
//-----------------------

function addHdrEnvironment() {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);
    loader.load('./assets/outdoor.hdr', function(texture) {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        hdrEnvironment = texture; // Store the loaded texture for later use
    });
}

function addLights() {
    // Ambient light for overall scene illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // soft white light
    scene.add(ambientLight);

    // Directional light for sun-like illumination
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(-1, 2, 4); // Position the light
    scene.add(directionalLight);
}

//-----------------------
// Background Set Up
//-----------------------

function createGradientTexture() {
    const size = 512; // Texture size
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'black');

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function addGradientOverlay(width, height) {
    const gradientTexture = createGradientTexture();
    const material = new THREE.MeshBasicMaterial({ 
        map: gradientTexture, 
        transparent: true, 
        side: THREE.DoubleSide 
    });
    const geometry = new THREE.PlaneGeometry(width, height); // Match the size of your reflector
    const plane = new THREE.Mesh(geometry, material);
    plane.position.copy(reflector.position);
    plane.position.y += 0.04; // Slightly above the reflector
    plane.rotation.x = reflector.rotation.x;
    scene.add(plane);
}

//-----------------------
// Event Listeners
//-----------------------

function addListeners() {
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mouseup', onMouseUp, false);
}

//-----------------------
// VR Events
//-----------------------

function checkVR() {
    // Check if WebXR is supported
    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
            if (supported) {
                // WebXR is supported, show the VR button
                document.body.appendChild(VRButton.createButton(renderer));

                // Event listeners for entering and exiting VR
                renderer.xr.addEventListener('sessionstart', startRender);
                renderer.xr.addEventListener('sessionend', endRender);
            } else {
                // WebXR is not supported, handle accordingly
                console.warn("Immersive VR is not supported by your browser");
            }
        });
    } else {
        // WebXR API is not available
        console.warn("WebXR API is not available in your browser.");
    }
}

function startRender() {
    cameraRig.position.set(0, 1.6, 10); // Standard eye height in meters
    cameraRig.rotation.set(0, Math.PI, 0); // Facing a certain direction
    controls.enabled = false;
}

function endRender() {
    controls.enabled = true;
    controls.update();
}

//-----------------------
// Orbital Controls
//-----------------------

function startControllers(){
    // Initialize OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2;
    controls.minPolarAngle = Math.PI / 2;

    // Renderer and scene must already be set up
    controller1 = renderer.xr.getController(0);
    scene.add(controller1);
    controller2 = renderer.xr.getController(1);
    scene.add(controller2);

    setupControllerInteractions();
}

function setupControllerInteractions() {
    // Assuming controller1 is used for interaction
    if (controller1) {
        controller1.addEventListener('selectstart', onSelectStart);
        controller1.addEventListener('selectend', onSelectEnd);
    }

    if (controller2) {
        controller2.addEventListener('selectstart', onSelectStart);
        controller2.addEventListener('selectend', onSelectEnd);
    }
}

//-----------------------
// Move the Model
//-----------------------

function getIntersects(x, y) {
    var rect = renderer.domElement.getBoundingClientRect();
    var pos = {
        x: ((x - rect.left) / rect.width) * 2 - 1,
        y: ((y - rect.top) / rect.height) * -2 + 1
    };
    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pos, camera);
    return raycaster.intersectObjects(scene.children, true);
}

function onSelectStart(event) {
    const controller = event.target;

    // Prepare the raycaster using the controller's current position and orientation
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Check for intersections with interactive objects
    const intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
        const firstIntersectedObject = intersects[0].object;

        // Check if the intersected object is our model
        if (firstIntersectedObject.name === 'interactiveModel') {
            selectedObject = firstIntersectedObject;
            // Here, you could implement logic to allow moving/rotating the model
            // For example, attaching the model to the controller temporarily
        }
    }

    if (selectedObject) {
        controls.enabled = false;
    }
}

function onSelectEnd(event) {
    // Re-enable OrbitControls
    controls.enabled = true;

    // Reset selected object
    selectedObject = null;
}

//-----------------------
// Mouse Movements
//-----------------------

function onMouseDown(event) {
    var intersects = getIntersects(event.clientX, event.clientY);
    if (intersects.length > 0) {
        let intersectedObject = intersects[0].object;

        // Traverse up to find the root object of the GLB model
        while (intersectedObject.parent !== null && intersectedObject.name !== 'interactiveModel') {
            intersectedObject = intersectedObject.parent;
        }

        if (intersectedObject.name === 'interactiveModel') {
            selectedObject = intersectedObject;
            isDragging = true;
            previousMousePosition.x = event.clientX;
            previousMousePosition.y = event.clientY;
        }
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedObject) {
        return;
    }

    var deltaMove = {
        x: event.clientX - previousMousePosition.x,
        y: event.clientY - previousMousePosition.y
    };

    // Example of translating mouse movement to model movement/rotation
    var rotateAngleX = (deltaMove.y * Math.PI) / 180;
    var rotateAngleY = (-deltaMove.x * Math.PI) / 180;
    selectedObject.rotation.x += rotateAngleX;
    selectedObject.rotation.y += rotateAngleY;

    previousMousePosition = {
        x: event.clientX,
        y: event.clientY
    };
}

function onMouseUp(event) {
    isDragging = false;
}

//-----------------------
// Window Resize
//-----------------------

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Check if loadedTexture is defined before accessing its properties
    if (loadedTexture) {
        const imgAspectRatio = loadedTexture.image.width / loadedTexture.image.height;
        adjustWallAndFloorGeometry(imgAspectRatio);
    }
}