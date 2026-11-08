'use strict';

const {fromPayload, normalizeAction} = require('../lib/actions');

module.exports = function (RED) {
    function SuplaOutNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.config = RED.nodes.getNode(config.config);
        node.targetType = config.targetType || 'channel';
        node.target = config.target;
        node.action = config.action || '';
        let fixedParams = {};
        if (config.params && config.params.trim()) {
            try {
                fixedParams = JSON.parse(config.params);
            } catch (e) {
                node.error(RED._('supla-out.errors.badParams') + ': ' + e.message);
            }
        }

        async function functionOf(type, id) {
            const rest = node.config.rest;
            if (type === 'channel') {
                const ch = await rest.channel(id);
                return ch && ch.function ? ch.function.name : '';
            }
            if (type === 'group') {
                const g = (await rest.groups()).find((x) => x.id === Number(id));
                return g && g.function ? g.function.name : '';
            }
            return '';
        }

        node.on('input', async function (msg, send, done) {
            if (!node.config) {
                return done(RED._('supla-out.errors.noConfig'));
            }
            let type = node.targetType;
            let id = node.target;
            if (msg.target && typeof msg.target === 'object') {
                type = msg.target.type || type;
                id = msg.target.id !== undefined ? msg.target.id : id;
            } else if (msg.channelId !== undefined && (type === 'channel' || type === 'msg')) {
                type = 'channel';
                id = msg.channelId;
            }
            if (!['channel', 'group', 'scene'].includes(type) || !(Number(id) > 0)) {
                return done(RED._('supla-out.errors.noTarget'));
            }
            try {
                let action;
                let params = Object.assign({}, fixedParams);
                if (msg.action) {
                    action = normalizeAction(msg.action);
                } else if (node.action) {
                    action = node.action;
                } else {
                    const fn = await functionOf(type, id);
                    const derived = fromPayload(msg.payload, fn, type);
                    action = derived.action;
                    params = Object.assign(params, derived.params);
                }
                if (msg.params && typeof msg.params === 'object') {
                    params = Object.assign(params, msg.params);
                }
                node.status({fill: 'yellow', shape: 'dot', text: action});
                await node.config.rest.execute(type, id, action, params);
                node.status({fill: 'green', shape: 'dot', text: action + ' ' + new Date().toLocaleTimeString()});
                msg.supla = {type, id: Number(id), action, params};
                send(msg);
                done();
            } catch (err) {
                node.status({fill: 'red', shape: 'ring', text: err.message});
                done(err);
            }
        });
    }

    RED.nodes.registerType('supla-out', SuplaOutNode);
};
