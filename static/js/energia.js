// TODO: this file should require Babylon and Pixi.
// The main file should really not be bothered what rendering engine we are using

// =====
// Main variables
// =====

// TODO: move rendering/userInputOutput stuff into separate file

var game = {
    initialized : false,
	started : false,
    paused : false,
    entityTypes : {
        mainBuilding : {
            name : "Main Building",
            description : "Your main building. Construct units here."
        },
        transportUnit : {
            name : "Transporter",
            description : "Small unit used to transport resources and building blocks."
        }
    },
    state : {
        stats : {},
        entities : {}, // one single object (instead of per player) so we can lookup by Id
        selectedEntities : [], // list of entities
        map : {},
        players : {
            neutral : {
                name : "Neutral",
                color : "#dddddd"
            }
        }
    },
    init : function(options) {
        if (this.initialized) {
            console.log("Game already initialized");
            return;
        }
        if (!options.babylon || !options.pixi) {
            console.log("Babylon or Pixi was not provided");
            return;
        }
        if (!options.scene2D || !options.scene3D) {
            console.log("Scene2D or Scene3D was not provided");
            return;
        }
        initGameState();
        init2Drenderer(options.pixi, options.scene2D, options.canvas2D)
        init3Drenderer(options.babylon, options.scene3D, options.canvas3D);
        initEventListeners(options.canvas2D, options.canvas3D);
        disableDefaultRightClickMenu();
        handleWindowResizes();
        startRenderLoop(); // Go!
        this.initialized = true;
	},
    start : function() {
        if (this.started) {
            console.log("Game already started");
            return;
        }
        this.started = true;
        this.paused = false;
    },
	pause : function() {
        this.paused = true;
	},
    resume : function() {
        this.paused = false;
    },
	stop : function() {
        this.started = false;
        this.paused = false;
	}
}

var Entity = function(x,y,type,status,player) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.status = status;
    this.player = player;
}

// TODO: use this!
var actions = {
	selectEntities : function(entityIds) {

	},
	deselectEntities : function(entityIds) {
		var deselectAll = (entityIds ? false : true);
	}
}

var rendererGeneralState = {
    newEntityPlacement : {
        placementInProgress : false,
        entityType : null,
        entity : null,
        desiredPosition : null
    }
}

// =====
// Renderer 2D
// =====

var renderer2D = (function() {

    var pixi;
    var scene;

    var graphics2D;
    var sidebarElements = {};

    var eventState = {
        isDown : false,
        isMovedWhileDown : false,
        lastDownPoint : {
            x : null,
            y : null,
            isLeftClick : false,
            isMiddleClick : false,
            isRightClick : false
        },
        currentPoint : {
            x : null,
            y : null,
        },
        lastUpPoint : {
            x : null,
            y : null
        }
    }

    function initEventListeners() {

        // ==
        // Store specific event handlers
        // ==

        var eventHandlers = {
            onKeyDown : function onKeyDown(evt) {
                var key = String.fromCharCode(evt.keyCode);
                handleKeyDown(key);
                evt.stopPropagation();
                evt.preventDefault();
                return false;
            },
            onPointerDown : function(evt) {
                var isLeftClick = isEventLeftClick(evt);
                var isMiddleClick = isEventMiddleClick(evt);
                var isRightClick = isEventRightClick(evt);
                handlePointerDown(evt.clientX, evt.clientY, isLeftClick, isMiddleClick, isRightClick);
                evt.stopPropagation();
                evt.preventDefault();
                return false;
            },
            onPointerMove : function(evt) {
                handlePointerMove(evt.clientX, evt.clientY);
            },
            onPointerUp : function(evt) {
                var isLeftClick = isEventLeftClick(evt);
                var isMiddleClick = isEventMiddleClick(evt);
                var isRightClick = isEventRightClick(evt);
                handlePointerUp(evt.clientX, evt.clientY, isLeftClick, isMiddleClick, isRightClick);
            }
        }

        document.removeEventListener("keydown", eventHandlers.onKeyDown);
        document.addEventListener("keydown", eventHandlers.onKeyDown, false);
        canvas2D.addEventListener("mousedown", eventHandlers.onPointerDown); // pointerdown is not supported in chrome
        canvas2D.addEventListener("mousemove", eventHandlers.onPointerMove); // pointermove is not supported in chrome
        canvas2D.addEventListener("mouseup", eventHandlers.onPointerUp); // pointerup is not supported in chrome
        
        // ==
        // Generalized event handlers
        // ==

        function handleKeyDown(key) {
            if (key == 'W') {
                camera.cameraDirection.z += 10;
            }
            if (key == 'S') {
                camera.cameraDirection.z -= 10;
            }
            if (key == 'D') {
                camera.cameraDirection.x += 10;
            }
            if (key == 'A') {
                camera.cameraDirection.x -= 10;
            }
        }

        function handleKeyUp(key) {
            // TODO: use combi of keydown and keyup to make scrolling up and down smoother
        }

        function handlePointerDown(x,y,isLeftClick,isMiddleClick,isRightClick) {
            eventState.isDown = true;
            eventState.lastDownPoint = { x: x, y: y, isLeftClick: isLeftClick, isMiddleClick: isMiddleClick, isRightClick: isRightClick };
        }

        function handlePointerMove(x,y) {
            eventState.currentPoint.x = x;
            eventState.currentPoint.y = y;
            if (eventState.isDown) {
                eventState.isMovedWhileDown = true;
            }
        }

        function handlePointerUp(x,y,isLeftClick,isMiddleClick,isRightClick) {
            eventState.isDown = false;
            eventState.isMovedWhileDown = false;
            eventState.lastUpPoint = { x: x, y: y, isLeftClick: isLeftClick, isMiddleClick: isMiddleClick, isRightClick: isRightClick };
            // Check if user clicked a button in the sidebar
            var clickedSprite = getSpriteFromPosition(sidebarElements.buttons, eventState.lastUpPoint);
            if (clickedSprite) {
                if (clickedSprite.clickEventName == "newUnit") {
                    prepareNewEntityPlacement("unit");
                }
                if (clickedSprite.clickEventName == "newMainBuilding") {
                    prepareNewEntityPlacement("mainBuilding");
                }
            } 
            // Else the user clicked somewhere else on the screen
            else {
                if (isLeftClick) {
                    // If there was entity placement in progress, apparently the user wants the entity to be placed here
                    if (rendererGeneralState.newEntityPlacement.placementInProgress) {
                        hideEntities(game.entityPlacementMeshTemplates);
                        var mesh = rendererGeneralState.newEntityPlacement.entity.clone("entity " + game.entities.length);
                        var targetPosition = rendererGeneralState.newEntityPlacement.entity.position;
                        createEntity(mesh, targetPosition);
                        rendererGeneralState.newEntityPlacement.entity.visibility = false;
                        rendererGeneralState.newEntityPlacement.entity = null;
                        rendererGeneralState.newEntityPlacement.placementInProgress = false;
                    } 
                    // If the user was not placing anything, he is selecting something
                    else if (isLeftClick) {
                        deselectAllUnits(game.entities);
                        if (!eventState.isMovedWhileDown) {
                            // Single selection
                            var selectedEntity = renderer3D.getEntityAtPosition2D(x,y);
                            if (selectedEntity) {
                                game.state.selectedEntities = [selectedEntity];
                                renderer3D.selectEntities();
                            }
                        } else {
                            // Multi selection
                            setRubberBand(game.selectionStartPosition, game.selectionEndPosition);
                            game.state.selectedEntities = getUnitsSelectedByRubberBand(scene, game.entities, game.rubberBandSelectionMesh);
                            renderer3D.selectEntities();
                        }
                    }
                } else
                // If the user right-clicked while having a selection, he wants to move the selection
                // TODO: outsource this part!
                if (isRightClick && game.state.selectedEntities.length) {
                    var pickInfo = scene.pick(x, y, function (mesh) { return mesh == game.ground; });
                    if (pickInfo.hit) {
                        var targetPos = pickInfo.pickedPoint;
                        for (var index in game.state.selectedEntities) {
                            var unit = game.state.selectedEntities[index];
                            targetPos.y = unit.position.y;
                            unit.targetPositions = [targetPos];
                        }
                    }
                }
            }
            eventState.lastDownPoint = {};
            eventState.currentPoint = {};
        }

        // =====
        // HELPER FUNCTIONS
        // =====

        // TODO: move this to the renderer3D part!
        function setRubberBand(startPos, endPos) {
            var startPick = scene.pick(startPos.x, startPos.y, function (mesh) { return mesh == game.ground; });
            var endPick = scene.pick(endPos.x, endPos.y, function (mesh) { return mesh == game.ground; });
            if (!startPick.hit || !endPick.hit) {
                return;
            }
            var startPosOnFloor = startPick.pickedPoint;
            var endPosOnFloor = endPick.pickedPoint;
            game.rubberBandSelectionMesh = new BABYLON.MeshBuilder.CreateBox("rubberBand", { height: 100, width: endPosOnFloor.x - startPosOnFloor.x, depth: endPosOnFloor.z - startPosOnFloor.z, updateable: true }, scene);
            game.rubberBandSelectionMesh.position = new BABYLON.Vector3(startPosOnFloor.x + (endPosOnFloor.x - startPosOnFloor.x) / 2, 50, startPosOnFloor.z + (endPosOnFloor.z - startPosOnFloor.z) / 2);
            game.rubberBandSelectionMesh.visibility = false;
        }

        function isEventLeftClick(evt) {
            return evt.button == 0;
        }

        function isEventMiddleClick(evt) {
            return evt.button == 0;
        }

        function isEventRightClick(evt) {
            return evt.button == 2;
        }

        function getSpriteFromPosition(sprites, position) {
            for (var name in sprites) {
                var sprite = sprites[name];
                if (sprite.containsPoint(position)) {
                    return sprite;
                }
            }
            return null;
        }
    }

    function render() {
        // Draw selection graphics
        graphics2D.clear(); // TODO: can we use scene.clear(); ?
        if (eventState.isMovedWhileDown) {
            drawSelectionSquare();
        }
        // Draw sidebar graphics
        drawSidebar();
        // Render
        pixi.render(scene);
    }

    function startRenderloop() {
        window.requestAnimationFrame(pixiAnimate);
        function pixiAnimate() {
            window.requestAnimationFrame(pixiAnimate);
            //render(); // TODO: enable
        }
    }

    function drawSelectionSquare() {
        // Draw directly on the main graphics
        graphics2D.lineStyle(2, 0x00FF00, 1);
        graphics2D.drawRect(startPos.x, startPos.y, (endPos.x - startPos.x), (endPos.y - startPos.y));
    }

    function drawSidebar() {
        sidebarElements.fps.text = "3D: " + Math.round(babylon.fps) + " fps";
    }

    return {
        state : {

        },
        init : function(pixiParam, scene2D) {
            pixi = pixiParam;
            scene = scene2D;
            
            // Create graphics containers
            graphics2D = new PIXI.Graphics();
            graphics2D.fillStyle = 'rgba(0, 0, 0, 1)';
            graphics2D.clear();
            scene.addChild(graphics2D);
            
            // Add sidebar graphics
            var sidebarContainer = new PIXI.Container();
            sidebarContainer.x = 10;
            sidebarContainer.y = 10;
            graphics2D.addChild(sidebarContainer);

            sidebarElements.fps = new PIXI.Text('60', { font: '24px Verdana', fill: '#fff' });
            sidebarContainer.addChild(sidebarElements.fps);
            
            var buttonsContainer = new PIXI.Container();
            buttonsContainer.x = 10;
            buttonsContainer.y = 40;
            sidebarContainer.addChild(buttonsContainer);
            
            sidebarElements.buttons = {};
            sidebarElements.buttons.newUnit = new PIXI.Sprite(PIXI.Texture.fromImage('./static/img/Button_new.png'));
            sidebarElements.buttons.newUnit.y = 0;
            sidebarElements.buttons.newUnit.interactive = true;
            sidebarElements.buttons.newUnit.clickEventName = "newUnit";
            buttonsContainer.addChild(sidebarElements.buttons.newUnit);
            sidebarElements.buttons.newMainBuilding = new PIXI.Sprite(PIXI.Texture.fromImage('./static/img/Button_new.png'));
            sidebarElements.buttons.newUnit.y = 60;
            sidebarElements.buttons.newMainBuilding.interactive = true;
            sidebarElements.buttons.newMainBuilding.clickEventName = "newMainBuilding";
            buttonsContainer.addChild(sidebarElements.buttons.newMainBuilding);
        },
        initEventListeners : initEventListeners,
        startRenderloop : startRenderloop,
        handleWindowResizes : function() {
            window.addEventListener("resize", function () {
                pixi.resize();
            });
        },
        entityAdded : function(id, entity) {

        }, 
        entityRemoved : function(id) {
            
        }
    };
	
})();

// =====
// Renderer 3D
// =====

var renderer3D = (function() {
    	
    var babylon;
    var scene;
    var state = {};

    var meshTemplates = {};

    function init(babylonParam, scene3D) {
        babylon = babylonParam;
        scene = scene3D;
        var lights = createLights(scene);
        game.materials = createMaterials(scene);

        window.camera = new BABYLON.FreeCamera("Camera", new BABYLON.Vector3(0, 400, -200), scene);
        camera.rotation.y = 0; // look straigt forward
        camera.rotation.x = 0.3 * Math.PI; // look slight down
        
        // =====
        // Shadow
        // =====

        game.shadowGenerator = new BABYLON.ShadowGenerator(2048, lights.sun);
        game.shadowGenerator.useVarianceShadowMap = true;

        // =====
        // Meshes
        // =====

        // Templates
        var unitTemplate;
        meshTemplates.unit = unitTemplate = BABYLON.Mesh.CreateBox("UnitTemplate", 10, scene);
        unitTemplate.material = unitTemplate.originalMaterial = game.materials.yellowMaterial;
        unitTemplate.visibility = false;
        unitTemplate.selectable = false;

        var mainBuildingTemplate;
        meshTemplates.mainBuilding = mainBuildingTemplate = BABYLON.Mesh.CreateBox("MainBuildingTemplate", 20, scene);
        mainBuildingTemplate.material = mainBuildingTemplate.originalMaterial = game.materials.yellowMaterial;
        mainBuildingTemplate.visibility = false;
        mainBuildingTemplate.selectable = false;

        var selectionRingTemplate;
        meshTemplates.selectionRing = selectionRingTemplate = BABYLON.Mesh.CreateDisc('SelectionRing', 15, 32, scene);
        selectionRingTemplate.material = game.materials.selectionRingMaterial;;
        selectionRingTemplate.position.y = 0.1;
        selectionRingTemplate.rotation.x = Math.PI / 2;
        selectionRingTemplate.receiveShadows = true;
        selectionRingTemplate.visibility = false;
        selectionRingTemplate.selectable = false;

        game.entityPlacementMeshTemplates = {};
        game.entityPlacementMeshTemplates.unit = meshTemplates.unit.clone("placementUnitTemplate");
        game.entityPlacementMeshTemplates.mainBuilding = meshTemplates.mainBuilding.clone("placementMainBuildingTemplate");

        // Create units
        game.entities = [];
        for (var i = 0; i < 10; i++) {
            var mesh = meshTemplates.unit.clone("entity " + game.entities.length);
            var position = new BABYLON.Vector3(-i * 50, 5, 0);
            var entity = createEntity(mesh, position);
        }
    
        // Ground
        game.ground = BABYLON.Mesh.CreateGround("Ground", 1000, 1000, 1, scene, true);
        game.ground.material = game.materials.groundMaterial;
        game.ground.selectable = false;
        game.ground.receiveShadows = true;
    }

    function render() {
        render3DScene(scene);
    }

    function startRenderloop() {
        babylon.runRenderLoop(function () {
            render();
        });
    }

    function entityAdded(id, entity) {

    }

    function entityRemoved(id) {

    }

    // =====
    // Util functions
    // =====

    function createLights(scene) {
        var lights = {};

        lights.sun = new BABYLON.DirectionalLight("Sun", new BABYLON.Vector3(-1.5, -2, -1), scene);

        lights.atmospheric = new BABYLON.HemisphericLight("atmospheric", new BABYLON.Vector3(-1.5, 2, -1), scene);
        lights.atmospheric.diffuse = new BABYLON.Color3(1, 1, 1);
        lights.atmospheric.specular = new BABYLON.Color3(1, 1, 1);
        lights.atmospheric.groundColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        lights.atmospheric.intensity = 0.4;

        return lights;
    }

    function createMaterials(scene) {
        var materials = {};

        // Selected ring material
        materials.selectionRingMaterial = createselectionRingMaterial(scene);

        // Yellow material
        materials.yellowMaterial = new BABYLON.StandardMaterial("yellow", scene);
        materials.yellowMaterial.diffuseColor = new BABYLON.Color3(1, 1, 0);

        // Ground material
        materials.groundMaterial = new BABYLON.StandardMaterial("ground", scene);
        materials.groundMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);

        return materials;
    }

    return {
    	init : init,
        startRenderloop : startRenderloop,
        handleWindowResizes : function() {
            window.addEventListener("resize", function () {
                babylon.resize();
            });
        },
        entityAdded : entityAdded,
        entityRemoved : entityRemoved,
        getEntityAtPosition2D : function(x,y) {
            var pickInfo = scene.pick(x, y, function (mesh) { return mesh.selectable; });
            if (!pickInfo.hit) {
                return null;
            }
            var currentMesh = pickInfo.pickedMesh;
            return currentMesh.entity;
        },
        // TODO: make this an event listener onEntitiesSelected() that is called by a central selectEntities(entities) function
        selectEntities() {
            for (var index in game.state.selectedEntities) {
                var mesh = game.state.selectedEntities[index].mesh;
                mesh.selectionRing = meshTemplates.selectionRing.clone("selectionRing");
                mesh.selectionRing.parent = mesh;
                mesh.selectionRing.visibility = true;
            }
        }
    };
    
})();

// =====
// Private functions
// =====

function initGameState() {

}

function init2Drenderer(pixi, scene2D, canvas2D) {
    renderer2D.init(pixi, scene2D);
}

function init3Drenderer(babylon, scene3D, canvas3D) {
    renderer3D.init(babylon, scene3D);
}

function initEventListeners() {
    renderer2D.initEventListeners();
}

function disableDefaultRightClickMenu() {
    document.addEventListener("contextmenu", function (evt) { evt.preventDefault(); });
}

function handleWindowResizes() {
    renderer2D.handleWindowResizes();
    renderer3D.handleWindowResizes();
}

function startRenderLoop() {
    renderer2D.startRenderloop();
    renderer3D.startRenderloop();
}

function pauseRenderLoop() {

}