'use strict';

module.exports = function (RED) {
    function SuplaTriggerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.config = RED.nodes.getNode(config.config);
        const channels = new Set((config.channels || []).map(Number).filter((n) => n > 0));
        const actions = String(config.actions || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

        if (!node.config) {
            node.status({fill: 'red', shape: 'ring', text: RED._('supla-trigger.errors.noConfig')});
            return;
        }
        if (node.config.stateSource !== 'mqtt') {
            node.status({fill: 'red', shape: 'ring', text: RED._('supla-trigger.errors.needsMqtt')});
            return;
        }

        function showStatus(s) {
            node.status(s.connected
                ? {fill: 'green', shape: 'dot', text: s.text}
                : {fill: 'red', shape: 'ring', text: s.text});
        }

        function onTrigger(e) {
            if (channels.size && !channels.has(e.channelId)) {
                return;
            }
            if (actions.length && !actions.includes(e.action)) {
                return;
            }
            node.status({fill: 'green', shape: 'dot', text: e.action + ' ' + new Date().toLocaleTimeString()});
            node.send({
                topic: 'supla/channel/' + e.channelId,
                payload: e.action,
                channel: e.channel,
            });
        }

        node.config.events.on('trigger', onTrigger);
        node.config.events.on('status', showStatus);
        showStatus(node.config.register(node));

        node.on('close', function (done) {
            node.config.events.removeListener('trigger', onTrigger);
            node.config.events.removeListener('status', showStatus);
            node.config.deregister(node).then(() => done(), () => done());
        });
    }

    RED.nodes.registerType('supla-trigger', SuplaTriggerNode);
};
