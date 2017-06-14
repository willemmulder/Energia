// TODO: this file should require Babylon and Pixi.
// The main file should really not be bothered what rendering engine we are using

// =====
// Main variables
// =====

// TODO: move rendering/userInputOutput stuff into separate file

var game = (function(){

    var lastUsedEntityId = 0;

    return {
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
        previewNextEntityId() {
            return lastUsedEntityId+1;
        },
        createEntityId() {
            lastUsedEntityId++;
            return lastUsedEntityId;
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
            startGameLoop(); // Positions, actions. TODO: sync with 3D rendering? using getAnimationFrame() ?
            startRenderLoop(); // Go!
            this.initialized = true;
        },
        tick : function() {
            maintTick();
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
    
})();

var Entity = function(x,y,type,status,player) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.status = status;
    this.player = player;
}

var actions = {
	selectEntities : function(entityIds) {
        // TODO: use this!
	},
	deselectEntities : function(entitiesById) {
        var deselectedEntities = [];
        var remainingSelectedEntities = [];
        if (!entitiesById) {
            // Deselect all
            deselectedEntities = game.state.selectedEntities;
            remainingSelectedEntities = [];
        } else {
            // Deselect specific entities
            deselectedEntities = entitiesById;
            for(var index in game.state.selectedEntities) {
                var selectedEntity = game.state.selectedEntities[index];
                if (!deselectedEntities[selectedEntity.id]) {
                    remainingSelectedEntities.push(selectedEntity);
                }
            }
        }
        game.state.selectedEntities = remainingSelectedEntities;
        renderer3D.deselectEntities(deselectedEntities);
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
// Everything that changes the game state: entity interaction, physics, energy distribution etc
// =====

var mainGameLoop = (function() {

    var lastTickTime;

    function start() {
        lastTickTime = window.performance.now();
        // Keep in sync with the animation TOOD: check how we can ensure that 3D rendering happens AFTER the mainGameLoop requestAnimationFrame function
        window.requestAnimationFrame(processGameState);
        function processGameState() {
            window.requestAnimationFrame(processGameState);
            tick();
        }
    }

    function tick() {
        var currentTickTime = window.performance.now();
        var timeDiff = currentTickTime - lastTickTime;
        // Set positions
        for(var entityId in game.state.entities) {
            var entity = game.state.entities[entityId];
            // See if entity needs to move
            if (entity.targetPositions.length) {
                var targetPosition = entity.targetPositions[0];
                var targetMovementVector = targetPosition.subtract(entity.position);
                var velocity = entity.maxVelocity;
                var movement = velocity * (timeDiff / 1000);
                var movementVector = targetMovementVector.clone().normalize().scale(movement);
                entity.position.addInPlace(movementVector);
                if (movementVector.length() > targetMovementVector.length()) {
                    // Entity is overshooting its target destination
                    entity.position = targetPosition;
                    entity.targetPositions = [];
                }
            }
            entity.mesh.position = entity.position;
        }
        // Store time
        lastTickTime = currentTickTime;
    }

    return { 
        start : start
    };

})();

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

    function init(pixiParam, scene2D) {
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
                        hideEntities(entityPlacementMeshTemplates);
                        var mesh = rendererGeneralState.newEntityPlacement.entity.clone("entity " + game.previewNextEntityId() );
                        var targetPosition = rendererGeneralState.newEntityPlacement.entity.position;
                        createEntity(mesh, targetPosition);
                        rendererGeneralState.newEntityPlacement.entity.visibility = false;
                        rendererGeneralState.newEntityPlacement.entity = null;
                        rendererGeneralState.newEntityPlacement.placementInProgress = false;
                    } 
                    // If the user was not placing anything, he is selecting something
                    else if (isLeftClick) {
                        actions.deselectEntities(game.state.entities);
                        if (!eventState.isMovedWhileDown) {
                            // Single selection
                            var selectedEntity = renderer3D.getEntityAtPosition2D(x,y);
                            if (selectedEntity) {
                                game.state.selectedEntities = [selectedEntity];
                                renderer3D.selectEntities(); 
                            }
                        } else {
                            // Multi selection
                            game.state.selectedEntities = renderer3D.getEntitiesBetweenPositions2D(
                                eventState.lastDownPoint.x, 
                                eventState.lastDownPoint.y, 
                                eventState.currentPoint.x, 
                                eventState.currentPoint.y, 
                                game.state.entities
                            );
                            renderer3D.selectEntities();
                        }
                    }
                } else
                // If the user right-clicked while having a selection, he wants to move the selection
                if (isRightClick && game.state.selectedEntities.length) {
                    var targetPos = renderer3D.getFloorPositionAtPosition2D(x,y);
                    if (targetPos) {
                        console.log(targetPos);
                        for (var index in game.state.selectedEntities) {
                            var unit = game.state.selectedEntities[index];
                            targetPos.y = unit.position.y;
                            unit.targetPositions = [targetPos]; // TODO: ensure that these positions are not in babylon specific notations
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

        // ==
        // Helper functions for rendering
        // ==

        function drawSelectionSquare() {
            // Draw directly on the main graphics
            graphics2D.lineStyle(2, 0x00FF00, 1);
            graphics2D.drawRect(eventState.lastDownPoint.x, eventState.lastDownPoint.y, (eventState.currentPoint.x - eventState.lastDownPoint.x), (eventState.currentPoint.y - eventState.lastDownPoint.y));
        }

        function drawSidebar() {
            sidebarElements.fps.text = "3D: " + Math.round(babylon.fps) + " fps";
        }
    }

    function startRenderloop() {
        window.requestAnimationFrame(pixiAnimate);
        function pixiAnimate() {
            window.requestAnimationFrame(pixiAnimate);
            render(); // TODO: enable
        }
    }

    return {
        init : init,
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

    var materials = {};
    var meshTemplates = {};
    var entityPlacementMeshTemplates = {};
    var ground;

    var shadowGenerator;

    function init(babylonParam, scene3D) {
        babylon = babylonParam;
        scene = scene3D;
        var lights = createLights(scene);
        materials = createMaterials(scene);

        window.camera = new BABYLON.FreeCamera("Camera", new BABYLON.Vector3(0, 400, -200), scene);
        camera.rotation.y = 0; // look straigt forward
        camera.rotation.x = 0.3 * Math.PI; // look slight down
        
        // =====
        // Shadow
        // =====

        shadowGenerator = new BABYLON.ShadowGenerator(2048, lights.sun);
        shadowGenerator.useVarianceShadowMap = true;

        // =====
        // Meshes
        // =====

        // Templates
        var unitTemplate;
        meshTemplates.unit = unitTemplate = BABYLON.Mesh.CreateBox("UnitTemplate", 10, scene);
        unitTemplate.material = unitTemplate.originalMaterial = materials.yellowMaterial;
        unitTemplate.visibility = false;
        unitTemplate.selectable = false;

        var mainBuildingTemplate;
        meshTemplates.mainBuilding = mainBuildingTemplate = BABYLON.Mesh.CreateBox("MainBuildingTemplate", 20, scene);
        mainBuildingTemplate.material = mainBuildingTemplate.originalMaterial = materials.yellowMaterial;
        mainBuildingTemplate.visibility = false;
        mainBuildingTemplate.selectable = false;

        var selectionRingTemplate;
        meshTemplates.selectionRing = selectionRingTemplate = BABYLON.Mesh.CreateDisc('SelectionRing', 15, 32, scene);
        selectionRingTemplate.material = materials.selectionRingMaterial;;
        selectionRingTemplate.position.y = 0.1;
        selectionRingTemplate.rotation.x = Math.PI / 2;
        selectionRingTemplate.receiveShadows = true;
        selectionRingTemplate.visibility = false;
        selectionRingTemplate.selectable = false;

        entityPlacementMeshTemplates = {};
        entityPlacementMeshTemplates.unit = meshTemplates.unit.clone("placementUnitTemplate");
        entityPlacementMeshTemplates.mainBuilding = meshTemplates.mainBuilding.clone("placementMainBuildingTemplate");

        // Create units
        game.state.entities = [];
        for (var i = 0; i < 10; i++) {
            var mesh = meshTemplates.unit.clone("entity " + game.state.entities.length);
            var position = new BABYLON.Vector3(-i * 50, 5, 0);
            var entity = createEntity(mesh, position);
        }
    
        // Ground
        ground = BABYLON.Mesh.CreateGround("Ground", 1000, 1000, 1, scene, true);
        ground.material = materials.groundMaterial;
        ground.selectable = false;
        ground.receiveShadows = true;
    }

    function render() {
        // Check visibility
        if (game.state.selectedEntities.length) {
            var selectedEntity = game.state.selectedEntities[0];
            // check if selected unit can see other units
            for(var index in game.entities) {
                var targetEntity = game.entities[index];
                if (targetEntity == selectedEntity) {
                    continue;
                }
                var directionVector = targetEntity.position.subtract(selectedEntity.position).normalize();
                var ray = new BABYLON.Ray(selectedEntity.position, directionVector);
                var pickInfo = scene.pickWithRay(ray, function (mesh) { return mesh.entity != null && mesh.entity != selectedEntity; });
                if (pickInfo.hit && pickInfo.pickedMesh == targetEntity.mesh) {
                    // Can see
                    targetEntity.mesh.material = game.materials.yellowMaterial;
                } else {
                    // Can not see
                    targetEntity.mesh.material = game.materials.groundMaterial;
                }
            }
        }
        // Show placeholder for entity placement, if necessary
        if (rendererGeneralState.newEntityPlacement.placementInProgress) {
            hideEntities(game.entityPlacementMeshTemplates);
            var position3D = getFloorPositionAtPosition2D(game.mouseCurrentPosition.x, game.mouseCurrentPosition.y);
            if (position3D) {
                rendererGeneralState.newEntityPlacement.entity.position.x = position3D.x;
                rendererGeneralState.newEntityPlacement.entity.position.z = position3D.z;
                var entityBottomYPosition = getBottomPositionOfMesh(rendererGeneralState.newEntityPlacement.entity).y;
                console.log(entityBottomYPosition);
                if (entityBottomYPosition < 0) {
                   var amountToRaise = -1 * entityBottomYPosition;
                   rendererGeneralState.newEntityPlacement.entity.position.y += amountToRaise;
                }
            }
            rendererGeneralState.newEntityPlacement.entity.visibility = true;
        }
        // Render
        scene.render();
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

    function getEntitiesBetweenPositions2D(startPosX, startPosY, endPosX, endPosY, entitiesToCheck) {
        // Find location in 3D
        var startPick = scene.pick(startPosx, startPosy, function (mesh) { return mesh == ground; });
        var endPick = scene.pick(endPosx, endPosy, function (mesh) { return mesh == ground; });
        if (!startPick.hit || !endPick.hit) {
            return [];
        }
        var startPosOnFloor = startPick.pickedPoint;
        var endPosOnFloor = endPick.pickedPoint;
        // Set selection mesh
        var rubberBandSelectionMesh = new BABYLON.MeshBuilder.CreateBox("rubberBand", { height: 100, width: endPosOnFloor.x - startPosOnFloor.x, depth: endPosOnFloor.z - startPosOnFloor.z, updateable: true }, scene);
        rubberBandSelectionMesh.position = new BABYLON.Vector3(startPosOnFloor.x + (endPosOnFloor.x - startPosOnFloor.x) / 2, 50, startPosOnFloor.z + (endPosOnFloor.z - startPosOnFloor.z) / 2);
        rubberBandSelectionMesh.visibility = false;
        // Check entities
        if (!entitiesToCheck) {
            entitiesToCheck = game.state.entities;
        }
        var selectedEntities = [];
        scene.render(); // TODO: remove?
        for (var entityId in entitiesToCheck) {
            var entity = entitiesToCheck[entityId];
            var mesh = entity.mesh;
            if (rubberBandSelectionMesh.intersectsPoint(mesh.position)) {
                selectedEntities.push(unit);
            }
        }
        return selectedEntities;
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

    function createselectionRingMaterial(scene) {
        var selectTexture = new BABYLON.DynamicTexture("selectTexture", 512, scene, true);
        // draw circle using 2d context
        var context = selectTexture._context;
        var invertY = true;
        var size = selectTexture.getSize();
        var posX = 256;
        var posY = 256;
        var radius = 220;
        context.arc(posX, posY, radius, 0, 2 * Math.PI, false);
        context.fillStyle = 'rgba(255, 255, 255, 0)';
        context.fill();
        context.lineWidth = 30;
        context.strokeStyle = 'rgb(0, 255, 0)';
        context.stroke();
        selectTexture.update(invertY);
        // create and return actual material
        var selectMaterial = new BABYLON.StandardMaterial('selectedBoxMaterial', scene);
        selectMaterial.diffuseTexture = selectTexture;
        selectMaterial.opacityTexture = selectTexture;
        return selectMaterial;
    }

    function createEntity(mesh, position) {
        var entityId = game.createEntityId();
        var entity = {
            id : entityId,
            position : position,
            targetPositions : [], // i.e. waypoints
            maxVelocity : 100, // in 'blocks' per second
            mesh : mesh
        }
        entity.mesh.entity = entity; // circular ref
        entity.mesh.visibility = true;
        entity.mesh.selectable = true;
        shadowGenerator.getShadowMap().renderList.push(entity.mesh);
        game.state.entities[entityId] = entity;
    }

    function deselectMeshes(meshes) {
        for (var index in meshes) {
            meshes[index].material = meshes[index].originalMaterial;
            if (meshes[index].selectionRing) {
                meshes[index].selectionRing.dispose();
            }
        }
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
        getFloorPositionAtPosition2D(x,y) {
            var pickInfo = scene.pick(x, y, function (mesh) { return mesh == ground; });
            if (pickInfo.hit) {
                return pickInfo.pickedPoint;
            }
            return null;
        },
        getUnitsSelectedByRubberBand : function(units) {
            return getUnitsSelectedByRubberBand(units);
        },
        // TODO: make this an event listener onEntitiesSelected() that is called by a central selectEntities(entities) function
        selectEntities() {
            for (var index in game.state.selectedEntities) {
                var mesh = game.state.selectedEntities[index].mesh;
                mesh.selectionRing = meshTemplates.selectionRing.clone("selectionRing");
                mesh.selectionRing.parent = mesh;
                mesh.selectionRing.visibility = true;
            }
        },
        deselectEntities: function(entitiesById) {
            for (var entityId in entitiesById) {
                var mesh = entitiesById[entityId].mesh;
                mesh.material = mesh.originalMaterial;
                if (mesh.selectionRing) {
                    mesh.selectionRing.dispose();
                }
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

function startGameLoop() {
    mainGameLoop.start();
}

function startRenderLoop() {
    renderer2D.startRenderloop();
    renderer3D.startRenderloop();
}

function pauseRenderLoop() {

}



function mainTick() {

}