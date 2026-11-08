'use strict';

const EventEmitter = require('events');
const {SuplaRest} = require('../lib/rest');
const {MqttSource} = require('../lib/mqtt-source');
const {PollSource} = require('../lib/poll-source');

module.exports = function (RED) {
    function isTrue(value) {
        return /^(1|true|yes|on)$/i.test(String(value || '').trim());
    }

    // Settings come from the node, or from environment variables when
    // "fromEnv" is set (for ready-made installs, e.g. SuplaOS):
    // SUPLA_TOKEN, SUPLA_SERVER, SUPLA_TLS_INSECURE, SUPLA_MQTT_URL,
    // SUPLA_MQTT_USERNAME, SUPLA_MQTT_PASSWORD, SUPLA_MQTT_PREFIX, SUPLA_SUID.
    // Without SUPLA_MQTT_URL the state is polled from the Cloud.
    function resolveSettings(config, credentials, env) {
        credentials = credentials || {};
        if (!config.fromEnv) {
            return {
                token: credentials.token,
                server: config.server,
                insecure: !!config.restInsecure,
                stateSource: config.stateSource || 'mqtt',
                pollInterval: config.pollInterval,
                mqttHost: config.mqttHost,
                mqttPort: Number(config.mqttPort) || undefined,
                mqttTls: !!config.mqttTls,
                mqttInsecure: !!config.mqttInsecure,
                mqttUsername: (config.mqttUsername || '').trim(),
                mqttPassword: credentials.mqttPassword,
                mqttPrefix: config.mqttPrefix,
                suid: (config.suid || '').trim(),
            };
        }
        const settings = {
            token: env('SUPLA_TOKEN'),
            server: env('SUPLA_SERVER'),
            insecure: isTrue(env('SUPLA_TLS_INSECURE')),
            stateSource: 'poll',
            pollInterval: config.pollInterval,
            mqttUsername: (env('SUPLA_MQTT_USERNAME') || '').trim(),
            mqttPassword: env('SUPLA_MQTT_PASSWORD'),
            mqttPrefix: env('SUPLA_MQTT_PREFIX'),
            mqttInsecure: isTrue(env('SUPLA_TLS_INSECURE')),
            suid: (env('SUPLA_SUID') || '').trim(),
        };
        const url = (env('SUPLA_MQTT_URL') || '').trim();
        if (url) {
            try {
                const u = new URL(url);
                settings.stateSource = 'mqtt';
                settings.mqttTls = u.protocol === 'mqtts:' || u.protocol === 'ssl:';
                settings.mqttHost = u.hostname;
                settings.mqttPort = Number(u.port) || undefined;
                if (!settings.mqttUsername && u.username) {
                    settings.mqttUsername = decodeURIComponent(u.username);
                }
                if (!settings.mqttPassword && u.password) {
                    settings.mqttPassword = decodeURIComponent(u.password);
                }
            } catch (e) {
                settings.error = 'SUPLA_MQTT_URL is not a valid URL';
            }
        }
        return settings;
    }

    function SuplaConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        const settings = resolveSettings(config, node.credentials,
            (name) => RED.util.evaluateNodeProperty(name, 'env', node));
        node.settings = settings;
        node.stateSource = settings.stateSource;
        node.rest = new SuplaRest({server: settings.server, token: settings.token, insecure: settings.insecure});
        node.events = new EventEmitter();
        node.events.setMaxListeners(0);
        node.users = new Set();
        node.source = null;
        node.status = {connected: false, text: 'not started'};
        if (settings.error) {
            node.error(settings.error);
        }

        node.startSource = async function () {
            if (node.source || node.stateSource === 'none') {
                return;
            }
            let source;
            if (node.stateSource === 'poll') {
                source = new PollSource(node.rest, {interval: settings.pollInterval});
            } else {
                // The broker may carry topics of many users (e.g. a shared
                // mosquitto account), so the user ID always comes from the
                // token or is set by hand, never from the MQTT login.
                let suid = settings.suid;
                if (!suid) {
                    try {
                        suid = (await node.rest.tokenInfo()).userShortUniqueId;
                    } catch (err) {
                        node.setStatus({connected: false, text: 'no user id: ' + err.message});
                        node.retry = setTimeout(() => node.startSource(), 30000);
                        return;
                    }
                }
                if (node.source || node.users.size === 0) {
                    return;
                }
                source = new MqttSource({
                    host: settings.mqttHost,
                    port: settings.mqttPort,
                    tls: settings.mqttTls,
                    rejectUnauthorized: !settings.mqttInsecure,
                    username: settings.mqttUsername || suid,
                    password: settings.mqttPassword,
                    prefix: settings.mqttPrefix,
                    suid,
                });
            }
            node.source = source;
            source.on('state', (e) => node.events.emit('state', e));
            source.on('trigger', (e) => node.events.emit('trigger', e));
            source.on('status', (s) => node.setStatus(s));
            source.start();
        };

        node.setStatus = function (status) {
            node.status = status;
            node.events.emit('status', status);
        };

        // Nodes that need live state register here; the source starts with the first one.
        node.register = function (user) {
            node.users.add(user);
            if (node.users.size === 1) {
                node.startSource();
            }
            return node.status;
        };

        node.deregister = function (user) {
            node.users.delete(user);
            if (node.users.size === 0) {
                return node.stopSource();
            }
            return Promise.resolve();
        };

        node.stopSource = function () {
            clearTimeout(node.retry);
            const source = node.source;
            node.source = null;
            node.status = {connected: false, text: 'stopped'};
            return source ? source.stop() : Promise.resolve();
        };

        node.getState = function (channelId) {
            return node.source ? node.source.getState(channelId) : undefined;
        };

        node.on('close', function (done) {
            node.users.clear();
            node.stopSource().then(() => done(), () => done());
        });
    }

    RED.nodes.registerType('supla-config', SuplaConfigNode, {
        credentials: {
            token: {type: 'password'},
            mqttPassword: {type: 'password'},
        },
    });

    // Lists for the editor. The dialog sends its current server and token, so
    // the lists work before the configuration is deployed. "__PWRD__" means
    // the token was not changed and the stored one should be used.
    RED.httpAdmin.post('/supla/lookup/:what', RED.auth.needsPermission('supla-config.read'), async function (req, res) {
        const body = req.body || {};
        const deployed = body.id ? RED.nodes.getNode(body.id) : null;
        let rest;
        if (body.fromEnv) {
            const settings = resolveSettings({fromEnv: true}, {}, (name) => process.env[name]);
            rest = new SuplaRest({server: settings.server, token: settings.token, insecure: settings.insecure});
            if (!rest.token) {
                return res.status(400).json({message: 'SUPLA_TOKEN is not set'});
            }
        } else {
            let token = body.token;
            if (!token || token === '__PWRD__') {
                const creds = body.id ? RED.nodes.getCredentials(body.id) : null;
                token = creds && creds.token;
            }
            if (!token) {
                return res.status(400).json({message: 'No access token'});
            }
            rest = new SuplaRest({server: body.server, token, insecure: !!body.insecure});
        }
        if (deployed && deployed.rest.token === rest.token && deployed.rest.server === rest.server &&
            deployed.rest.insecure === rest.insecure) {
            rest = deployed.rest;
        }
        try {
            const force = body.refresh === true;
            let result;
            switch (req.params.what) {
                case 'channels':
                    result = (await rest.channels(force)).map((c) => ({
                        id: c.id,
                        caption: c.caption || '',
                        function: c.function ? c.function.name : '',
                        functionCaption: c.function ? c.function.caption : '',
                        device: c.iodevice ? c.iodevice.name : '',
                        location: c.location ? c.location.caption : '',
                        actions: (c.possibleActions || []).map((a) => a.name),
                    }));
                    break;
                case 'groups':
                    result = (await rest.groups(force)).map((g) => ({
                        id: g.id,
                        caption: g.caption || '',
                        function: g.function ? g.function.name : '',
                        functionCaption: g.function ? g.function.caption : '',
                        location: g.location ? g.location.caption : '',
                        actions: (g.possibleActions || []).map((a) => a.name),
                    }));
                    break;
                case 'scenes':
                    result = (await rest.scenes(force)).map((s) => ({
                        id: s.id,
                        caption: s.caption || '',
                        location: s.location ? s.location.caption : '',
                        actions: (s.possibleActions || []).map((a) => a.name),
                    }));
                    break;
                case 'check': {
                    const info = await rest.tokenInfo(true);
                    result = {server: rest.server, suid: info.userShortUniqueId, scope: info.scope};
                    break;
                }
                default:
                    return res.status(404).json({message: 'Unknown list'});
            }
            res.json(result);
        } catch (err) {
            res.status(err.status && err.status >= 400 ? err.status : 502).json({message: err.message});
        }
    });
};
