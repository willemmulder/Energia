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
    // Export id-counters
    // =====

    core.lastUsedNodeId = null;

    // =====
    // Export classes
    // =====

    core.classes = {};

    class Node {
        constructor(x, y, initialEnergy, energyConsumptionPerSecond, signalPower, signalRadius) {
            // Set ID
            var currentLastUsedId = core.lastUsedNodeId || 0;
            var newId = ++currentLastUsedId;
            this.id = newId;
            core.lastUsedNodeId = newId;
            // Set other properties
            this.position = {};
            this.position.x = x;
            this.position.y = y;
            this.energy = initialEnergy;
            this.desiredMinimumEnergy = 100;
            this.energyConsumptionPerSecond = energyConsumptionPerSecond;
            this.signalPower = signalPower;
            this.signalRadius = signalRadius;
            this.active = true;
            this.nodeConnectionsById = {};
            this.energyToDistribute = 0;
            this.incomingEnergy = 0;
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
        constructor(x,y) {
            super(
                x,
                y,
                900, 
                10,
                10,
                100
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
    core.classes.Producer = Producer;

    class Consumer extends Node {
        constructor(x,y) {
            super(
                x,
                y,
                500, 
                10,
                10,
                100
            );
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            return 0;
        }
    }
    core.classes.Consumer = Consumer;

    class Relay extends Node {
        constructor(x,y) {
            super(
                x,
                y,
                500, 
                0,
                10,
                100
            );
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            return 0;
        }
    }
    core.classes.Relay = Relay;

    class NodeConnection {
        constructor(sourceNode, targetNode, distance) {
            this.sourceNode = sourceNode;
            this.targetNode = targetNode;
            this.distance = distance; // This is always less than sourceNode.signalRadius because otherwise they wouldn't be connected...
            this.energyDistributions = {
                total: 0,
                confirmed: false, // a flow is confirmed if we *know* that this amount is going to/from the targetNode
            };
        }
        calculateEffectiveSignalStrength() {
            return this.sourceNode.signalPower; // TODO: we could take the distance into account and do signalPower * (this.distance / this.sourceNode.signalRadius);
        }
    }
    core.classes.NodeConnection = NodeConnection;

    class Network {
        constructor(id) {
            this.id = id;
            this.nodes = [];
            this.averageEnergyPosition = null;
            this.uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution = [];
            this.energyNotDistributed = 0;
        }
    }
    core.classes.Network = Network;

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
        var networks = core.networks = [];
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
                //log("Energy position of node " + index + " is " + node.calulateEnergyPosition());
                cumulativeEnergyPosition += node.calulateEnergyPosition();
            });
            network.averageEnergyPosition = cumulativeEnergyPosition / network.nodes.length;
        });
        log(networks);

        // Step 4: act as if the energy network is like connected tubes with sticky goo.
        // Every node has an upright tube with the surplus goo (everything above average) pushing down into the network or a hole for goo to stream into
        // Some nodes have a lot of surplus goo pushing down, others have less pushing down
        // TODO: complications that some tubes are bigger than others, so some can carry more goo than others

        // Pressure from every node is distributed over the network

        networks.forEach(function(network, networkIndex) {
            
            // A 
            // First, we calculate how much energy every node has to distribute this turn, initially
            network.nodes.forEach(function(node) {
                // Calculate energy to distribute to the network
                var energyToDistribute = node.calulateEnergyPosition() - network.averageEnergyPosition;
                node.incomingEnergy = energyToDistribute;
                node.energyToDistribute = 0;
            });

            // B
            // Create a list with nodes that we care about
            // Once a node has a confirmed energydistribution, we will not take it into account anymore
            // Also, when a node distributed less than 1 energy to other nodes, we will not care about it until it has incomingEnergy again
            // TODO: make this more efficient by using an object, by ID instead of a list
            var nodesToProcess = network.nodes.slice();
            function removeNodeFromListToProcess(someNode) {
                var index = nodesToProcess.indexOf(someNode);
                log('index to remove is ' + index, someNode, nodesToProcess);
                if (index > -1) {
                    nodesToProcess.splice(index, 1);
                }
            }
            function addToListToProcess(someNode) {
                var index = nodesToProcess.indexOf(someNode);
                if (index == -1) {
                    nodesToProcess.push(someNode);
                }
            }

            // C
            // Now simply distribute the energy pushing (or pulling) evenly over all connected nodes
            // For example the 1st node has +10 energy and two connected nodes, then every connected node will receive 5 energy
            // Then we will do node two, three, etc etc
            // We do this by looping:
            //    a) for all nodes that have only one unconfirmed energy-connection, confirm that connection and check the connected node as well
            //    b) for all connections that distribute > 1 energy, redistribute that energy to further nodes. Once distributed energy drops < 1, remove from the list. Once it gets > 1, add it do the list again.
            var counter = 0;
            while(nodesToProcess.length > 0) {
                // First for all nodes set incoming energy to outgoing energy
                nodesToProcess.forEach(function(node) {
                    log('Setting energy to distribute ', node.energyToDistribute, node.incomingEnergy);
                    // We add the incoming energy to any possibly not yet distributed energy
                    // This latter can happen because we do not distribute negative energy; so nodes with a negative energyToDistribute will remain like that after a round
                    node.energyToDistribute += node.incomingEnergy;
                    node.incomingEnergy = 0;
                });
                // Then process all the outgoing energy per node and add them to the ingoing energy of the connected nodes
                // Note: do not use forEach when we also delete items from that same list during the loop. It will results in crazyness.
                // So we use a simple backwards loop here
                for(var nodeIndex = nodesToProcess.length-1; nodeIndex >= 0; nodeIndex--) {
                    var node = nodesToProcess[nodeIndex];
                    var unconfirmedConnections = node.getNodeConnectionsWithUnconfirmedEnergyDistributions();
                    log('processing node', node, unconfirmedConnections);
                    // If there is only one unconfirmed nodeConnection, then we know for sure all our energy has to go there
                    // So we can calculate that and then confirm that one nodeConnection
                    if (unconfirmedConnections.length == 0) {
                        // Remove from list that we care about, until the node has received enough incoming energy again
                        // TODO: process any incomingEnergy or outgoingEnergy. It should add up to 0, right?
                        log('removing because of 0 unconfirmedConnections', node);
                        removeNodeFromListToProcess(node);
                    } else if (unconfirmedConnections.length == 1) {
                        // Remove node from list that we care about
                        removeNodeFromListToProcess(node);
                        // Confirm the energy distribution of the relevant connection
                        var unconfirmedConnection = unconfirmedConnections[0];
                        log('confirming connection ', unconfirmedConnection);
                        unconfirmedConnection.energyDistributions.confirmed = true;
                        unconfirmedConnection.targetNode.nodeConnectionsById[unconfirmedConnection.sourceNode.id].energyDistributions.confirmed = true;
                        // We need to push all energy we still have to distribute to the one connected node
                        // That is all energy that was already planned to be distributed, plus anything that we might have *received* from our nodeConnection this round
                        node.energyToDistribute += node.incomingEnergy;
                        node.incomingEnergy = 0;
                        // Now push
                        unconfirmedConnection.energyDistributions.total += node.energyToDistribute;
                        unconfirmedConnection.targetNode.incomingEnergy += node.energyToDistribute;
                        // Add to nodelist if targetNode has received enough incoming energy
                        if (unconfirmedConnection.targetNode.incomingEnergy > 1) {
                            log('adding because >1 energy is distributed to it ', unconfirmedConnection.targetNode);
                            addToListToProcess(unconfirmedConnection.targetNode);
                        }
                        unconfirmedConnection.targetNode.nodeConnectionsById[unconfirmedConnection.sourceNode.id].energyDistributions.total -= node.energyToDistribute;
                        // Consume the energy from the sourceNode
                        node.energyToDistribute = 0;
                    } else {
                        // Distribute to all connected (unconfirmed) nodes
                        // We only redistribute energy there is >1 energy to distribute
                        // NOTE: here we only distribute positive energy, not negative energy
                        if (node.energyToDistribute > 1) {
                            // Calculate energy to distribute, per node
                            var energyToDistributeToEveryNode = node.energyToDistribute / unconfirmedConnections.length;
                            // Distribute
                            unconfirmedConnections.forEach(function(unconfirmedConnection) {
                                unconfirmedConnection.energyDistributions.total += energyToDistributeToEveryNode;
                                unconfirmedConnection.targetNode.incomingEnergy += energyToDistributeToEveryNode;
                                // Add to nodelist if targetNode has received enough incoming energy
                                if (unconfirmedConnection.targetNode.incomingEnergy > 1) {
                                    log('adding because >1 energy is distributed to it ', unconfirmedConnection.targetNode);
                                    addToListToProcess(unconfirmedConnection.targetNode);
                                }
                                unconfirmedConnection.targetNode.nodeConnectionsById[unconfirmedConnection.sourceNode.id].energyDistributions.total -= energyToDistributeToEveryNode;
                            });
                            // Consume the energy from the sourceNode
                            node.energyToDistribute = 0;
                        } else {
                            // There is less < 1 energy to distribute. 
                            // That is not significatn enough to process this node any further
                            // If this node also has no incoming energy to process, we remove it from list that we care about
                            // It can be placed back on the list once the node receives incoming energy again
                            if (node.incomingEnergy == 0) {
                                log('removing because it does not require any further processing for now', node);
                                removeNodeFromListToProcess(node);
                            }
                        }
                    }
                } // end of nodes
                log('round for network ', networkIndex, nodesToProcess.length);
                log(networkIndex, nodesToProcess[0]);
                counter++;
                if (counter == 50) {
                    break;
                }
            } // end of while

        }); // end of networks
        
        // Step 5: execute the energyDistribution and add/subtract from the energy levels of the nodes
        var totalDistribution = 0;
        networks.forEach(function(network, networkIndex) {
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
        log(networks);

    }

    // =====
    // Private functions
    // =====

    function calculateDistance(node1, node2) {
        return Math.sqrt(
            (node1.position.x - node2.position.x) * (node1.position.x - node2.position.x) +
            (node1.position.y - node2.position.y) * (node1.position.y - node2.position.y)
        );
    }

    // =====
    // Logger
    // =====

    var doDebug = false;
    function log() {
        if (doDebug) {
            console.log.apply(this,arguments);
        }
    }

}).call(this);
