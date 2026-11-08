'use strict';

const assert = require('assert');
const net = require('net');
const mqtt = require('mqtt');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/supla-config');
const outNode = require('../nodes/supla-out');
const getNode = require('../nodes/supla-get');
const inNode = require('../nodes/supla-in');
const triggerNode = require('../nodes/supla-trigger');
const {createFakeCloud, CHANNELS} = require('./fake-cloud');

helper.init(require.resolve('node-red'));

const SUID = 'abc123';
const NODES = [configNode, outNode, getNode, inNode, triggerNode];

function waitFor(check, timeout) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function loop() {
            if (check()) {
                return resolve();
            }
            if (Date.now() - start > (timeout || 2000)) {
                return reject(new Error('timeout'));
            }
            setTimeout(loop, 10);
        })();
    });
}

describe('SUPLA nodes', function () {
    let cloud;
    let broker;
    let brokerServer;
    let brokerPort;

    before(async function () {
        const {Aedes} = await import('aedes');
        broker = await Aedes.createBroker();
        brokerServer = net.createServer(broker.handle);
        await new Promise((r) => brokerServer.listen(0, '127.0.0.1', r));
        brokerPort = brokerServer.address().port;
    });

    after(async function () {
        await new Promise((r) => brokerServer.close(() => r()));
        await new Promise((r) => broker.close(() => r()));
    });

    beforeEach(async function () {
        cloud = await createFakeCloud().start();
        cloud.on('GET', '/api/v3/channels', () => ({body: CHANNELS}));
        cloud.on('GET', '/api/v3/token-info', () => ({body: {userShortUniqueId: SUID, scope: 'channels_r'}}));
        await new Promise((r) => helper.startServer(r));
    });

    afterEach(async function () {
        await helper.unload();
        await new Promise((r) => helper.stopServer(r));
        await cloud.stop();
    });

    function config(extra) {
        return Object.assign({id: 'cfg', type: 'supla-config', stateSource: 'none'}, extra || {});
    }

    function mqttConfig() {
        return config({stateSource: 'mqtt', mqttHost: '127.0.0.1', mqttPort: brokerPort});
    }

    function creds() {
        return {cfg: {token: cloud.token}};
    }

    function publish(topic, payload, retain) {
        return new Promise((resolve, reject) => {
            const client = mqtt.connect('mqtt://127.0.0.1:' + brokerPort);
            client.on('connect', () => client.publish(topic, payload, {retain: !!retain}, (err) => {
                client.end();
                err ? reject(err) : resolve();
            }));
        });
    }

    it('supla-out turns a light on from a boolean payload', async function () {
        cloud.on('PATCH', '/api/v3/channels/101', () => ({status: 202}));
        const flow = [config(),
            {id: 'out', type: 'supla-out', config: 'cfg', targetType: 'channel', target: '101', wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const done = new Promise((resolve) => helper.getNode('h').on('input', resolve));
        helper.getNode('out').receive({payload: true});
        const msg = await done;
        assert.deepStrictEqual(msg.supla, {type: 'channel', id: 101, action: 'TURN_ON', params: {}});
        const patch = cloud.requests.find((r) => r.method === 'PATCH');
        assert.deepStrictEqual(patch.body, {action: 'TURN_ON'});
    });

    it('supla-out uses a fixed action, node params and msg.params', async function () {
        cloud.on('PATCH', '/api/v3/channels/102', () => ({status: 202}));
        const flow = [config(),
            {id: 'out', type: 'supla-out', config: 'cfg', targetType: 'channel', target: '102',
                action: 'SHUT_PARTIALLY', params: '{"percentage": 10}', wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const done = new Promise((resolve) => helper.getNode('h').on('input', resolve));
        helper.getNode('out').receive({payload: 'ignored', params: {tilt: 50}});
        await done;
        const patch = cloud.requests.find((r) => r.method === 'PATCH');
        assert.deepStrictEqual(patch.body, {percentage: 10, tilt: 50, action: 'SHUT_PARTIALLY'});
    });

    it('supla-out runs a scene from msg.target and reports Cloud errors', async function () {
        cloud.on('PATCH', '/api/v3/scenes/9', () => ({status: 202}));
        cloud.on('PATCH', '/api/v3/scenes/10', () => ({status: 400, body: {message: 'Scene disabled'}}));
        const flow = [config(),
            {id: 'out', type: 'supla-out', config: 'cfg', targetType: 'msg', wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const out = helper.getNode('out');
        const done = new Promise((resolve) => helper.getNode('h').on('input', resolve));
        out.receive({target: {type: 'scene', id: 9}});
        await done;
        assert.deepStrictEqual(cloud.requests.find((r) => r.path === '/api/v3/scenes/9').body, {action: 'EXECUTE'});
        out.receive({target: {type: 'scene', id: 10}});
        await waitFor(() => out.error.called || helper.log().args.some((a) => a[0] && a[0].level === 20));
        const logged = helper.log().args.filter((a) => a[0] && a[0].level === 20).map((a) => a[0].msg);
        assert.ok(logged.some((m) => /Scene disabled/.test(String(m))), 'error logged: ' + logged);
    });

    it('supla-get reads the channel state', async function () {
        cloud.on('GET', '/api/v3/channels/101', () => ({body: Object.assign({}, CHANNELS[0],
            {connected: true, state: {on: true, connected: true}})}));
        const flow = [config(),
            {id: 'get', type: 'supla-get', config: 'cfg', targetType: 'channel', target: '101', wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const done = new Promise((resolve) => helper.getNode('h').on('input', resolve));
        helper.getNode('get').receive({});
        const msg = await done;
        assert.strictEqual(msg.topic, 'supla/channel/101');
        assert.deepStrictEqual(msg.payload, {on: true, connected: true});
        assert.strictEqual(msg.channel.function, 'LIGHTSWITCH');
        assert.ok(cloud.requests.some((r) => r.url === '/api/v3/channels/101?include=state,connected'));
    });

    it('supla-in reports MQTT state changes', async function () {
        const base = 'supla/' + SUID + '/devices/5/channels/101/';
        await publish(base + 'state/on', 'false', true);
        await publish(base + 'state/connected', 'true', true);
        const flow = [mqttConfig(),
            {id: 'in', type: 'supla-in', config: 'cfg', channels: [101], properties: '', sendInitial: true,
                wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const msgs = [];
        helper.getNode('h').on('input', (m) => msgs.push(m));
        await waitFor(() => msgs.length === 1);
        assert.strictEqual(msgs[0].initial, true);
        assert.deepStrictEqual(msgs[0].payload, {on: false, connected: true, connectedCode: 'CONNECTED'});
        await publish(base + 'state/on', 'true', true);
        await publish('supla/' + SUID + '/devices/5/channels/102/state/shut', '40', true);
        await waitFor(() => msgs.length === 2);
        assert.strictEqual(msgs[1].initial, false);
        assert.deepStrictEqual(msgs[1].changed, ['on']);
        assert.strictEqual(msgs[1].previous.on, false);
        assert.strictEqual(msgs[1].payload.on, true);
        await new Promise((r) => setTimeout(r, 100));
        assert.strictEqual(msgs.length, 2, 'channel 102 is not selected');
        await publish(base + 'state/on', '', true);
        await publish(base + 'state/connected', '', true);
        await publish('supla/' + SUID + '/devices/5/channels/102/state/shut', '', true);
    });

    it('supla-in skips the start state and filters by property', async function () {
        const base = 'supla/' + SUID + '/devices/5/channels/101/';
        await publish(base + 'state/on', 'false', true);
        const flow = [mqttConfig(),
            {id: 'in', type: 'supla-in', config: 'cfg', channels: [], properties: 'connected', sendInitial: false,
                wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const msgs = [];
        helper.getNode('h').on('input', (m) => msgs.push(m));
        await waitFor(() => helper.getNode('cfg').status.connected);
        await new Promise((r) => setTimeout(r, 150));
        await publish(base + 'state/on', 'true');
        await new Promise((r) => setTimeout(r, 150));
        assert.strictEqual(msgs.length, 0);
        await publish(base + 'state/connected', 'false');
        await waitFor(() => msgs.length === 1);
        assert.strictEqual(msgs[0].payload.connectedCode, 'DISCONNECTED');
        await publish(base + 'state/on', '', true);
    });

    it('supla-trigger reports button actions', async function () {
        const flow = [mqttConfig(),
            {id: 'tr', type: 'supla-trigger', config: 'cfg', channels: [103], actions: 'press_x2,hold', wires: [['h']]},
            {id: 'h', type: 'helper'}];
        await helper.load(NODES, flow, creds());
        const msgs = [];
        helper.getNode('h').on('input', (m) => msgs.push(m));
        await waitFor(() => helper.getNode('cfg').status.connected);
        await new Promise((r) => setTimeout(r, 100));
        const base = 'supla/' + SUID + '/devices/6/channels/103/action/';
        await publish(base + 'press_x1', 'press_x1');
        await publish(base + 'press_x2', 'press_x2');
        await waitFor(() => msgs.length === 1);
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].payload, 'press_x2');
        assert.strictEqual(msgs[0].channel.id, 103);
    });

    describe('settings from environment variables', function () {
        const NAMES = ['SUPLA_TOKEN', 'SUPLA_SERVER', 'SUPLA_TLS_INSECURE', 'SUPLA_MQTT_URL', 'SUPLA_MQTT_USERNAME',
            'SUPLA_MQTT_PASSWORD', 'SUPLA_MQTT_PREFIX', 'SUPLA_SUID'];
        afterEach(function () {
            NAMES.forEach((n) => delete process.env[n]);
        });

        it('polls without SUPLA_MQTT_URL', async function () {
            process.env.SUPLA_TOKEN = cloud.token;
            process.env.SUPLA_TLS_INSECURE = '1';
            await helper.load(NODES, [config({fromEnv: true, stateSource: 'none', mqttHost: 'ignored'})], {});
            const cfg = helper.getNode('cfg');
            assert.strictEqual(cfg.stateSource, 'poll');
            assert.strictEqual(cfg.rest.server, cloud.url);
            assert.strictEqual(cfg.rest.insecure, true);
        });

        it('uses MQTT with a shared broker login and the user ID from the token', async function () {
            process.env.SUPLA_TOKEN = cloud.token;
            process.env.SUPLA_MQTT_URL = 'mqtt://127.0.0.1:' + brokerPort;
            process.env.SUPLA_MQTT_USERNAME = 'mosquitto-user';
            process.env.SUPLA_MQTT_PASSWORD = 'pw';
            const flow = [config({fromEnv: true}),
                {id: 'in', type: 'supla-in', config: 'cfg', channels: [101], properties: '', sendInitial: false,
                    wires: [['h']]},
                {id: 'h', type: 'helper'}];
            await helper.load(NODES, flow, {});
            const cfg = helper.getNode('cfg');
            assert.strictEqual(cfg.settings.mqttUsername, 'mosquitto-user');
            const msgs = [];
            helper.getNode('h').on('input', (m) => msgs.push(m));
            await waitFor(() => cfg.status.connected);
            await new Promise((r) => setTimeout(r, 100));
            await publish('supla/someoneelse/devices/5/channels/101/state/on', 'true');
            await publish('supla/' + SUID + '/devices/5/channels/101/state/on', 'true');
            await waitFor(() => msgs.length === 1);
            await new Promise((r) => setTimeout(r, 100));
            assert.strictEqual(msgs.length, 1);
            assert.strictEqual(cfg.source.client.options.username, 'mosquitto-user');
        });

        it('lists channels for the editor from the environment', async function () {
            process.env.SUPLA_TOKEN = cloud.token;
            await helper.load(NODES, [config()], {});
            const res = await helper.request().post('/supla/lookup/channels').send({fromEnv: true}).expect(200);
            assert.strictEqual(res.body.length, 3);
        });
    });

    it('lists channels for the editor', async function () {
        const flow = [config()];
        await helper.load(NODES, flow, creds());
        const res = await helper.request().post('/supla/lookup/channels')
            .send({id: 'cfg', token: '__PWRD__'}).expect(200);
        assert.strictEqual(res.body.length, 3);
        assert.deepStrictEqual(res.body[0], {id: 101, caption: 'Kitchen light', function: 'LIGHTSWITCH',
            functionCaption: 'Light switch', device: 'Relay box', location: 'Home',
            actions: ['TURN_ON', 'TURN_OFF', 'TOGGLE']});
        const check = await helper.request().post('/supla/lookup/check').send({token: cloud.token}).expect(200);
        assert.strictEqual(check.body.suid, SUID);
    });
});
