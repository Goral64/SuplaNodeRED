'use strict';

module.exports = function (RED) {
    function SuplaInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.config = RED.nodes.getNode(config.config);
        const channels = new Set((config.channels || []).map(Number).filter((n) => n > 0));
        const properties = String(config.properties || '').split(',').map((s) => s.trim()).filter(Boolean);
        const sendInitial = !!config.sendInitial;
        const previous = new Map();

        if (!node.config) {
            node.status({fill: 'red', shape: 'ring', text: RED._('supla-in.errors.noConfig')});
            return;
        }
        if (node.config.stateSource === 'none') {
            node.status({fill: 'red', shape: 'ring', text: RED._('supla-in.errors.noSource')});
            return;
        }

        function showStatus(s) {
            node.status(s.connected
                ? {fill: 'green', shape: 'dot', text: s.text}
                : {fill: 'red', shape: 'ring', text: s.text});
        }

        function onState(e) {
            if (channels.size && !channels.has(e.channelId)) {
                return;
            }
            const prev = previous.get(e.channelId);
            previous.set(e.channelId, e.state);
            if (e.initial && !sendInitial) {
                return;
            }
            if (properties.length && !e.initial && !e.changed.some((k) => properties.includes(k))) {
                return;
            }
            node.send({
                topic: 'supla/channel/' + e.channelId,
                payload: e.state,
                previous: prev,
                changed: e.changed,
                initial: e.initial,
                channel: e.channel,
            });
        }

        node.config.events.on('state', onState);
        node.config.events.on('status', showStatus);
        showStatus(node.config.register(node));

        node.on('close', function (done) {
            node.config.events.removeListener('state', onState);
            node.config.events.removeListener('status', showStatus);
            node.config.deregister(node).then(() => done(), () => done());
        });
    }

    RED.nodes.registerType('supla-in', SuplaInNode);
};
