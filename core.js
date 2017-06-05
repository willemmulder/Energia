"use strict";

// TODO: rewrite in Typescript

(function() {

    // =====
    // Export module
    // =====

    var core = {};

    // Export to NodeJS or Browser
    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = core;
        }
        exports.core = core;
    } else {
        // Browser
        this.core = core;
    }

    // =====
    // Export classes
    // =====

    core.classes = {};

    class Node {
        constructor(id, name, x, y, initialEnergy, energyConsumptionPerSecond, signalPower, signalRadius) {
            this.id = id;
            this.name = name;
            this.location = {};
            this.location.x = x;
            this.location.y = y;
            this.energy = initialEnergy;
            this.desiredMinimumEnergy = 100;
            this.energyConsumptionPerSecond = energyConsumptionPerSecond;
            this.signalPower = signalPower;
            this.signalRadius = signalRadius;
            this.active = true;
            this.nodeConnectionsById = {};
            this.networkId = null; // the ID of the network that this node is part of
        }

        calulateEnergyPosition() {
            return this.energy - this.desiredMinimumEnergy;
        }

        calculateEnergyConsumption(deltaTimeInMilliseconds) {
            if (!this.active) {
                return 0;
            }
            return this.energyConsumptionPerSecond * (deltaTimeInMilliseconds / 1000);
        }

        consumeEnergy(energyAmount) {
            this.energy -= energyAmount;
        }

        produceEnergy(energyAmount) {
            this.energy += energyAmount;
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            if (!this.active) {
                return 0;
            }
            return 0;
        }

        getNodeConnectionsWithUnconfirmedEnergyDistributions() {
            var nodes = [];
            var self = this;
            Object.keys(this.nodeConnectionsById).forEach(function(targetId) {
                var nodeConnection = self.nodeConnectionsById[targetId];
                if (!nodeConnection.energyDistributions.confirmed) {
                    nodes.push(nodeConnection);
                }

            });
            return nodes;
        }

        activate() {
            this.active = true;
        }

        deactivate() {
            this.activate = false;
        }
    }

    class Producer extends Node {
        constructor(id, name,x,y) {
            super(
                id,
                name,
                x,
                y,
                900, 
                10,
                10,
                10
            );
            this.energyProductionPerSecond = 100;
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            if (!this.active) {
                return 0;
            }
            return this.energyProductionPerSecond * (deltaTimeInMilliseconds/1000) ; // TODO: make energy production also dependent on resources that the Producer has
        }
    }
    core.classes.producer = Producer;

    class Consumer extends Node {
        constructor(id,name,x,y) {
            super(
                id,
                name,
                x,
                y,
                500, 
                10,
                10,
                10
            );
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            return 0;
        }
    }
    core.classes.consumer = Consumer;

    class Relay extends Node {
        constructor(id,name,x,y) {
            super(
                id,
                name,
                x,
                y,
                500, 
                0,
                10,
                10
            );
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            return 0;
        }
    }
    core.classes.relay = Relay;

    class NodeConnection {
        constructor(sourceNode, targetNode, distance) {
            this.sourceNode = sourceNode;
            this.targetNode = targetNode;
            this.distance = distance; // This is always less than sourceNode.signalRadius because otherwise they wouldn't be connected...
            this.energyDistributions = {
                total: 0,
                confirmed: false, // a flow is confirmed if we *know* that this amount is going to/from the targetNode
                distributionsByOriginalSourceNode: {}
            };
        }
        calculateEffectiveSignalStrength() {
            return this.sourceNode.signalPower; // TODO: we could take the distance into account and do signalPower * (this.distance / this.sourceNode.signalRadius);
        }
    }
    core.classes.nodeConnection = NodeConnection;

    class Network {
        constructor(id) {
            this.id = id;
            this.nodes = [];
            this.averageEnergyPosition = null;
            this.uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution = [];
            this.energyNotDistributed = 0;
        }
    }
    core.classes.network = Network;

    // =====
    // Export tick function
    // =====

    core.tick = function tick(nodesList, deltaTimeInMilliseconds) {

        // ===
        // Make map of nodes
        // ===
        var nodesById = {};
        nodesList.forEach(function(node) {
            nodesById[node.id] = node;
        });

        // ===
        // Energy consumption
        // ===

        nodesList.forEach(function(node, index) {
            node.consumeEnergy(node.calculateEnergyConsumption(deltaTimeInMilliseconds));
        });

        // ===
        // Energy production
        // ===

        nodesList.forEach(function(node, index) {
            node.produceEnergy(node.calculateEnergyProduction(deltaTimeInMilliseconds));
        });
        

        // ===
        // Energy distribution
        // ===

        // Step 1: determine the connections between the nodes
        // NodeConnections do have a direction, i.e. they have a sourceNode and a TargetNode
        // Yay, very inefficiënt algorithm
        // TODO: make this cached and only change the network topology when a specific trigger gives reason to do so: e.g. a moving unit, a new building, etc
        nodesList.forEach(function(sourceNode, sourceIndex) {
            sourceNode.nodeConnectionsById = {};
            sourceNode.networkId = null;
            nodesList.forEach(function(targetNode, targetIndex) {
                if (sourceNode !== targetNode) {
                    var distance = calculateDistance(sourceNode, targetNode);
                    if (distance < sourceNode.signalRadius) {
                        sourceNode.nodeConnectionsById[targetNode.id] = new NodeConnection(
                            sourceNode,
                            targetNode,
                            distance
                        );
                    }
                };
            });
        });

        // Step 2: find all disconnected subgraphs using e.g.
        // http://stackoverflow.com/questions/1348783/finding-all-disconnected-subgraphs-in-a-graph
        // I think what you are looking for is generally called a Flood Fill. It is up to you whether you traverse the graph through a BFS or a DFS.
        // Basically you take an unlabeled (AKA uncoloured) node and assign a new label to it. You assign the same label to all nodes adjacent to that one, and so on to all nodes that are reachable from that node.
        // When no more reachable nodes can be labeled, you start over by picking another unlabeled node. Notice that the fact that this new node is unlabeled implies that it is not reachable from our earlier node and is thus in a different disconnected component.
        // When there are no more unlabeled nodes, the number of distinct labels you had to use is the number of components of the graph. The label for each node tells you which node is part of which component.
        var networks = [];
        var networkIdCounter = 0;
        nodesList.forEach(function(node, index) {
            if (!node.networkId) {
                networkIdCounter++;
                var network = new Network(networkIdCounter);
                networks.push(network);
                node.networkId = networkIdCounter;
                network.nodes.push(node);
                if (node.nodeConnectionsById) {
                    assignConnectionsToNetwork(node.nodeConnectionsById);
                }
                function assignConnectionsToNetwork(connectionsById) {
                    Object.keys(connectionsById).forEach(function(targetIndex) {
                        var nodeConnection = connectionsById[targetIndex];
                        var targetNode = nodeConnection.targetNode;
                        if (!targetNode.networkId) {
                            targetNode.networkId = networkIdCounter;
                            network.nodes.push(targetNode);
                            if (targetNode.nodeConnectionsById) {
                                assignConnectionsToNetwork(targetNode.nodeConnectionsById);
                            }
                        }
                    });
                }
            }
        });

        // Step 3: determine energy position of all networks
        networks.forEach(function(network, index) {
            var cumulativeEnergyPosition = 0;
            network.nodes.forEach(function(node, index) {
                //console.log("Energy position of node " + index + " is " + node.calulateEnergyPosition());
                cumulativeEnergyPosition += node.calulateEnergyPosition();
            });
            network.averageEnergyPosition = cumulativeEnergyPosition / network.nodes.length;
        });
        //console.log(networks);

        // Step 4: act as if the energy network is like connected tubes with sticky goo.
        // Every node has an upright tube with the surplus goo (everything above average) pushing down into the network or a hole for goo to stream into
        // Some nodes have a lot of surplus goo pushing down, others have less pushing down
        // TODO: complications that some tubes are bigger than others, so some can carry more goo than others

        // Pressure from every node is distributed over the network

        // As a first step, we simply distribute the energy pushing (or pulling) evenly over all connected nodes
        // For example the 1st node has +10 energy and two connected nodes, then every connected node will receive 5 energy
        // Then we will do node two, three, etc etc
        // For every connection that we touch we will immediately add or subtract any existing energy flows over that connection
        // For example if node 1 pushed 5 energy to node 2, and node 2 pushes 3 energy to node 1, we will balance this out so that in effect node 1 pushes 2 energy to node 2

        // For every connection we keep track whether it has > 1 energy flowing through it

        // So in general
        // 1. Distribute energy from all nodes to their direct connections, taking into account reverse energy flows (as described above)
        // 2. In a loop: 
        //    a) for all nodes that have only one unconfirmed energy-connection, confirm that connection and check the connected node as well
        //    b) for all connections that distribute > 1 energy, redistribute that energy to further nodes. Once distributed energy drops < 1, remove from the list. Once it gets > 1, add it do the list again.

        var biggestEnergyChange = 0;
        networks.forEach(function(network, index) {
            var nodesWithUnconfirmedEnergyDistribution = network.nodes.slice();
            while(nodesWithUnconfirmedEnergyDistribution.length > 0) {
                var unconfirmedNode = nodesWithUnconfirmedEnergyDistribution.shift();
                // First process incoming and outgoing energyDistributions and balance them
                // e.g. +10 incoming and we have -10 outgoing, ... then what?
                // or if we have +10 incoming and we have +10 outgoing, ... then what?
                // Calculate energy to distribute to the network
                var energyToDistribute = unconfirmedNode.calulateEnergyPosition() - network.averageEnergyPosition;
                // Check if we can make an EnergyDistribution confirmed
                // If so, move our energy over to the targetNode and mark the node as 'unconfirmed'
                // Get connections to distribute energy to (which are the ones that are not yet confirmed)
                function distributeToNodeConnections(originalSourceNode, currentSourceNode, currentEnergyToDistribute) {
                    // Create energy streams to only those connected nodes that are not already pushing energy from originalSourceNode to us
                    var nodeConnectionsToDistributeTo = [];
                    Object.keys(currentSourceNode.nodeConnectionsById).forEach(function(targetId) {
                        var nodeConnection = currentSourceNode.nodeConnectionsById[targetId];
                        // Check if there is not already a reverse nodeConnection
                        // TODO: !!!! IMPORTANT !!!! 
                        // What to do IF there is a reverse nodeConnection? Do we cancel it out? Do we ignore? What do we do?
                        if (!nodeConnection.targetNode.nodeConnectionsById[currentSourceNode.id].energyDistributions.distributionsByOriginalSourceNode[originalSourceNode.id]) {
                            nodeConnectionsToDistributeTo.push(nodeConnection);
                        }
                    });
                    // Calculate energy to distribute, per node
                    var energyToDistributeToEveryNode = currentEnergyToDistribute / nodeConnectionsToDistributeTo.length;
                    // Distribute
                    if (energyToDistributeToEveryNode > 1) {
                        nodeConnectionsToDistributeTo.forEach(function(nodeConnection) {
                            nodeConnection.energyDistributions.total += energyToDistributeToEveryNode;
                            nodeConnection.energyDistributions.distributionsByOriginalSourceNode[originalSourceNode.id] = {
                                originalSourceNode: originalSourceNode,
                                energy: energyToDistributeToEveryNode
                            }
                            distributeToNodeConnections(originalSourceNode, sourceNode, currentEnergyToDistribute);
                        });
                    }
                }
                distributeToNodeConnections(sourceNode, sourceNode, energyToDistribute);
            }
        });
        
        // Step 5: execute the energyDistribution and add/subtract from the energy levels of the nodes
        var totalDistribution = 0;
        networks.forEach(function(network, index) {
            network.energyNotDistributed = 0;
            // First, calculate a general distribution of the available energy to connected nodes
            network.nodes.forEach(function(sourceNode) {
                // Loop over sourceNode nodeConnections
                Object.keys(sourceNode.nodeConnectionsById).forEach(function(targetId) {
                    var nodeConnection = sourceNode.nodeConnectionsById[targetId];
                    sourceNode.energy -= nodeConnection.energyDistributions.total;
                });
                // Check how much energy was NOT distributed
                network.energyNotDistributed += Math.abs(network.averageEnergyPosition - sourceNode.calulateEnergyPosition());
            });
        });
        console.log(networks);

    }

    // =====
    // Private functions
    // =====

    function calculateDistance(node1, node2) {
        return Math.sqrt(
            (node1.location.x - node2.location.x) * (node1.location.x - node2.location.x) +
            (node1.location.y - node2.location.y) * (node1.location.y - node2.location.y)
        );
    }

}).call(this);
