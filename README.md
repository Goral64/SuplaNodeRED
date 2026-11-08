# node-red-contrib-supla

[Po polsku](docs/pl/README.md)

Node-RED nodes for [SUPLA](https://www.supla.org). With them you can react to what happens to your
devices and control channels, channel groups and scenes from your flows. They work with supla.org
and with your own SUPLA server.

- **supla in** sends a message when the state of a channel changes,
- **supla get** reads the current state of a channel or a group,
- **supla action** turns things on and off, moves roller shutters, sets colours, runs scenes,
- **supla trigger** sends a message when a button on an action trigger channel is pressed, double
  pressed, held and so on.

## Install

In Node-RED: Manage palette, Install, search for `node-red-contrib-supla`. Or in the Node-RED
directory (usually `~/.node-red`):

```
npm install node-red-contrib-supla
```

Node.js 18 or newer and Node-RED 3.1 or newer.

## Setup

1. In SUPLA Cloud go to Security, Personal access tokens and make a token. Tick at least reading and
   running actions on channels, and the same for channel groups and scenes if you want to use them.
2. Add any SUPLA node to a flow, open it and add a new server. Paste the token. The server address
   is part of the token, so the field below can stay empty. "Check connection" tells you if it
   works.
3. Choose how the nodes learn about changes:
   - **MQTT** – changes arrive at once. Turn on the MQTT broker in the Cloud (Integrations, MQTT
     Broker), generate a password there and copy the host, port and password into the node. The
     user name can stay empty, the node takes it from the token. On your own server supla-server
     has to be set up to publish to a broker.
   - **Ask the Cloud** – no MQTT needed, the node asks for the state of all channels every few
     seconds (10 by default). Keep in mind the Cloud allows about 1000 requests per hour.
   - **None** – only actions and reading state on demand.

Button events (supla trigger) only come over MQTT.

If your own server has a self-signed certificate, give Node-RED its CA certificate in the
`NODE_EXTRA_CA_CERTS` environment variable, or tick "Accept any certificate".

For ready-made installs the server node can take everything from environment variables:
`SUPLA_TOKEN`, `SUPLA_SERVER` (optional), `SUPLA_MQTT_URL` (e.g. `mqtt://mosquitto:1883`),
`SUPLA_MQTT_USERNAME`, `SUPLA_MQTT_PASSWORD`, `SUPLA_MQTT_PREFIX` and `SUPLA_TLS_INSECURE`. Tick
"Take settings from environment variables" in the node.

## Using the nodes

**supla action** takes the action from the node settings, from `msg.action` or from `msg.payload`:

| `msg.payload` | does |
|---|---|
| `true` / `false` | turn on / off; roller shutters reveal / shut; gates and valves open / close |
| a number | roller shutter shut %, dimmer brightness, thermostat temperature |
| `"#FF8800"` | colour of RGB lighting |
| `"toggle"`, `"stop"`, `"open_close"`… | that action |
| `{"action": "SHUT_PARTIALLY", "percentage": 30}` | action with parameters |

Parameters can also come in `msg.params`, e.g. `{"brightness": 50}` or `{"durationMs": 60000}`.
The target can be changed with `msg.channelId` or `msg.target = {"type": "scene", "id": 12}`.

**supla in** and **supla get** give the state in `msg.payload`, the same way the Cloud API does,
e.g. `{"on": true, "connected": true}` for a switch, `{"shut": 40}` for a roller shutter or
`{"temperature": 21.4}` for a thermometer. `msg.channel` has the ID, caption and function of the
channel, and supla in also gives `msg.previous` and `msg.changed`.

**supla trigger** puts the action in `msg.payload`: `press_x1`…`press_x5`, `toggle_x1`…`toggle_x5`,
`hold`, `turn_on`, `turn_off`.

There are a few example flows in Import, Examples, node-red-contrib-supla. "door-left-open" is a
good one to start with, it only needs a door or window sensor. Imported nodes use your server if
you have just one, otherwise pick it in each node.

## Tests

```
npm install
npm test
```

## License

GPL-3.0
