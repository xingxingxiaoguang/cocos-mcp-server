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
                    errorCount: errorCount,
                    uptime: Math.round((Date.now() - startTime) / 1000)
                }
            });
        } catch (err) {
            send({ type: 'response', id: id, success: false, error: err.message || String(err) });
        }
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

    // ---- Start ----
    connect();
    origConsole.log('[CocosMCP] Runtime debug agent loaded, connecting to ' + WS_URL);
})();
