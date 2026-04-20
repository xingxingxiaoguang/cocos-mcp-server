/**
 * Cocos Creator MCP — Runtime Debug Agent
 *
 * This script is injected into the Preview browser. It establishes a WebSocket
 * connection back to the MCP plugin's RuntimeBridge and provides:
 *   - Console log forwarding
 *   - Remote script execution
 *   - Runtime summary collection (FPS, drawCalls, node count, etc.)
 *
 * The placeholder __PORT__ is replaced at serve-time by the actual MCP server port.
 */
(function () {
    'use strict';

    if (window.__COCOS_MCP_AGENT__) return; // prevent double-init
    window.__COCOS_MCP_AGENT__ = true;

    var PORT = '__PORT__';
    var WS_URL = 'ws://127.0.0.1:' + PORT + '/runtime';
    var RECONNECT_INTERVAL = 3000;
    var ws = null;
    var errorCount = 0;
    var startTime = Date.now();

    // ---- WebSocket connection ----

    function connect() {
        try {
            ws = new WebSocket(WS_URL);
        } catch (e) {
            scheduleReconnect();
            return;
        }

        ws.onopen = function () {
            ws.send(JSON.stringify({
                type: 'ready',
                info: {
                    url: location.href,
                    userAgent: navigator.userAgent
                }
            }));
        };

        ws.onmessage = function (event) {
            try {
                var msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                // ignore
            }
        };

        ws.onclose = function () {
            ws = null;
            stopAllSubscriptions();
            scheduleReconnect();
        };

        ws.onerror = function () {
            // onclose will fire after onerror
        };
    }

    function scheduleReconnect() {
        setTimeout(connect, RECONNECT_INTERVAL);
    }

    function send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    }

    // ---- Console hook ----

    var origConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
    };

    function hookConsole(level) {
        console[level] = function () {
            // Forward to original
            origConsole[level].apply(console, arguments);

            // Build content string
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                try {
                    parts.push(typeof arguments[i] === 'object' ? JSON.stringify(arguments[i]) : String(arguments[i]));
                } catch (e) {
                    parts.push('[unserializable]');
                }
            }

            send({
                type: 'log',
                level: level,
                content: parts.join(' '),
                timestamp: new Date().toISOString()
            });

            if (level === 'error') errorCount++;
        };
    }

    hookConsole('log');
    hookConsole('warn');
    hookConsole('error');
    hookConsole('info');

    // Also capture unhandled errors
    window.addEventListener('error', function (event) {
        errorCount++;
        send({
            type: 'log',
            level: 'error',
            content: '[Uncaught] ' + (event.message || '') + ' at ' + (event.filename || '') + ':' + (event.lineno || ''),
            timestamp: new Date().toISOString()
        });
    });

    window.addEventListener('unhandledrejection', function (event) {
        errorCount++;
        var reason = event.reason;
        var content = '[UnhandledRejection] ' + (reason instanceof Error ? reason.message : String(reason));
        send({
            type: 'log',
            level: 'error',
            content: content,
            timestamp: new Date().toISOString()
        });
    });

    // ---- Message handler ----

    function handleMessage(msg) {
        switch (msg.type) {
            case 'execute':
                executeScript(msg.id, msg.script);
                break;
            case 'get_summary':
                sendSummary(msg.id);
                break;
            case 'subscribe':
                startSubscription(msg.subId, msg.options);
                break;
            case 'unsubscribe':
                stopSubscription(msg.subId);
                break;
        }
    }

    // ---- Execute ----

    function executeScript(id, script) {
        try {
            var fn = new Function('cc', 'return (async function(){ ' + script + ' })()');
            var cc = window.cc || (typeof require === 'function' ? require('cc') : null);
            var result = fn(cc);

            // Handle promise
            if (result && typeof result.then === 'function') {
                result.then(function (val) {
                    send({ type: 'response', id: id, success: true, data: safeClone(val) });
                }).catch(function (err) {
                    send({ type: 'response', id: id, success: false, error: err.message || String(err) });
                });
            } else {
                send({ type: 'response', id: id, success: true, data: safeClone(result) });
            }
        } catch (err) {
            send({ type: 'response', id: id, success: false, error: err.message || String(err) });
        }
    }

    // ---- Summary ----

    function sendSummary(id) {
        try {
            var cc = window.cc || (typeof require === 'function' ? require('cc') : null);
            if (!cc || !cc.director) {
                send({ type: 'response', id: id, success: false, error: 'cc.director not available' });
                return;
            }

            var scene = cc.director.getScene();
            var nodeCount = 0;
            var activeNodeCount = 0;
            var componentCount = 0;

            if (scene) {
                traverseNode(scene, function (node) {
                    nodeCount++;
                    if (node.active) activeNodeCount++;
                    if (node.components) componentCount += node.components.length;
                });
            }

            // Try to get rendering stats from the root/pipeline
            var root = cc.director.root;
            var drawCalls = 0;
            var triangles = 0;
            var fps = 0;

            if (root && root.device) {
                // Cocos 3.x: root.device.numDrawCalls / numInstances / numTris
                drawCalls = root.device.numDrawCalls || 0;
                triangles = root.device.numTris || 0;
            }

            // FPS: use public API getDeltaTime() instead of private _frameTime/_deltaTime
            var dt = typeof cc.director.getDeltaTime === 'function' ? cc.director.getDeltaTime() : 0;
            if (dt > 0) {
                fps = Math.round(1 / dt);
            }

            var memory = { jsHeapUsed: 0, jsHeapTotal: 0 };
            if (window.performance && performance.memory) {
                memory.jsHeapUsed = performance.memory.usedJSHeapSize || 0;
                memory.jsHeapTotal = performance.memory.totalJSHeapSize || 0;
            }

            // Collect physics system info
            var physics = collectPhysicsInfo(cc);

            send({
                type: 'response',
                id: id,
                success: true,
                data: {
                    fps: fps,
                    drawCalls: drawCalls,
                    triangles: triangles,
                    nodeCount: nodeCount,
                    activeNodeCount: activeNodeCount,
                    componentCount: componentCount,
                    currentScene: scene ? scene.name : null,
                    memory: memory,
                    physics: physics,
                    errorCount: errorCount,
                    uptime: Math.round((Date.now() - startTime) / 1000)
                }
            });
        } catch (err) {
            send({ type: 'response', id: id, success: false, error: err.message || String(err) });
        }
    }

    function collectPhysicsInfo(cc) {
        var result = { enabled: false, type: null, gravity: null, ptmRatio: null, allowSleep: null, fixedTimeStep: null, velocityIterations: null, positionIterations: null };
        try {
            // Walk _systems to find the physics system (it's not directly on cc)
            var systems = cc.director._systems;
            if (!systems) return result;
            var phys = null;
            for (var i = 0; i < systems.length; i++) {
                var s = systems[i];
                var name = s.constructor ? s.constructor.name : '';
                if (name === 'PhysicsSystem2D' || name === 'PhysicsSystem') {
                    phys = s;
                    break;
                }
            }
            if (!phys) return result;

            var is2D = phys.constructor.name === 'PhysicsSystem2D';
            result.enabled = phys.enabled !== false;
            result.type = is2D ? '2D' : '3D';

            // Gravity — Vec3 for 3D, Vec2 for 2D
            if (phys.gravity) {
                var g = phys.gravity;
                result.gravity = { x: g.x || 0, y: g.y || 0, z: g.z || 0 };
            }

            // 2D-specific properties
            if (is2D) {
                if (phys.ptmRatio !== undefined) result.ptmRatio = phys.ptmRatio;
                if (phys.allowSleep !== undefined) result.allowSleep = phys.allowSleep;
                if (phys.fixedTimeStep !== undefined) result.fixedTimeStep = phys.fixedTimeStep;
                if (phys.velocityIterations !== undefined) result.velocityIterations = phys.velocityIterations;
                if (phys.positionIterations !== undefined) result.positionIterations = phys.positionIterations;
            }
        } catch (e) { /* physics info unavailable */ }
        return result;
    }

    function traverseNode(node, callback) {
        callback(node);
        var children = node.children;
        if (children) {
            for (var i = 0; i < children.length; i++) {
                traverseNode(children[i], callback);
            }
        }
    }

    // ---- Safe clone (avoid circular refs) ----

    function safeClone(obj, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 4) return '[max depth]';
        if (obj === null || obj === undefined) return obj;
        var t = typeof obj;
        if (t === 'number' || t === 'string' || t === 'boolean') return obj;
        if (t === 'function') return '[Function]';

        if (Array.isArray(obj)) {
            var arr = [];
            for (var i = 0; i < Math.min(obj.length, 100); i++) {
                arr.push(safeClone(obj[i], depth + 1));
            }
            return arr;
        }

        if (t === 'object') {
            // Try JSON round-trip first
            try {
                var json = JSON.stringify(obj);
                if (json && json.length < 10000) return JSON.parse(json);
            } catch (e) { /* fall through */ }

            var result = {};
            var keys = Object.keys(obj);
            for (var k = 0; k < Math.min(keys.length, 50); k++) {
                try {
                    var val = obj[keys[k]];
                    if (typeof val !== 'function') {
                        result[keys[k]] = safeClone(val, depth + 1);
                    }
                } catch (e) { /* skip */ }
            }
            return result;
        }

        return String(obj);
    }

    // ---- Subscription engine ----

    var subscriptions = {};
    var subscriptionTickRegistered = false;
    var tickCallback = null;
    var lastTickTime = 0;
    var fallbackTimer = null;
    var FALLBACK_CHECK_INTERVAL = 2000;  // check every 2s
    var FALLBACK_STALE_THRESHOLD = 3000; // consider stale after 3s

    function startSubscription(subId, options) {
        var cc = window.cc || (typeof require === 'function' ? require('cc') : null);
        if (!cc || !cc.director) {
            send({ type: 'subscription_error', subId: subId, error: 'cc.director not available' });
            return;
        }

        var sub = {
            id: subId,
            type: options.type || 'node_watch',
            properties: options.properties || ['position', 'rotation', 'scale'],
            threshold: options.threshold || 0,
            interval: options.interval || 100,
            duration: options.duration || 0,
            nodeFilter: options.nodeFilter || {},
            collisionEvents: options.collisionEvents || ['onCollisionEnter'],
            lastPush: 0,
            lastValues: {},
            durationTimer: null,
            collisionHandlers: []
        };

        subscriptions[subId] = sub;

        if (sub.duration > 0) {
            sub.durationTimer = setTimeout(function () {
                stopSubscription(subId);
                send({
                    type: 'event', subId: subId, subType: sub.type,
                    timestamp: new Date().toISOString(),
                    data: { _meta: 'subscription_expired', reason: 'duration' }
                });
            }, sub.duration * 1000);
        }

        if (sub.type === 'collision') {
            setupCollisionSubscription(sub, cc);
        }

        ensureTickRegistered(cc);
    }

    function stopSubscription(subId) {
        var sub = subscriptions[subId];
        if (!sub) return;
        if (sub.durationTimer) clearTimeout(sub.durationTimer);
        if (sub.collisionHandlers) {
            for (var i = 0; i < sub.collisionHandlers.length; i++) {
                var h = sub.collisionHandlers[i];
                try { if (h.collider && h.collider.isValid) h.collider.off(h.event, h.handler); }
                catch (e) { /* node may be destroyed */ }
            }
        }
        delete subscriptions[subId];
        if (Object.keys(subscriptions).length === 0) unregisterTick();
    }

    function stopAllSubscriptions() {
        var ids = Object.keys(subscriptions);
        for (var i = 0; i < ids.length; i++) stopSubscription(ids[i]);
        stopFallbackWatchdog();
    }

    function ensureTickRegistered(cc) {
        if (subscriptionTickRegistered) return;
        var Director = cc.Director || cc.director.constructor;
        tickCallback = function () { subscriptionTick(cc); };
        cc.director.on(Director.EVENT_AFTER_UPDATE, tickCallback);
        subscriptionTickRegistered = true;
        startFallbackWatchdog(cc);
    }

    function unregisterTick() {
        if (!subscriptionTickRegistered) return;
        var cc = window.cc || (typeof require === 'function' ? require('cc') : null);
        if (cc && cc.director) {
            var Director = cc.Director || cc.director.constructor;
            cc.director.off(Director.EVENT_AFTER_UPDATE, tickCallback);
        }
        tickCallback = null;
        subscriptionTickRegistered = false;
        stopFallbackWatchdog();
    }

    function startFallbackWatchdog(cc) {
        if (fallbackTimer) return;
        fallbackTimer = setInterval(function () {
            // No active subscriptions — nothing to watch
            if (Object.keys(subscriptions).length === 0) return;

            var now = Date.now();
            // Tick is still fresh — game loop is running normally
            if (now - lastTickTime < FALLBACK_STALE_THRESHOLD) return;

            // Check if game is paused
            var isPaused = false;
            try {
                isPaused = cc.game && typeof cc.game.isPaused === 'function' && cc.game.isPaused();
            } catch (e) { /* ignore */ }

            if (isPaused) {
                // Drive subscriptionTick via timer fallback
                subscriptionTick(cc);
            }
        }, FALLBACK_CHECK_INTERVAL);
    }

    function stopFallbackWatchdog() {
        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
    }

    function subscriptionTick(cc) {
        var now = Date.now();
        lastTickTime = now;
        var ids = Object.keys(subscriptions);

        for (var i = 0; i < ids.length; i++) {
            var sub = subscriptions[ids[i]];
            if (!sub || sub.type !== 'node_watch') continue;
            if (now - sub.lastPush < sub.interval) continue;

            var nodes = findMatchingNodes(cc, sub.nodeFilter);
            if (nodes.length === 0) continue;

            var events = [];
            for (var n = 0; n < nodes.length; n++) {
                var node = nodes[n];
                if (!node || !node.isValid) continue;

                var nodeKey = node.uuid || node.name;
                var sampled = sampleNodeProperties(node, sub.properties);

                if (sub.threshold > 0) {
                    var prev = sub.lastValues[nodeKey];
                    if (prev && !hasChangedBeyondThreshold(prev, sampled, sub.threshold)) continue;
                }

                sub.lastValues[nodeKey] = sampled;
                events.push({ nodeId: nodeKey, nodeName: node.name, data: sampled });
            }

            if (events.length > 0) {
                sub.lastPush = now;
                send({
                    type: 'event',
                    subId: sub.id,
                    subType: 'node_watch',
                    timestamp: new Date().toISOString(),
                    events: events
                });
            }
        }
    }

    function findMatchingNodes(cc, filter) {
        var scene = cc.director.getScene();
        if (!scene) return [];

        if (filter.uuid) {
            var found = [];
            traverseNode(scene, function (node) {
                if (node.uuid === filter.uuid) found.push(node);
            });
            return found;
        }

        if (filter.path) {
            var node = findNodeByPath(scene, filter.path);
            return node ? [node] : [];
        }

        if (filter.name) {
            var matches = [];
            var nameFilter = filter.name;
            traverseNode(scene, function (node) {
                if (node.name && node.name.indexOf(nameFilter) !== -1) matches.push(node);
            });
            return matches.slice(0, 20);
        }

        return [];
    }

    function findNodeByPath(root, pathStr) {
        var parts = pathStr.split('/');
        var current = root;
        for (var i = 0; i < parts.length; i++) {
            if (!current || !current.children) return null;
            var found = null;
            for (var c = 0; c < current.children.length; c++) {
                if (current.children[c].name === parts[i]) { found = current.children[c]; break; }
            }
            if (!found) return null;
            current = found;
        }
        return current;
    }

    function sampleNodeProperties(node, properties) {
        var result = {};
        for (var i = 0; i < properties.length; i++) {
            var prop = properties[i];
            try {
                switch (prop) {
                    case 'position':
                        var wp = node.worldPosition;
                        result.position = { x: wp.x, y: wp.y, z: wp.z };
                        break;
                    case 'localPosition':
                        var lp = node.position;
                        result.localPosition = { x: lp.x, y: lp.y, z: lp.z };
                        break;
                    case 'rotation':
                        var wr = node.worldRotation;
                        result.rotation = { x: wr.x, y: wr.y, z: wr.z, w: wr.w };
                        break;
                    case 'localRotation':
                        var lr = node.rotation;
                        result.localRotation = { x: lr.x, y: lr.y, z: lr.z, w: lr.w };
                        break;
                    case 'scale':
                        var ws = node.worldScale;
                        result.scale = { x: ws.x, y: ws.y, z: ws.z };
                        break;
                    case 'localScale':
                        var ls = node.scale;
                        result.localScale = { x: ls.x, y: ls.y, z: ls.z };
                        break;
                    case 'active':
                        result.active = node.active;
                        break;
                    case 'eulerAngles':
                        var ea = node.eulerAngles;
                        result.eulerAngles = { x: ea.x, y: ea.y, z: ea.z };
                        break;
                    case 'childCount':
                        result.childCount = node.children ? node.children.length : 0;
                        break;
                    default:
                        var val = node[prop];
                        if (val !== undefined && typeof val !== 'function') {
                            result[prop] = safeClone(val, 2);
                        }
                        break;
                }
            } catch (e) {
                result[prop] = '[error: ' + e.message + ']';
            }
        }
        return result;
    }

    function hasChangedBeyondThreshold(prevValues, currentValues, threshold) {
        var keys = Object.keys(currentValues);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var prev = prevValues[key];
            var curr = currentValues[key];

            if (prev === undefined) return true;

            if (typeof curr === 'object' && curr !== null && typeof prev === 'object' && prev !== null) {
                var components = Object.keys(curr);
                for (var c = 0; c < components.length; c++) {
                    var comp = components[c];
                    if (typeof curr[comp] === 'number' && typeof prev[comp] === 'number') {
                        if (Math.abs(curr[comp] - prev[comp]) > threshold) return true;
                    }
                }
            } else if (typeof curr === 'number' && typeof prev === 'number') {
                if (Math.abs(curr - prev) > threshold) return true;
            } else if (curr !== prev) {
                return true;
            }
        }
        return false;
    }

    function setupCollisionSubscription(sub, cc) {
        var nodes = findMatchingNodes(cc, sub.nodeFilter);

        for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            if (!node || !node.isValid) continue;

            var colliders = [];
            try { colliders = colliders.concat(node.getComponents('cc.Collider2D') || []); } catch (e) {}
            try { colliders = colliders.concat(node.getComponents('cc.Collider') || []); } catch (e) {}

            for (var ci = 0; ci < colliders.length; ci++) {
                var collider = colliders[ci];
                for (var ei = 0; ei < sub.collisionEvents.length; ei++) {
                    (function (subRef, eventName, col, nodeRef) {
                        var handler = function (selfCollider, otherCollider) {
                            var now = Date.now();
                            if (now - subRef.lastPush < subRef.interval) return;
                            subRef.lastPush = now;

                            send({
                                type: 'event',
                                subId: subRef.id,
                                subType: 'collision',
                                timestamp: new Date().toISOString(),
                                nodeId: nodeRef.uuid || nodeRef.name,
                                data: {
                                    event: eventName,
                                    selfNode: nodeRef.name,
                                    otherNode: otherCollider && otherCollider.node ? otherCollider.node.name : 'unknown',
                                    selfPosition: nodeRef.worldPosition ? {
                                        x: nodeRef.worldPosition.x,
                                        y: nodeRef.worldPosition.y,
                                        z: nodeRef.worldPosition.z
                                    } : null
                                }
                            });
                        };
                        col.on(eventName, handler);
                        subRef.collisionHandlers.push({ collider: col, event: eventName, handler: handler });
                    })(sub, sub.collisionEvents[ei], collider, node);
                }
            }
        }
    }

    // Auto-cleanup subscriptions on scene change
    (function () {
        var check = setInterval(function () {
            var cc = window.cc || (typeof require === 'function' ? require('cc') : null);
            if (cc && cc.director) {
                clearInterval(check);
                var Director = cc.Director || cc.director.constructor;
                cc.director.on(Director.EVENT_BEFORE_SCENE_LAUNCH, function () {
                    stopAllSubscriptions();
                    send({
                        type: 'event', subId: '__system__',
                        timestamp: new Date().toISOString(),
                        data: { _meta: 'all_subscriptions_cleared', reason: 'scene_change' }
                    });

                    // Auto-resume game after scene launch — loadScene() calls game.pause() internally
                    cc.director.once(Director.EVENT_AFTER_SCENE_LAUNCH, function () {
                        try {
                            if (cc.game && typeof cc.game.isPaused === 'function' && cc.game.isPaused()) {
                                cc.game.resume();
                                send({
                                    type: 'event', subId: '__system__',
                                    timestamp: new Date().toISOString(),
                                    data: { _meta: 'game_auto_resumed', reason: 'after_scene_launch' }
                                });
                            }
                        } catch (e) { /* ignore */ }
                    });
                });
            }
        }, 500);
    })();

    // ---- Start ----
    connect();
    origConsole.log('[CocosMCP] Runtime debug agent loaded, connecting to ' + WS_URL);
})();
