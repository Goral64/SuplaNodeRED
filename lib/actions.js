'use strict';

// Works out which action to run from a plain msg.payload, so that simple
// flows don't need to build {action, params} by hand.

const COVERS = [
    'CONTROLLINGTHEROLLERSHUTTER', 'CONTROLLINGTHEROOFWINDOW', 'CONTROLLINGTHEFACADEBLIND', 'TERRACE_AWNING',
    'PROJECTOR_SCREEN', 'CURTAIN', 'VERTICAL_BLIND', 'ROLLER_GARAGE_DOOR',
];
const GATES = ['CONTROLLINGTHEGATE', 'CONTROLLINGTHEGARAGEDOOR', 'CONTROLLINGTHEGATEWAYLOCK', 'CONTROLLINGTHEDOORLOCK'];
const VALVES = ['VALVEOPENCLOSE', 'VALVEPERCENTAGE'];
const DIMMERS = ['DIMMER', 'DIMMER_CCT'];
const RGB = ['RGBLIGHTING', 'DIMMERANDRGBLIGHTING', 'DIMMER_CCT_AND_RGB'];
const HVAC = [
    'HVAC_THERMOSTAT', 'HVAC_THERMOSTAT_HEAT_COOL', 'HVAC_DRYER', 'HVAC_FAN', 'HVAC_THERMOSTAT_DIFFERENTIAL',
    'HVAC_DOMESTIC_HOT_WATER',
];

const ALIASES = {
    ON: 'TURN_ON',
    OFF: 'TURN_OFF',
};

// Returns {action, params} or throws when the payload doesn't say what to do.
function fromPayload(payload, functionName, targetType) {
    if (targetType === 'scene') {
        if (typeof payload === 'string' && /^(INTERRUPT|INTERRUPT_AND_EXECUTE|EXECUTE)$/i.test(payload)) {
            return {action: payload.toUpperCase(), params: {}};
        }
        return {action: 'EXECUTE', params: {}};
    }
    const fn = functionName || '';
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        if (payload.action) {
            const params = Object.assign({}, payload);
            delete params.action;
            return {action: normalizeAction(payload.action), params};
        }
        throw new Error('Object payload needs an "action" property');
    }
    if (typeof payload === 'boolean') {
        if (COVERS.includes(fn)) {
            return {action: payload ? 'REVEAL' : 'SHUT', params: {}};
        }
        if (GATES.includes(fn) || VALVES.includes(fn)) {
            return {action: payload ? 'OPEN' : 'CLOSE', params: {}};
        }
        return {action: payload ? 'TURN_ON' : 'TURN_OFF', params: {}};
    }
    if (typeof payload === 'number' || (typeof payload === 'string' && /^-?\d+(\.\d+)?$/.test(payload.trim()))) {
        const value = Number(payload);
        if (COVERS.includes(fn)) {
            return {action: 'SHUT_PARTIALLY', params: {percentage: clamp(value)}};
        }
        if (DIMMERS.includes(fn) || fn === 'DIMMERANDRGBLIGHTING' || fn === 'DIMMER_CCT_AND_RGB') {
            return {action: 'SET_RGBW_PARAMETERS', params: {brightness: clamp(value)}};
        }
        if (fn === 'RGBLIGHTING') {
            return {action: 'SET_RGBW_PARAMETERS', params: {color_brightness: clamp(value)}};
        }
        if (HVAC.includes(fn)) {
            return {action: 'HVAC_SET_TEMPERATURE', params: {temperature: value}};
        }
        if (value === 0 || value === 1) {
            return fromPayload(value === 1, fn, targetType);
        }
        throw new Error('Don\'t know what to do with a number for function ' + (fn || 'unknown'));
    }
    if (typeof payload === 'string') {
        const s = payload.trim();
        if (/^(#|0x)[0-9a-f]{6}$/i.test(s) && (RGB.includes(fn) || !fn)) {
            return {action: 'SET_RGBW_PARAMETERS', params: {color: '#' + s.slice(-6).toUpperCase()}};
        }
        if (/^[a-z_]+$/i.test(s)) {
            return {action: normalizeAction(s), params: {}};
        }
    }
    throw new Error('Can\'t work out an action from msg.payload');
}

function normalizeAction(action) {
    const name = String(action).trim().toUpperCase();
    return ALIASES[name] || name;
}

function clamp(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

module.exports = {fromPayload, normalizeAction};
