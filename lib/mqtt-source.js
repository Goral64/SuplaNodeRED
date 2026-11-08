'use strict';

// Live channel state from the MQTT broker that supla-server publishes to.
// Topics: [<prefix>/]supla/<suid>/devices/<D>/channels/<C>/{state/...,action/...,function,caption,type,hidden}

const EventEmitter = require('events');
const mqtt = require('mqtt');
const {applyMqttState, parseValue, clone} = require('./state');

// supla-server publishes each value on its own topic; changes that belong
// together (e.g. on + brightness) are sent as one event after this delay.
const SETTLE_MS = 50;

class MqttSource extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.prefix = (options.prefix || '').replace(/^\/+|\/+$/g, '');
        this.channels = new Map();
        this.pending = new Map();
        this.connected = false;
        this.client = null;
    }

    get base() {
        return (this.prefix ? this.prefix + '/' : '') + 'supla/' + this.options.suid + '/';
    }

    start() {
        const o = this.options;
        const url = (o.tls ? 'mqtts://' : 'mqtt://') + o.host + ':' + (o.port || (o.tls ? 8883 : 1883));
        this.client = mqtt.connect(url, {
            username: o.username || o.suid,
            password: o.password || undefined,
            clientId: o.clientId || 'node-red-supla-' + Math.random().toString(16).slice(2, 10),
            rejectUnauthorized: o.rejectUnauthorized !== false,
            reconnectPeriod: 5000,
            connectTimeout: 15000,
        });
        this.client.on('connect', () => {
            this.connected = true;
            this.client.subscribe(this.base + 'devices/+/channels/+/#', {qos: 0}, (err) => {
                if (err) {
                    this.emit('status', {connected: false, text: 'subscribe failed: ' + err.message});
                } else {
                    this.emit('status', {connected: true, text: 'connected'});
                }
            });
        });
        this.client.on('close', () => {
            if (this.connected) {
                this.connected = false;
                this.emit('status', {connected: false, text: 'disconnected'});
            }
        });
        this.client.on('error', (err) => {
            this.emit('status', {connected: false, text: err.message});
        });
        this.client.on('message', (topic, payload, packet) => this.handle(topic, payload.toString(), packet.retain));
    }

    handle(topic, payload, retained) {
        if (!topic.startsWith(this.base)) {
            return;
        }
        const m = /^devices\/(\d+)\/channels\/(\d+)\/(.+)$/.exec(topic.slice(this.base.length));
        if (!m) {
            return;
        }
        const deviceId = Number(m[1]);
        const channelId = Number(m[2]);
        const rest = m[3];
        const channel = this.channel(channelId, deviceId);
        if (rest.startsWith('state/')) {
            if (applyMqttState(channel.state, rest.slice(6), payload)) {
                this.schedule(channel, rest.slice(6), retained);
            }
        } else if (rest.startsWith('action/')) {
            // Retained action topics are old events replayed by the broker.
            if (!retained && payload !== '') {
                this.emit('trigger', {channelId, deviceId, action: rest.slice(7), channel: this.info(channel)});
            }
        } else if (['function', 'caption', 'type', 'hidden'].includes(rest)) {
            channel.meta[rest] = rest === 'caption' ? payload : parseValue(payload);
        }
    }

    channel(id, deviceId) {
        let channel = this.channels.get(id);
        if (!channel) {
            channel = {id, deviceId, state: {}, meta: {}};
            this.channels.set(id, channel);
        }
        return channel;
    }

    info(channel) {
        return {
            id: channel.id,
            deviceId: channel.deviceId,
            caption: channel.meta.caption,
            function: channel.meta.function,
        };
    }

    schedule(channel, key, retained) {
        let entry = this.pending.get(channel.id);
        if (!entry) {
            entry = {keys: new Set(), initial: true};
            entry.timer = setTimeout(() => {
                this.pending.delete(channel.id);
                this.emit('state', {
                    channelId: channel.id,
                    deviceId: channel.deviceId,
                    state: clone(channel.state),
                    changed: [...entry.keys],
                    initial: entry.initial,
                    channel: this.info(channel),
                });
            }, SETTLE_MS);
            this.pending.set(channel.id, entry);
        }
        entry.keys.add(key.split('/')[0]);
        entry.initial = entry.initial && retained;
    }

    getState(channelId) {
        const channel = this.channels.get(Number(channelId));
        return channel ? clone(channel.state) : undefined;
    }

    refresh() {
        if (this.client && this.connected) {
            this.client.publish(this.base + 'refresh_request', '1');
        }
    }

    stop() {
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
        }
        this.pending.clear();
        return new Promise((resolve) => {
            if (!this.client) {
                return resolve();
            }
            this.client.end(true, {}, () => resolve());
            this.client = null;
        });
    }
}

module.exports = {MqttSource};
