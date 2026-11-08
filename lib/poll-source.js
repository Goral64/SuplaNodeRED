'use strict';

// Channel state without MQTT: asks the Cloud for all states at once
// (GET /channels/states) and reports the channels whose state changed.
// The checksums in that response cover the configuration, not the state,
// so the states themselves are compared.

const EventEmitter = require('events');
const {clone, equal} = require('./state');

class PollSource extends EventEmitter {
    constructor(rest, options) {
        super();
        this.rest = rest;
        this.interval = Math.max(5, Number(options && options.interval) || 10) * 1000;
        this.states = new Map();
        this.timer = null;
        this.running = false;
        this.connected = false;
        this.first = true;
    }

    start() {
        this.running = true;
        this.poll();
    }

    async poll() {
        if (!this.running) {
            return;
        }
        try {
            const data = await this.rest.states();
            if (!this.running) {
                return;
            }
            await this.process(data);
            if (!this.connected) {
                this.connected = true;
                this.emit('status', {connected: true, text: 'polling'});
            }
        } catch (err) {
            this.connected = false;
            this.emit('status', {connected: false, text: err.message});
        }
        if (this.running) {
            this.timer = setTimeout(() => this.poll(), this.interval);
        }
    }

    async process(data) {
        const initial = this.first;
        this.first = false;
        let channels = null;
        for (const item of (data && data.states) || []) {
            const previous = this.states.get(item.id);
            const state = item.state || {};
            if (previous && equal(previous.state, state)) {
                continue;
            }
            const changed = Object.keys(state).filter((k) => !previous || !equal(previous.state[k], state[k]));
            this.states.set(item.id, {deviceId: item.iodeviceId, state: clone(state)});
            if (!channels) {
                channels = await this.rest.channels().catch(() => []);
            }
            const ch = channels.find((c) => c.id === item.id);
            this.emit('state', {
                channelId: item.id,
                deviceId: item.iodeviceId,
                state: clone(state),
                changed,
                initial,
                channel: {
                    id: item.id,
                    deviceId: item.iodeviceId,
                    caption: ch ? ch.caption : undefined,
                    function: ch && ch.function ? ch.function.name : undefined,
                },
            });
        }
    }

    getState(channelId) {
        const entry = this.states.get(Number(channelId));
        return entry ? clone(entry.state) : undefined;
    }

    refresh() {
        clearTimeout(this.timer);
        this.poll();
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
        return Promise.resolve();
    }
}

module.exports = {PollSource};
