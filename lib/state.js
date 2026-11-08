'use strict';

// Turns the state that supla-server publishes over MQTT into the shape the
// Cloud REST API returns, so both sources give the same msg.payload.

const RENAMES = {
    is_calibrating: 'isCalibrating',
    tilt: 'tiltPercent',
    overcurrent_relay_off: 'currentOverload',
    manually_closed: 'manuallyClosed',
};

function parseValue(raw) {
    const s = String(raw).trim();
    if (s === 'true') {
        return true;
    }
    if (s === 'false') {
        return false;
    }
    if (s === '') {
        return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) {
        return Number(s);
    }
    return s;
}

// Applies one MQTT state subtopic (e.g. "on", "phases/1/voltage") to a state object.
// Returns true when the state changed.
function applyMqttState(state, key, raw) {
    const parts = key.split('/');
    if (parts[0] === 'connected') {
        const value = String(raw).trim();
        const connected = value === 'true';
        const code = value === 'true' ? 'CONNECTED' : value === 'false' ? 'DISCONNECTED' : value.toUpperCase();
        const changed = state.connected !== connected || state.connectedCode !== code;
        state.connected = connected;
        state.connectedCode = code;
        return changed;
    }
    const value = parseValue(raw);
    if (parts[0] === 'phases' && parts.length === 3) {
        const index = parseInt(parts[1], 10) - 1;
        if (!(index >= 0 && index < 3)) {
            return false;
        }
        state.phases = state.phases || [];
        while (state.phases.length <= index) {
            state.phases.push({number: state.phases.length + 1});
        }
        const phase = state.phases[index];
        if (phase[parts[2]] === value) {
            return false;
        }
        phase[parts[2]] = value;
        return true;
    }
    if (parts.length !== 1) {
        return false;
    }
    const name = RENAMES[key] || key;
    if (state[name] === value) {
        return false;
    }
    state[name] = value;
    return true;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = {applyMqttState, parseValue, clone, equal};
