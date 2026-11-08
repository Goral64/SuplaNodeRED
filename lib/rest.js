'use strict';

// Client for the SUPLA Cloud REST API v3.

const http = require('http');
const https = require('https');

const TARGET_PATHS = {
    channel: 'channels',
    group: 'channel-groups',
    scene: 'scenes',
};

class SuplaApiError extends Error {
    constructor(message, status, body) {
        super(message);
        this.name = 'SuplaApiError';
        this.status = status;
        this.body = body;
    }
}

// Tokens look like "<random>.<base64 of the cloud address>".
function serverFromToken(token) {
    if (typeof token !== 'string') {
        return null;
    }
    const parts = token.trim().split('.');
    if (parts.length < 2) {
        return null;
    }
    try {
        const url = Buffer.from(parts[parts.length - 1], 'base64').toString('utf8');
        return /^https?:\/\/[^\s]+$/.test(url) ? url.replace(/\/+$/, '') : null;
    } catch (e) {
        return null;
    }
}

function normalizeServer(server) {
    let s = String(server || '').trim().replace(/\/+$/, '');
    if (!s) {
        return null;
    }
    if (!/^https?:\/\//.test(s)) {
        s = 'https://' + s;
    }
    return s.replace(/\/api(\/v?3)?$/, '');
}

class SuplaRest {
    constructor(options) {
        this.token = (options.token || '').trim();
        this.server = normalizeServer(options.server) || serverFromToken(this.token);
        this.insecure = !!options.insecure;
        this.timeout = options.timeout || 15000;
        this.cacheTtl = options.cacheTtl === undefined ? 60000 : options.cacheTtl;
        this.blockedUntil = 0;
        this.cache = new Map();
        this.rateLimit = null;
    }

    get baseUrl() {
        return this.server ? this.server + '/api/v3' : null;
    }

    async request(method, path, body) {
        if (!this.token) {
            throw new SuplaApiError('No access token', 0);
        }
        if (!this.baseUrl) {
            throw new SuplaApiError('Unknown server address, set it in the configuration', 0);
        }
        const wait = this.blockedUntil - Date.now();
        if (wait > 0) {
            throw new SuplaApiError('API rate limit exceeded, retry in ' + Math.ceil(wait / 1000) + ' s', 429);
        }
        let res;
        try {
            res = await this.send(method, this.baseUrl + path, body === undefined ? undefined : JSON.stringify(body));
        } catch (e) {
            throw new SuplaApiError(e.message, 0);
        }
        this.readRateLimit(res);
        let data = null;
        if (res.text) {
            try {
                data = JSON.parse(res.text);
            } catch (e) {
                data = res.text;
            }
        }
        if (res.status < 200 || res.status >= 300) {
            if (res.status === 429) {
                const retry = parseInt(res.headers['retry-after'], 10) || 10;
                this.blockedUntil = Date.now() + retry * 1000;
            }
            const message = (data && data.message) || res.statusText || 'HTTP ' + res.status;
            throw new SuplaApiError(message + ' (HTTP ' + res.status + ')', res.status, data);
        }
        return data;
    }

    // Plain http/https instead of fetch: it can skip certificate checks for
    // self-signed servers and still honours NODE_EXTRA_CA_CERTS.
    send(method, url, payload) {
        const target = new URL(url);
        const lib = target.protocol === 'https:' ? https : http;
        const headers = {Authorization: 'Bearer ' + this.token, Accept: 'application/json'};
        if (payload !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const options = {method, headers, timeout: this.timeout};
        if (lib === https && this.insecure) {
            options.rejectUnauthorized = false;
        }
        return new Promise((resolve, reject) => {
            const req = lib.request(target, options, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: res.headers,
                    text: Buffer.concat(chunks).toString('utf8'),
                }));
                res.on('error', reject);
            });
            req.on('timeout', () => req.destroy(new Error('Request timed out')));
            req.on('error', reject);
            req.end(payload);
        });
    }

    readRateLimit(res) {
        const limit = res.headers['x-ratelimit-limit'];
        if (limit) {
            this.rateLimit = {
                limit: parseInt(limit, 10),
                remaining: parseInt(res.headers['x-ratelimit-remaining'], 10),
                reset: parseInt(res.headers['x-ratelimit-reset'], 10),
            };
        }
    }

    async cached(key, loader, force) {
        const entry = this.cache.get(key);
        if (!force && entry && Date.now() - entry.time < this.cacheTtl) {
            return entry.value;
        }
        const value = await loader();
        this.cache.set(key, {time: Date.now(), value});
        return value;
    }

    clearCache() {
        this.cache.clear();
    }

    tokenInfo(force) {
        return this.cached('token-info', () => this.request('GET', '/token-info'), force);
    }

    channels(force) {
        return this.cached('channels', () => this.request('GET', '/channels?include=iodevice,location'), force);
    }

    groups(force) {
        return this.cached('groups', () => this.request('GET', '/channel-groups?include=location'), force);
    }

    scenes(force) {
        return this.cached('scenes', () => this.request('GET', '/scenes?include=location'), force);
    }

    async channel(id, force) {
        const list = await this.channels(force);
        let channel = list.find((c) => c.id === Number(id));
        if (!channel && !force) {
            channel = (await this.channels(true)).find((c) => c.id === Number(id));
        }
        return channel || null;
    }

    channelWithState(id) {
        return this.request('GET', '/channels/' + Number(id) + '?include=state,connected');
    }

    groupWithState(id) {
        return this.request('GET', '/channel-groups/' + Number(id) + '?include=state');
    }

    states() {
        return this.request('GET', '/channels/states');
    }

    execute(type, id, action, params) {
        const path = TARGET_PATHS[type];
        if (!path) {
            return Promise.reject(new SuplaApiError('Unknown target type: ' + type, 0));
        }
        const body = Object.assign({}, params || {}, {action: String(action).toUpperCase()});
        return this.request('PATCH', '/' + path + '/' + Number(id), body);
    }
}

module.exports = {SuplaRest, SuplaApiError, serverFromToken, normalizeServer};
