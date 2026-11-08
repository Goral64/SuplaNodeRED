'use strict';

const assert = require('assert');
const {serverFromToken, normalizeServer, SuplaRest} = require('../lib/rest');
const {fromPayload} = require('../lib/actions');
const {applyMqttState} = require('../lib/state');
const {PollSource} = require('../lib/poll-source');
const {createFakeCloud, CHANNELS} = require('./fake-cloud');

describe('token and server', function () {
    it('reads the server address from the token', function () {
        const token = 'abc123.' + Buffer.from('https://svr12.supla.org').toString('base64');
        assert.strictEqual(serverFromToken(token), 'https://svr12.supla.org');
    });
    it('rejects tokens without an address', function () {
        assert.strictEqual(serverFromToken('abc123'), null);
        assert.strictEqual(serverFromToken('abc.' + Buffer.from('garbage').toString('base64')), null);
    });
    it('normalizes a server typed by hand', function () {
        assert.strictEqual(normalizeServer('cloud.local/'), 'https://cloud.local');
        assert.strictEqual(normalizeServer('http://10.0.0.2/api/v3'), 'http://10.0.0.2');
        assert.strictEqual(normalizeServer(''), null);
    });
});

describe('actions from payload', function () {
    it('maps booleans by function', function () {
        assert.deepStrictEqual(fromPayload(true, 'POWERSWITCH'), {action: 'TURN_ON', params: {}});
        assert.deepStrictEqual(fromPayload(false, 'CONTROLLINGTHEROLLERSHUTTER'), {action: 'SHUT', params: {}});
        assert.deepStrictEqual(fromPayload(true, 'CONTROLLINGTHEGATE'), {action: 'OPEN', params: {}});
    });
    it('maps numbers by function', function () {
        assert.deepStrictEqual(fromPayload(30, 'CONTROLLINGTHEROLLERSHUTTER'),
            {action: 'SHUT_PARTIALLY', params: {percentage: 30}});
        assert.deepStrictEqual(fromPayload('150', 'DIMMER'),
            {action: 'SET_RGBW_PARAMETERS', params: {brightness: 100}});
        assert.deepStrictEqual(fromPayload(21.5, 'HVAC_THERMOSTAT'),
            {action: 'HVAC_SET_TEMPERATURE', params: {temperature: 21.5}});
        assert.deepStrictEqual(fromPayload(1, 'LIGHTSWITCH'), {action: 'TURN_ON', params: {}});
        assert.throws(() => fromPayload(5, 'THERMOMETER'));
    });
    it('maps strings and objects', function () {
        assert.deepStrictEqual(fromPayload('toggle', 'LIGHTSWITCH'), {action: 'TOGGLE', params: {}});
        assert.deepStrictEqual(fromPayload('off', 'LIGHTSWITCH'), {action: 'TURN_OFF', params: {}});
        assert.deepStrictEqual(fromPayload('0xff8800', 'RGBLIGHTING'),
            {action: 'SET_RGBW_PARAMETERS', params: {color: '#FF8800'}});
        assert.deepStrictEqual(fromPayload({action: 'shut_partially', percentage: 20}, 'CURTAIN'),
            {action: 'SHUT_PARTIALLY', params: {percentage: 20}});
        assert.throws(() => fromPayload({percentage: 20}, 'CURTAIN'));
    });
    it('runs scenes', function () {
        assert.deepStrictEqual(fromPayload(true, '', 'scene'), {action: 'EXECUTE', params: {}});
        assert.deepStrictEqual(fromPayload('interrupt', '', 'scene'), {action: 'INTERRUPT', params: {}});
    });
});

describe('MQTT state', function () {
    it('builds the REST shape', function () {
        const s = {};
        assert.strictEqual(applyMqttState(s, 'on', 'true'), true);
        assert.strictEqual(applyMqttState(s, 'on', 'true'), false);
        applyMqttState(s, 'connected', 'connected_but_not_available');
        applyMqttState(s, 'tilt', '45');
        applyMqttState(s, 'is_calibrating', 'false');
        applyMqttState(s, 'color', '0xFF0000');
        applyMqttState(s, 'phases/2/voltage', '230.5');
        assert.deepStrictEqual(s, {
            on: true, connected: false, connectedCode: 'CONNECTED_BUT_NOT_AVAILABLE', tiltPercent: 45,
            isCalibrating: false, color: '0xFF0000', phases: [{number: 1}, {number: 2, voltage: 230.5}],
        });
    });
});

describe('REST client', function () {
    let cloud;
    beforeEach(async function () {
        cloud = await createFakeCloud().start();
    });
    afterEach(async function () {
        await cloud.stop();
    });

    it('sends the token and caches lists', async function () {
        cloud.on('GET', '/api/v3/channels', () => ({body: CHANNELS}));
        const rest = new SuplaRest({token: cloud.token});
        assert.strictEqual(rest.server, cloud.url);
        assert.strictEqual((await rest.channel(102)).caption, 'Living room blind');
        await rest.channels();
        assert.strictEqual(cloud.requests.length, 1);
        assert.strictEqual(cloud.requests[0].headers.authorization, 'Bearer ' + cloud.token);
    });

    it('executes actions', async function () {
        cloud.on('PATCH', '/api/v3/channel-groups/7', () => ({status: 202}));
        const rest = new SuplaRest({token: cloud.token});
        await rest.execute('group', 7, 'turn_on', {durationMs: 1000});
        assert.deepStrictEqual(cloud.requests[0].body, {durationMs: 1000, action: 'TURN_ON'});
    });

    it('reports errors from the Cloud', async function () {
        cloud.on('PATCH', '/api/v3/channels/1', () => ({status: 400, body: {status: 400, message: 'Invalid action'}}));
        const rest = new SuplaRest({token: cloud.token});
        await assert.rejects(rest.execute('channel', 1, 'FLY'), /Invalid action \(HTTP 400\)/);
    });

    it('waits after a rate limit', async function () {
        cloud.on('GET', '/api/v3/channels/states', () => ({status: 429, headers: {'Retry-After': '30'},
            body: {message: 'Too many requests'}}));
        const rest = new SuplaRest({token: cloud.token});
        await assert.rejects(rest.states(), (e) => e.status === 429);
        await assert.rejects(rest.states(), /retry in 30 s/);
        assert.strictEqual(cloud.requests.length, 1);
    });
});

describe('REST client over https with a self-signed certificate', function () {
    let cloud;
    beforeEach(async function () {
        cloud = await createFakeCloud({tls: true}).start();
        cloud.on('GET', '/api/v3/token-info', () => ({body: {userShortUniqueId: 'abc'}}));
    });
    afterEach(async function () {
        await cloud.stop();
    });

    it('refuses the certificate by default', async function () {
        const rest = new SuplaRest({token: cloud.token});
        await assert.rejects(rest.tokenInfo(), /self[- ]signed/i);
    });

    it('accepts it when asked to', async function () {
        const rest = new SuplaRest({token: cloud.token, insecure: true});
        assert.strictEqual((await rest.tokenInfo()).userShortUniqueId, 'abc');
    });
});

describe('PollSource', function () {
    let cloud;
    beforeEach(async function () {
        cloud = await createFakeCloud().start();
        cloud.on('GET', '/api/v3/channels', () => ({body: CHANNELS}));
    });
    afterEach(async function () {
        await cloud.stop();
    });

    it('reports only changed channels', async function () {
        let on = false;
        cloud.on('GET', '/api/v3/channels/states', () => ({body: {states: [
            {id: 101, iodeviceId: 5, state: {on, connected: true}, checksum: 'a'},
            {id: 102, iodeviceId: 5, state: {shut: 30, connected: true}, checksum: 'b'},
        ], devices: []}}));
        const source = new PollSource(new SuplaRest({token: cloud.token}), {});
        source.interval = 30;
        const events = [];
        source.on('state', (e) => events.push(e));
        source.start();
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(events.length, 2);
        assert.ok(events.every((e) => e.initial));
        on = true;
        await new Promise((r) => setTimeout(r, 80));
        await source.stop();
        assert.strictEqual(events.length, 3);
        assert.deepStrictEqual(events[2].changed, ['on']);
        assert.strictEqual(events[2].initial, false);
        assert.strictEqual(events[2].channel.caption, 'Kitchen light');
        assert.strictEqual(events[2].channel.function, 'LIGHTSWITCH');
    });
});
