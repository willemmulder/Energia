// =====
// Main variables
// =====

var game = {
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
        selectEntities : {},
        map : {},
        players : {
            neutral : {
                name : "Neutral",
                color : "#dddddd"
            }
        }
    },
    start : function(options) {
        if (this.started) {
            console.log("Game already started");
            return;
        }
        if (!options.babylon || !options.pixi) {
            console.log("Babylon or Pixi was not provided");
            return;
        }
        initGameState();
        initRenderers(options.canvas2D, options.canvas3D);
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
	}
}

var Entity = function(x,y,type,status,player) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.status = status;
    this.player = player;
}

var eventHandlers2D = {
	lastDownPoint : {
		x : null,
		y : null,
		rightClick : false
	},
    currentDownPoint : {
        x : null,
        y : null,
    },
    lastUpPoint : {
        x : null,
        y : null
    },
	down : function(x,y,rightClick) {

	},
	up : function(x,y) {

	}
}

var actions = {
	selectEntities : function(entityIds) {

	},
	deselectEntities : function(entityIds) {
		var deselectAll = (entityIds ? false : true);
	}
}

var renderer3D = (function() {
    	
    var babylon;
    var state = {};
    var scene;

    function init(babylonParam) {
        babylon = babylonParam;
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
        game.meshTemplates.unit = unitTemplate = BABYLON.Mesh.CreateBox("UnitTemplate", 10, scene);
        unitTemplate.material = unitTemplate.originalMaterial = game.materials.yellowMaterial;
        unitTemplate.visibility = false;
        unitTemplate.selectable = false;

        var mainBuildingTemplate;
        game.meshTemplates.mainBuilding = mainBuildingTemplate = BABYLON.Mesh.CreateBox("MainBuildingTemplate", 20, scene);
        mainBuildingTemplate.material = mainBuildingTemplate.originalMaterial = game.materials.yellowMaterial;
        mainBuildingTemplate.visibility = false;
        mainBuildingTemplate.selectable = false;

        var selectionRingTemplate;
        game.meshTemplates.selectionRing = selectionRingTemplate = BABYLON.Mesh.CreateDisc('SelectionRing', 15, 32, scene);
        selectionRingTemplate.material = game.materials.selectionRingMaterial;;
        selectionRingTemplate.position.y = 0.1;
        selectionRingTemplate.rotation.x = Math.PI / 2;
        selectionRingTemplate.receiveShadows = true;
        selectionRingTemplate.visibility = false;
        selectionRingTemplate.selectable = false;

        game.entityPlacementMeshTemplates = {};
        game.entityPlacementMeshTemplates.unit = game.meshTemplates.unit.clone("placementUnitTemplate");
        game.entityPlacementMeshTemplates.mainBuilding = game.meshTemplates.mainBuilding.clone("placementMainBuildingTemplate");

        // Create units
        game.entities = [];
        for (var i = 0; i < 10; i++) {
            var mesh = game.meshTemplates.unit.clone("entity " + game.entities.length);
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

    }

    function entityAdded(id, entity) {

    }

    function entityRemoved(id) {

    }

    return {
    	init : init,
        render : render,
        entityAdded : entityAdded,
        entityRemoved : entityRemoved
    };
    
})();

var renderer2D = {
	state : {

	},
    scene : null,
	init : function(pixi) {

	},
	render : function() {

	},
    entityAdded : function(id, entity) {

    }, 
    entityRemoved : function(id) {
        
    }
}

// =====
// Private functions
// =====

function initGameState() {

}

function initRenderers() {

}