/**
 * This module manages the Zed sandbox, the sandbox is used to run user
 * provided code, either fetched from the Zed code base itself, or fetched
 * from remote URLs.
 *
 * Sandboxed code cannot crash Zed itself, but can call some Zed-specific APIs.
 * These APIs live in the "zed/*" require.js namespace in the sandbox, and are
 * essentially proxies proxying the request to Zed itself via postMessage
 * communication. The APIs interfaces are defined in sandbox/interface/zed/*
 * and the Zed side is implemented in sandbox/impl/zed/*.
 */
/*global define, $, _ */
define(function(require, exports, module) {
    plugin.consumes = ["command"];
    plugin.provides = ["sandbox"];
    return plugin;

    function plugin(options, imports, register) {
        var command = imports.command;

        var sandboxWorker;
        var id;
        var waitingForReply;
        var inputables = {};

        var api = {
            defineInputable: function(name, fn) {
                inputables[name] = fn;
            },
            getInputable: function(session, name) {
                return inputables[name] && inputables[name](session);
            },
            /**
             * Programmatically call a sandbox command, the spec argument has the following keys:
             * - scriptUrl: the URL (http, https or relative local path) of the require.js module
             *   that implements the command
             * Any other arguments added in spec are passed along as the first argument to the
             * module which is executed as a function.
             */
            execCommand: function(name, spec, session) {
                return new Promise(function(resolve, reject) {
                    if (session.$cmdInfo) {
                        spec = _.extend({}, spec, session.$cmdInfo);
                        session.$cmdInfo = null;
                    }
                    id++;
                    waitingForReply[id] = function(err, result) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }
                    };
                    var scriptUrl = spec.scriptUrl;
                    if (scriptUrl[0] === "/") {
                        scriptUrl = "configfs!" + scriptUrl;
                    }
                    // This data can be requested as input in commands.json
                    var inputs = {};
                    for (var input in (spec.inputs || {})) {
                        inputs[input] = api.getInputable(session, input);
                    }
                    sandboxWorker.postMessage({
                        url: scriptUrl,
                        data: _.extend({}, spec, {
                            path: session.filename,
                            inputs: inputs
                        }),
                        id: id
                    });
                })
            }
        };

        /**
         * If we would like to reset our sandbox (e.d. to reload code), we can
         * simply delete and readd the iframe.
         */
        function resetSandbox() {
            if (sandboxWorker) {
                sandboxWorker.terminate();
            }
            console.log("Starting web worker");
            sandboxWorker = new Worker("js/sandbox_webworker.js");
            sandboxWorker.onmessage = function(event) {
                var data = event.data;
                var replyTo = data.replyTo;
                if (data.type === "request") {
                    return handleApiRequest(event);
                }
                if (data.type === "log") {
                    console[data.level]("[Sandbox]", data.message);
                }
                if (!replyTo) {
                    return;
                }
                var err = data.err;
                var result = data.result;

                if (waitingForReply[replyTo]) {
                    waitingForReply[replyTo](err, result);
                    delete waitingForReply[replyTo];
                } else {
                    console.error("Got response to unknown message id:", replyTo);
                }
            };
            waitingForReply = {};
            id = 0;
        }

        resetSandbox();

        /**
         * Handle a request coming from within the sandbox, and send back a response
         */
        function handleApiRequest(event) {
            var data = event.data;
            require(["./sandbox/" + data.module], function(mod) {
                if (!mod[data.call]) {
                    return sandboxWorker.postMessage({
                        replyTo: data.id,
                        err: "No such method: " + mod
                    });
                }
                mod[data.call].apply(mod, data.args).then(function(result) {
                    sandboxWorker.postMessage({
                        replyTo: data.id,
                        result: result
                    });
                }, function(err) {
                    sandboxWorker.postMessage({
                        replyTo: data.id,
                        err: err
                    });
                });
            });
        }

        window.execSandboxApi = function(api, args, callback) {
            var parts = api.split('.');
            var mod = parts.slice(0, parts.length - 1).join('/');
            var call = parts[parts.length - 1];
            return new Promise(function(resolve, reject) {
                require(["./sandbox/" + mod], function(mod) {
                    if (!mod[call]) {
                        return callback("No such method: " + call);
                    }
                    mod[call].apply(this, args).then(resolve, reject);
                });
            });
        };

        command.define("Sandbox:Reset", {
            doc: "Reload all sandbox code. If you've made changes to a Zed " + "extension in your sandbox, you must run this for those changes " + "to take effect.",
            exec: resetSandbox,
            readOnly: true
        });

        register(null, {
            sandbox: api
        });
    }
});
