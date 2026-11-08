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

### SuplaOS

[SuplaOS](https://github.com/Goral64/SuplaOS) has a Node-RED add-on with these nodes already
installed and set up. Install the add-on in the panel and you can start building flows, the SUPLA
server node is there and connected to your account.

### Other Node-RED installs

The nodes work in any Node-RED 3.1 or newer on Node.js 18 or newer, with supla.org or with your own
server. In Node-RED open Manage palette, Install, and search for `node-red-contrib-supla`. Or in the
Node-RED directory (usually `~/.node-red`, in the `nodered/node-red` Docker image it is `/data`):

```
npm install node-red-contrib-supla
```

and restart Node-RED.

Then open any SUPLA node and add a server:

1. In SUPLA Cloud go to Security, Personal access tokens and make a token. Tick at least reading and
   running actions on channels, and the same for channel groups and scenes if you want to use them.
2. Paste the token. The server address is part of the token, so the field below can stay empty.
   Fill it in only if Node-RED reaches the Cloud at a different address than the one the Cloud
   knows itself by. "Check connection" tells you if it works.
3. Choose how the nodes learn about changes:
   - **MQTT** – changes arrive at once and button events work. On supla.org turn on the MQTT broker
     in the Cloud (Integrations, MQTT Broker), generate a password there and copy the host, port and
     password into the node, ticking TLS if the page says so. The user name can stay empty, the node
     takes it from the token. On your own server supla-server has to publish to a broker you run:
     set the `SUPLA_MQTT_BROKER_*` variables in the `.env` file of supla-docker, restart it and turn
     MQTT on for your account in the Cloud. Then put that broker's address and login in the node.
   - **Ask the Cloud** – no MQTT needed, the node asks for the state of all channels every few
     seconds (10 by default). Changes come with a delay and button events don't work. The Cloud
     allows about 1000 requests per hour, so don't go below 5 s.
   - **None** – only actions and reading state on demand.

Your own server with a self-signed certificate (supla-docker has one by default): start Node-RED
with `NODE_EXTRA_CA_CERTS=/path/to/ca.crt` pointing at the server's certificate or its CA, or tick
"Accept any certificate" in the server node. MQTT over TLS has a box of its own for that.

Instead of typing all this into the node you can tick "Take settings from environment variables"
and set them for Node-RED, which is handy with docker-compose. The token then isn't stored in the
flows:

- `SUPLA_TOKEN` – the token,
- `SUPLA_MQTT_URL` – e.g. `mqtts://host:8883`; without it the node asks the Cloud every few seconds,
- `SUPLA_MQTT_USERNAME`, `SUPLA_MQTT_PASSWORD` – broker login,
- `SUPLA_MQTT_PREFIX`, `SUPLA_SERVER`, `SUPLA_TLS_INSECURE` – optional.

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
