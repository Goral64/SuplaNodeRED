'use strict';

// A small HTTP server that answers like the SUPLA Cloud API v3.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// With tls the server uses a self-signed certificate from test/fixtures.
function createFakeCloud(options) {
    const tls = !!(options && options.tls);
    const cloud = {
        requests: [],
        routes: {},
        server: null,
        port: 0,
        get url() {
            return (tls ? 'https' : 'http') + '://127.0.0.1:' + this.port;
        },
        get token() {
            return 'secret123.' + Buffer.from(this.url).toString('base64');
        },
        on(method, path, handler) {
            this.routes[method + ' ' + path] = handler;
        },
        start() {
            const handle = (req, res) => {
                let body = '';
                req.on('data', (c) => body += c);
                req.on('end', () => {
                    const path = req.url.replace(/\?.*$/, '');
                    const entry = {method: req.method, url: req.url, path, headers: req.headers,
                        body: body ? JSON.parse(body) : undefined};
                    this.requests.push(entry);
                    const handler = this.routes[req.method + ' ' + path];
                    if (!handler) {
                        res.writeHead(404, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({status: 404, message: 'Not found'}));
                    }
                    const r = handler(entry) || {};
                    res.writeHead(r.status || 200, Object.assign({'Content-Type': 'application/json'}, r.headers || {}));
                    res.end(r.body === undefined ? '' : JSON.stringify(r.body));
                });
            };
            this.server = tls
                ? https.createServer({
                    key: fs.readFileSync(path.join(__dirname, 'fixtures', 'key.pem')),
                    cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'cert.pem')),
                }, handle)
                : http.createServer(handle);
            return new Promise((resolve) => this.server.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                resolve(this);
            }));
        },
        stop() {
            return new Promise((resolve) => this.server.close(() => resolve()));
        },
    };
    return cloud;
}

const CHANNELS = [
    {id: 101, caption: 'Kitchen light', iodeviceId: 5, function: {id: 140, name: 'LIGHTSWITCH', caption: 'Light switch'},
        iodevice: {name: 'Relay box'}, location: {caption: 'Home'},
        possibleActions: [{id: 60, name: 'TURN_ON'}, {id: 70, name: 'TURN_OFF'}, {id: 110, name: 'TOGGLE'}]},
    {id: 102, caption: 'Living room blind', iodeviceId: 5,
        function: {id: 110, name: 'CONTROLLINGTHEROLLERSHUTTER', caption: 'Roller shutter'},
        iodevice: {name: 'Relay box'}, location: {caption: 'Home'},
        possibleActions: [{id: 30, name: 'SHUT'}, {id: 40, name: 'REVEAL'}, {id: 51, name: 'SHUT_PARTIALLY'}]},
    {id: 103, caption: 'Button', iodeviceId: 6, function: {id: 700, name: 'ACTION_TRIGGER', caption: 'Action trigger'},
        iodevice: {name: 'Switch'}, location: {caption: 'Home'}, possibleActions: []},
];

module.exports = {createFakeCloud, CHANNELS};
