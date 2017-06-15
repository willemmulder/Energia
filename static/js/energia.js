"use strict";

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
        createEntity : function(x, y, z, entityType, player) {
            var entityId = this.createEntityId();
            var entity = new Entity(entityId, x, y, z, entityType, 'OK', 1); // TODO: figure out statuses and players
            game.state.entities[entityId] = entity;
            renderer2D.onEntityAdded(entity);
            renderer3D.onEntityAdded(entity);
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
            init2Drenderer(options.pixi, options.scene2D, options.canvas2D)
            init3Drenderer(options.babylon, options.scene3D, options.canvas3D);
            initGameState();
            initEventListeners(options.canvas2D, options.canvas3D);
            disableDefaultRightClickMenu();
            handleWindowResizes();
            startGameLoop(); // Positions, actions. TODO: sync with 3D rendering? using getAnimationFrame() ?
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
    
})();

class Entity {
    constructor(id,x,y,z,type,status,player) {
        this.id = id;
        this.position = new Position(x,y,z);
        this.energy = 100;
        this.type = type;
        this.status = status;
        this.player = player;
        this.targetPositions = []; // i.e. waypoints
        this.maxVelocity = 100; // in 'blocks' per second
        this.renderer2Dstate = {}; // This can be filled by the renderer2D for anything it likes
        this.renderer3Dstate = {}; // This can be filled by the renderer3D for anything it likes
    }
}

class Position {
    constructor(x,y,z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    // Use Babylon 3DVector implementation. TODO: copy implementation code in here
    add(otherVector) {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).add(new BABYLON.Vector3(otherVector.x, otherVector.y, otherVector.z));
        return new Position(result.x, result.y, result.z);
    }
    addInPlace(otherVector) {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).add(new BABYLON.Vector3(otherVector.x, otherVector.y, otherVector.z));
        this.x = result.x;
        this.y = result.y;
        this.z = result.z;
    }
    subtract(otherVector) {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).subtract(new BABYLON.Vector3(otherVector.x, otherVector.y, otherVector.z));
        return new Position(result.x, result.y, result.z);
    }
    multiply(otherVector) {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).multiply(new BABYLON.Vector3(otherVector.x, otherVector.y, otherVector.z));
        return new Position(result.x, result.y, result.z);
    }
    normalize() {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).normalize();
        return new Position(result.x, result.y, result.z);
    }
    scale(amount) {
        var result = new BABYLON.Vector3(this.x, this.y, this.z).scale(amount);
        return new Position(result.x, result.y, result.z);
    }
    length() {
        return new BABYLON.Vector3(this.x, this.y, this.z).length();
    }
    clone() {
        return new Position(this.x, this.y, this.z);
    }
}

var actions = {
	selectEntities : function(selectedEntities) {
        game.state.selectedEntities = selectedEntities;
        renderer3D.onEntitiesSelected(selectedEntities);
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
        renderer3D.onEntitiesDeselected(deselectedEntities);
	}
}

var rendererGeneralState = {
    newEntityPlacement : {
        placementInProgress : false,
        entityType : null,
        desiredPosition : null
    },
    eventState : {
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
                // Let renderers update their state according to this position update
                renderer2D.onEntityUpdated(entity);
                renderer3D.onEntityUpdated(entity);
            }
            
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
                renderer3D.moveViewPortUp(10);
            }
            if (key == 'S') {
                renderer3D.moveViewPortUp(-10);
            }
            if (key == 'D') {
                renderer3D.moveViewPortRight(10);
            }
            if (key == 'A') {
                renderer3D.moveViewPortRight(-10);
            }
        }

        function handleKeyUp(key) {
            // TODO: use combi of keydown and keyup to make scrolling up and down smoother
        }

        function handlePointerDown(x,y,isLeftClick,isMiddleClick,isRightClick) {
            rendererGeneralState.eventState.isDown = true;
            rendererGeneralState.eventState.lastDownPoint = { x: x, y: y, isLeftClick: isLeftClick, isMiddleClick: isMiddleClick, isRightClick: isRightClick };
        }

        function handlePointerMove(x,y) {
            rendererGeneralState.eventState.currentPoint.x = x;
            rendererGeneralState.eventState.currentPoint.y = y;
            if (rendererGeneralState.eventState.isDown) {
                rendererGeneralState.eventState.isMovedWhileDown = true;
            }
        }

        function handlePointerUp(x,y,isLeftClick,isMiddleClick,isRightClick) {
            rendererGeneralState.eventState.lastUpPoint = { x: x, y: y, isLeftClick: isLeftClick, isMiddleClick: isMiddleClick, isRightClick: isRightClick };
            // Check if user clicked a button in the sidebar
            var clickedSprite = getSpriteFromPosition(sidebarElements.buttons, rendererGeneralState.eventState.lastUpPoint);
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
                        var targetPosition = renderer3D.getFloorPositionAtPosition2D(rendererGeneralState.eventState.currentPoint.x, rendererGeneralState.eventState.currentPoint.y);
                        var player = 1;
                        var meshHeight = renderer3D.getHeightOfPositionedEntity();
                        game.createEntity(targetPosition.x, meshHeight/2, targetPosition.z, rendererGeneralState.newEntityPlacement.entityType, player);
                        rendererGeneralState.newEntityPlacement.placementInProgress = false;
                    } 
                    // If the user was not placing anything, he is selecting something
                    else {
                        actions.deselectEntities(game.state.entities);
                        if (!rendererGeneralState.eventState.isMovedWhileDown) {
                            // Single selection
                            var selectedEntity = renderer3D.getEntityAtPosition2D(x,y);
                            if (selectedEntity) {
                                actions.selectEntities([selectedEntity]);
                            }
                        } else {
                            // Multi selection
                            var entitiesToSelect = renderer3D.getEntitiesBetweenPositions2D(
                                rendererGeneralState.eventState.lastDownPoint.x, 
                                rendererGeneralState.eventState.lastDownPoint.y, 
                                rendererGeneralState.eventState.currentPoint.x, 
                                rendererGeneralState.eventState.currentPoint.y, 
                                game.state.entities
                            );
                            actions.selectEntities(entitiesToSelect);
                        }
                    }
                } else
                // If the user right-clicked while having a selection, he wants to move the selection
                if (isRightClick && game.state.selectedEntities.length) {
                    var targetPos = renderer3D.getFloorPositionAtPosition2D(x,y);
                    if (targetPos) {
                        console.log(game.state.selectedEntities);
                        // TODO: fix issue where somehow two records have the same targetPosition while ordered individually
                        for (var index in game.state.selectedEntities) {
                            console.log('setting!');
                            var entity = game.state.selectedEntities[index];
                            targetPos.y = entity.position.y; // Keep vertical position
                            entity.targetPositions = [targetPos];
                        }
                    }
                }
            }
            rendererGeneralState.eventState.lastDownPoint = {};
            rendererGeneralState.eventState.currentPoint = {};
            rendererGeneralState.eventState.isDown = false;
            rendererGeneralState.eventState.isMovedWhileDown = false;
        }

        // ==
        // Helper functions for eventHandlers
        // ==

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

        function prepareNewEntityPlacement(entityType) {
            rendererGeneralState.newEntityPlacement = {
                placementInProgress : true,
                entityType : entityType,
                desiredPosition : null
            }
        }
    }

    function render() {
        // Draw selection graphics
        graphics2D.clear(); // TODO: can we use scene.clear(); ?
        if (rendererGeneralState.eventState.isMovedWhileDown) {
            drawSelectionSquare();
        }
        // Draw sidebar graphics
        drawSidebar();
        // Draw entity labels
        drawEntityLabels();
        // Render
        pixi.render(scene);

        // ==
        // Helper functions for rendering
        // ==

        function drawSelectionSquare() {
            // Draw directly on the main graphics
            graphics2D.lineStyle(2, 0x00FF00, 1);
            graphics2D.drawRect(rendererGeneralState.eventState.lastDownPoint.x, rendererGeneralState.eventState.lastDownPoint.y, (rendererGeneralState.eventState.currentPoint.x - rendererGeneralState.eventState.lastDownPoint.x), (rendererGeneralState.eventState.currentPoint.y - rendererGeneralState.eventState.lastDownPoint.y));
        }

        function drawSidebar() {
            sidebarElements.fps.text = "3D: " + Math.round(babylon.fps) + " fps";
        }

        function drawEntityLabels() {
            for(var index in game.state.entities) {
                var entity = game.state.entities[index];
                var labelPosition2D = renderer3D.get2DpositionForEntity(entity);
                entity.renderer2Dstate.label.text = entity.energy;
                entity.renderer2Dstate.label.x = labelPosition2D.x-10;
                entity.renderer2Dstate.label.y = labelPosition2D.y-50;
            }
        }
    }

    function startRenderloop() {
        window.requestAnimationFrame(pixiAnimate);
        function pixiAnimate() {
            window.requestAnimationFrame(pixiAnimate);
            render(); // TODO: enable
        }
    }

    // =====
    // Return
    // =====

    return {
        init : init,
        initEventListeners : initEventListeners,
        startRenderloop : startRenderloop,
        handleWindowResizes : function() {
            window.addEventListener("resize", function () {
                pixi.resize();
            });
        },
        onEntityAdded : function(entity) {
            graphics2D.lineStyle(2, 0x00FF00, 1);
            var labelStyle = {
                font : '12px Arial',
                //fill : '#F7EDCA'
            };
            var label = new PIXI.Text(entity.energy, labelStyle);
            entity.renderer2Dstate.label = label;
            graphics2D.addChild(label);
        }, 
        onEntityUpdated : function(updatedEntity) {
            // ...
        },
        onEntityRemoved : function(id) {
            // ...
        }
    };
	
})();

// =====
// Renderer 3D
// =====

var renderer3D = (function() {
    	
    var babylon;
    var scene;
    var camera;
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

        camera = new BABYLON.FreeCamera("Camera", new BABYLON.Vector3(0, 400, -200), scene);
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
            for(var entityId in game.state.entities) {
                var targetEntity = game.state.entities[entityId];
                if (targetEntity == selectedEntity) {
                    continue;
                }
                var directionVector = targetEntity.position.subtract(selectedEntity.position).normalize();
                var ray = new BABYLON.Ray(selectedEntity.position, directionVector);
                var pickInfo = scene.pickWithRay(ray, function (mesh) { return mesh.entity != null && mesh.entity != selectedEntity; });
                if (pickInfo.hit && pickInfo.pickedMesh == targetEntity.renderer3Dstate.mesh) {
                    // Can see
                    // targetEntity.renderer3Dstate.mesh.material = materials.yellowMaterial;
                } else {
                    // Can not see
                    // targetEntity.renderer3Dstate.mesh.material = materials.groundMaterial;
                }
            }
        }
        // Show placeholder for entity placement, if necessary
        hideEntities(entityPlacementMeshTemplates);
        if (rendererGeneralState.newEntityPlacement.placementInProgress) {
            var relevantEntityPlacementMeshTemplate = entityPlacementMeshTemplates[rendererGeneralState.newEntityPlacement.entityType];
            var position3D = getFloorPositionAtPosition2D(rendererGeneralState.eventState.currentPoint.x, rendererGeneralState.eventState.currentPoint.y);
            if (position3D) {
                relevantEntityPlacementMeshTemplate.position.x = position3D.x;
                relevantEntityPlacementMeshTemplate.position.z = position3D.z;
                var entityBottomYPosition = getBottomPositionOfMesh(relevantEntityPlacementMeshTemplate).y;
                if (entityBottomYPosition < 0) {
                   var amountToRaise = -1 * entityBottomYPosition;
                   relevantEntityPlacementMeshTemplate.position.y += amountToRaise;
                }
            }
            relevantEntityPlacementMeshTemplate.visibility = true;
        }
        // Render
        scene.render();
    }

    function startRenderloop() {
        babylon.runRenderLoop(function () {
            render();
        });
    }

    function onEntityAdded(entity) {
        // Set mesh
        var relevantEntityMeshTemplate = meshTemplates[entity.type];
        entity.renderer3Dstate.mesh = relevantEntityMeshTemplate.clone("entity " + entity.id);
        entity.renderer3Dstate.mesh.entity = entity; // circular ref
        entity.renderer3Dstate.mesh.visibility = true;
        entity.renderer3Dstate.mesh.selectable = true;
        // Add to shadowmap
        shadowGenerator.getShadowMap().renderList.push(entity.renderer3Dstate.mesh);
        // Add babylon position
        entity.renderer3Dstate.mesh.position = new BABYLON.Vector3(entity.position.x, entity.position.y, entity.position.z);
    }

    function onEntityRemoved(id) {

    }

    function getFloorPositionAtPosition2D(x,y) {
        var pickInfo = scene.pick(x, y, function (mesh) { return mesh == ground; });
        if (pickInfo.hit) {
            return new Position(pickInfo.pickedPoint.x, pickInfo.pickedPoint.y, pickInfo.pickedPoint.z);
        }
        return null;
    }

    function getEntitiesBetweenPositions2D(startPosX, startPosY, endPosX, endPosY, entitiesToCheck) {
        // Find location in 3D
        var startPosOnFloor = getFloorPositionAtPosition2D(startPosX, startPosY);
        var endPosOnFloor = getFloorPositionAtPosition2D(endPosX, endPosY);
        if (!startPosOnFloor || !endPosOnFloor) {
            return [];
        }
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
            var mesh = entity.renderer3Dstate.mesh;
            if (rubberBandSelectionMesh.intersectsPoint(mesh.position)) {
                selectedEntities.push(entity);
            }
        }
        return selectedEntities;
    }

    function hideEntities(entities) {
        for (var index in entities) {
            entities[index].visibility = false;
        }
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

    function deselectMeshes(meshes) {
        for (var index in meshes) {
            meshes[index].material = meshes[index].originalMaterial;
            if (meshes[index].selectionRing) {
                meshes[index].selectionRing.dispose();
            }
        }
    }

    function getBottomPositionOfMesh(mesh) {
        var pos = mesh.position.clone();
        var minimumPos = mesh.getBoundingInfo().boundingBox.minimumWorld;
        pos.y = minimumPos.y;
        return pos;
    }

    // =====
    // Return
    // =====

    return {
    	init : init,
        startRenderloop : startRenderloop,
        handleWindowResizes : function() {
            window.addEventListener("resize", function () {
                babylon.resize();
            });
        },
        moveViewPortRight : function(amount) {
            camera.cameraDirection.x += amount;
        },
        moveViewPortUp : function(amount) {
            camera.cameraDirection.z += amount;
        },
        onEntityAdded : onEntityAdded,
        onEntityUpdated : function(updatedEntity) {
            updatedEntity.renderer3Dstate.mesh.position.x = updatedEntity.position.x;
            updatedEntity.renderer3Dstate.mesh.position.y = updatedEntity.position.y;
            updatedEntity.renderer3Dstate.mesh.position.z = updatedEntity.position.z;
        },
        onEntityRemoved : onEntityRemoved,
        getEntityAtPosition2D : function(x,y) {
            var pickInfo = scene.pick(x, y, function (mesh) { return mesh.selectable; });
            if (!pickInfo.hit) {
                return null;
            }
            var currentMesh = pickInfo.pickedMesh;
            return currentMesh.entity;
        },
        getHeightOfPositionedEntity : function() {
            if (rendererGeneralState.newEntityPlacement.placementInProgress) {
                var relevantEntityPlacementMeshTemplate = entityPlacementMeshTemplates[rendererGeneralState.newEntityPlacement.entityType];
                return relevantEntityPlacementMeshTemplate.getBoundingInfo().boundingBox.maximumWorld.y - relevantEntityPlacementMeshTemplate.getBoundingInfo().boundingBox.minimumWorld.y;
            }
        },
        getFloorPositionAtPosition2D : function(x,y) {
            return getFloorPositionAtPosition2D(x,y);
        },
        getEntitiesBetweenPositions2D : function(startPosX, startPosY, endPosX, endPosY, entitiesById) {
            return getEntitiesBetweenPositions2D(startPosX, startPosY, endPosX, endPosY, entitiesById);
        },
        get2DpositionForEntity : function(entity) {
            var position = BABYLON.Vector3.Project(
                entity.renderer3Dstate.mesh.position, 
                BABYLON.Matrix.Identity(),
                scene.getTransformMatrix(),
                camera.viewport.toGlobal(babylon.getRenderWidth(), babylon.getRenderHeight())
            );
            return { x: position.x, y: position.y };
        },
        onEntitiesSelected : function(selectedEntities) {
            for (var index in selectedEntities) {
                var mesh = selectedEntities[index].renderer3Dstate.mesh;
                mesh.selectionRing = meshTemplates.selectionRing.clone("selectionRing");
                mesh.selectionRing.parent = mesh;
                mesh.selectionRing.visibility = true;
            }
        },
        onEntitiesDeselected: function(entitiesToDeselect) {
            for (var index in entitiesToDeselect) {
                var mesh = entitiesToDeselect[index].renderer3Dstate.mesh;
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

function init2Drenderer(pixi, scene2D, canvas2D) {
    renderer2D.init(pixi, scene2D);
}

function init3Drenderer(babylon, scene3D, canvas3D) {
    renderer3D.init(babylon, scene3D);
}

function initGameState() {
    // Create entities
    game.state.entities = [];
    for (var i = 0; i < 10; i++) {
        var entityType = 'unit';
        var player = 1;
        game.createEntity(-i * 50, 5, 0, entityType, player);
    }
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

// =====
// Unused code
// =====

/* 

    function getWidthXOfMesh(mesh) {
        return mesh.getBoundingInfo().boundingBox.maximumWorld.x - mesh.getBoundingInfo().boundingBox.minimumWorld.x;
    }

    function getWidthZOfMesh(mesh) {
        return mesh.getBoundingInfo().boundingBox.maximumWorld.z - mesh.getBoundingInfo().boundingBox.minimumWorld.z;
    }

    function getHeightOfMesh(mesh) {
        return mesh.getBoundingInfo().boundingBox.maximumWorld.y - mesh.getBoundingInfo().boundingBox.minimumWorld.y;
    }

*/