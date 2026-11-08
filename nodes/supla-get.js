'use strict';

module.exports = function (RED) {
    function SuplaGetNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.config = RED.nodes.getNode(config.config);
        node.targetType = config.targetType === 'group' ? 'group' : 'channel';
        node.target = config.target;

        node.on('input', async function (msg, send, done) {
            if (!node.config) {
                return done(RED._('supla-get.errors.noConfig'));
            }
            let type = node.targetType;
            let id = node.target;
            if (msg.target && typeof msg.target === 'object') {
                type = msg.target.type === 'group' ? 'group' : 'channel';
                id = msg.target.id;
            } else if (msg.channelId !== undefined) {
                type = 'channel';
                id = msg.channelId;
            }
            if (!(Number(id) > 0)) {
                return done(RED._('supla-get.errors.noTarget'));
            }
            try {
                const rest = node.config.rest;
                const item = type === 'group' ? await rest.groupWithState(id) : await rest.channelWithState(id);
                const state = Object.assign({}, item.state || {});
                if (item.connected !== undefined && state.connected === undefined) {
                    state.connected = item.connected;
                }
                msg.topic = 'supla/' + type + '/' + item.id;
                msg.payload = state;
                msg.channel = {
                    id: item.id,
                    type,
                    deviceId: item.iodeviceId,
                    caption: item.caption,
                    function: item.function ? item.function.name : undefined,
                };
                node.status({fill: state.connected === false ? 'grey' : 'green', shape: 'dot',
                    text: new Date().toLocaleTimeString()});
                send(msg);
                done();
            } catch (err) {
                node.status({fill: 'red', shape: 'ring', text: err.message});
                done(err);
            }
        });
    }

    RED.nodes.registerType('supla-get', SuplaGetNode);
};
