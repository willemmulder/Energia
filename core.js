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
            this.nodeConnectionsByIndex = {};
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
            Object.keys(this.nodeConnectionsByIndex).forEach(function(targetIndex) {
                var nodeConnection = self.nodeConnectionsByIndex[targetIndex];
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

    core.classes.producer = class Producer extends Node {
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
        }

        calculateEnergyProduction(deltaTimeInMilliseconds) {
            if (!this.active) {
                return 0;
            }
            return 100 * (deltaTimeInMilliseconds/1000) ; // TODO: make energy production also dependent on resources that the Producer has
        }
    }

    core.classes.consumer = class Consumer extends Node {
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

    core.classes.nodeConnection = class NodeConnection {
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

    // =====
    // Export tick function
    // =====

    core.tick = function tick(nodesList, deltaTimeInMilliseconds) {

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

        // TODO: step 0: find all disconnected subgraphs using e.g.
        // http://stackoverflow.com/questions/1348783/finding-all-disconnected-subgraphs-in-a-graph
        /*
        I think what you are looking for is generally called a Flood Fill. It is up to you whether you traverse the graph through a BFS or a DFS.
        Basically you take an unlabeled (AKA uncoloured) node and assign a new label to it. You assign the same label to all nodes adjacent to that one, and so on to all nodes that are reachable from that node.
        When no more reachable nodes can be labeled, you start over by picking another unlabeled node. Notice that the fact that this new node is unlabeled implies that it is not reachable from our earlier node and is thus in a different disconnected component.
        When there are no more unlabeled nodes, the number of distinct labels you had to use is the number of components of the graph. The label for each node tells you which node is part of which component.
        */

        // Step 1: determine energy position of all nodees
        var cumulativeEnergyPosition = 0;
        nodesList.forEach(function(node, index) {
            console.log("Energy position of node " + index + " is " + node.calulateEnergyPosition());
            cumulativeEnergyPosition += node.calulateEnergyPosition();
        });
        var averageEnergyPosition = cumulativeEnergyPosition / nodesList.length;

        console.log("Assuming that all nodes have the same desiredMinimumEnergy of 100, then at the end of this tick all nodes should have an energy position of 100+" + averageEnergyPosition);

        // Step 2: determine the connections between the nodes
        // NodeConnections do have a direction, i.e. they have a sourceNode and a TargetNode
        // Yay, very inefficiënt algorithm
        nodesList.forEach(function(sourceNode, sourceIndex) {
            sourceNode.nodeConnectionsByIndex = {};
            nodesList.forEach(function(targetNode, targetIndex) {
                if (sourceNode !== targetNode) {
                    var distance = calculateDistance(sourceNode, targetNode);
                    if (distance < sourceNode.signalRadius) {
                        sourceNode.nodeConnectionsByIndex[targetIndex] = new NodeConnection(
                            sourceNode,
                            targetNode,
                            distance
                        );
                    }
                };
            });
        });

        // Step 3: act as if the energy network is like connected tubes with sticky goo.
        // Every node has an upright tube with the surplus goo (everything above average) pushing down into the network
        // Some nodes have a lot of surplus goo pushing down, others have less pushing down, and others even have holes for goo to stream into.
        // TODO: complications that some tubes are bigger than others, so some can carry more goo than others

        var uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution = [];
        
        // First, calculate a general distribution of the available energy to connected nodes
        var biggestEnergyChange = 0;
        nodesList.forEach(function(sourceNode, sourceIndex) {
            // Calculate energy to distribute to the network
            var energyToDistribute = sourceNode.calulateEnergyPosition() - averageEnergyPosition;
            console.log("Energy to distribute for node " + sourceIndex + " is " + energyToDistribute);
            // Create energy streams to every connected node
            var amountOfNodesToDistributeTo = Object.keys(sourceNode.nodeConnectionsByIndex).length;
            var energyToDistributeToEveryNode = energyToDistribute / amountOfNodesToDistributeTo;
            if (energyToDistributeToEveryNode > biggestEnergyChange) {
                biggestEnergyChange = energyToDistributeToEveryNode;
            }
            console.log("The amount to distribute to every connected node is " + energyToDistributeToEveryNode);
            // Loop over sourceNode nodeConnections
            Object.keys(sourceNode.nodeConnectionsByIndex).forEach(function(targetIndex) {
                var nodeConnection = sourceNode.nodeConnectionsByIndex[targetIndex];
                // Set from sourceNode -> targetNode
                if (amountOfNodesToDistributeTo == 1) {
                    nodeConnection.energyDistributions.confirmed = true;
                    nodeConnection.energyDistributions.total = energyToDistributeToEveryNode;
                    uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution.push(nodeConnection);
                } else {
                    nodeConnection.energyDistributions.total += energyToDistributeToEveryNode;
                }
                nodeConnection.energyDistributions.distributionsByOriginalSourceNode[sourceIndex] = {
                    originalSourceNode: sourceNode,
                    energy: energyToDistributeToEveryNode,
                    confirmed: (amountOfNodesToDistributeTo == 1 ? true : false) // a distribution is confirmed if we *know* that this amount is coming to the targetNode
                }
                // Also set reverse on targetNode -> sourceNode
                // Except if that nodeConnection is already confirmed; then don't touch it
                var targetNodeConnection = nodeConnection.targetNode.nodeConnectionsByIndex[sourceIndex];
                if (!targetNodeConnection.energyDistributions.confirmed) {
                    if (amountOfNodesToDistributeTo == 1) {
                        targetNodeConnection.energyDistributions.confirmed = true;
                        targetNodeConnection.energyDistributions.total = energyToDistributeToEveryNode * -1;
                        uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution.push(targetNodeConnection);
                    } else {
                        targetNodeConnection.energyDistributions.total -= energyToDistributeToEveryNode;
                    }
                    targetNodeConnection.energyDistributions.distributionsByOriginalSourceNode[sourceIndex] = {
                        originalSourceNode: sourceNode,
                        energy: energyToDistributeToEveryNode * -1,
                        confirmed: (amountOfNodesToDistributeTo == 1 ? true : false) // a distribution is confirmed if we *know* that this amount is coming to the targetNode
                    }
                }
            });
        });
        console.log("Biggest energy change right now is " + biggestEnergyChange);

        // Check all nodeConnections that have confirmed energyDistributions, and see whether we can propagate those confirmations
        // TODO: optimize by finding nodes that divide the network in two. We can for those nodes decide how much energy goes from one part of the network to the other part, then confirm the distributions from that node to its connectedNodes
        // Determining whether and where a network can be divided into two parts is quite inefficient in itself though, so maybe not do that if we don't need it
        // Loop through all nodes that need to be checked
        while(uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution.length > 0) {
            var uncheckedNodeConnection = uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution.shift();
            // First, ensure that the connection from targetNode *back* to sourceNode is updated so that it contains the proper total
            uncheckedNodeConnection.targetNode.nodeConnectionsByIndex[uncheckedNodeConnection.sourceNode.id].energyDistributions.confirmed = true;
            uncheckedNodeConnection.targetNode.nodeConnectionsByIndex[uncheckedNodeConnection.sourceNode.id].energyDistributions.total = uncheckedNodeConnection.energyDistributions.total * -1;
            // Now check whether this confirmed nodeConnection causes the connected targetNode to have only 1 unconfirmed energyDistribution left
            // Which would mean the energyDistributions for the targetNode can also be confirmed
            var nodeConnectionsOfTargetNodeToDistributeTo = uncheckedNodeConnection.targetNode.getNodeConnectionsWithUnconfirmedEnergyDistributions();
            if (nodeConnectionsOfTargetNodeToDistributeTo.length == 1) {
                // Only 1 unconfirmed nodeConnection on the targetNode. We can confirm that nodeConnection too!
                var nodeConnection = nodeConnectionsOfTargetNodeToDistributeTo[0];
                nodeConnection.energyDistributions.confirmed = true;
                // The total energy of that outgoing connection from targetNode is going to be the incoming energy of targetNode + whatever energy targetNode should be distributing/getting
                nodeConnection.energyDistributions.total = uncheckedNodeConnection.energyDistributions.total + (uncheckedNodeConnection.targetNode.calulateEnergyPosition() - averageEnergyPosition);
                nodeConnection.targetNode.nodeConnectionsByIndex[nodeConnection.sourceNode.id].confirmed = true;
                nodeConnection.targetNode.nodeConnectionsByIndex[nodeConnection.sourceNode.id].total = nodeConnection.energyDistributions.total * -1;
                // Now ensure that we also check this newly confirmed nodeConnection for forward confirmation
                uncheckedNodeConnectionsThatHaveConfirmedEnergyDistribution.push(nodeConnection);
            }
        }

        // Second, under-distribute all the energyDistributions
        // Continue until the largest distribution is < 1, i.e. any extra redistribution would not make much of a difference anymore
        //while(biggestEnergyChange > 1) {
            // TODO: don't send energy to nodes where we also *received* energy from the same originalSourceNode
            //biggestEnergyChange = 0;
        //

        // Lastly, execute the energyDistribution and add/subtract from the energy levels of the nodes
        nodesList.forEach(function(sourceNode, sourceIndex) {
            // Loop over sourceNode nodeConnections
            Object.keys(sourceNode.nodeConnectionsByIndex).forEach(function(targetIndex) {
                var nodeConnection = sourceNode.nodeConnectionsByIndex[targetIndex];
                sourceNode.energy -= nodeConnection.energyDistributions.total;
            });
        });

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
