# node-red-contrib-supla

[In English](../../README.md)

Węzły Node-RED dla [SUPLA](https://www.supla.org). Pozwalają reagować na to, co dzieje się
z urządzeniami, i sterować kanałami, grupami kanałów i scenami z przepływów. Działają z supla.org
i z własnym serwerem SUPLA.

- **supla in** wysyła wiadomość, gdy zmieni się stan kanału,
- **supla get** odczytuje bieżący stan kanału albo grupy,
- **supla action** włącza i wyłącza, ustawia rolety i kolory, uruchamia sceny,
- **supla trigger** wysyła wiadomość, gdy przycisk na kanale action trigger zostanie naciśnięty,
  naciśnięty dwa razy, przytrzymany itd.

## Instalacja

### SuplaOS

[SuplaOS](https://github.com/Goral64/SuplaOS) ma dodatek Node-RED z tymi węzłami, od razu
zainstalowanymi i skonfigurowanymi. Wystarczy zainstalować dodatek w panelu i można budować
przepływy, węzeł serwera SUPLA jest już na miejscu i połączony z kontem.

### Inne instalacje Node-RED

Węzły działają w każdym Node-RED 3.1 lub nowszym na Node.js 18 lub nowszym, z supla.org i z własnym
serwerem. W Node-RED otwórz Manage palette, Install i wyszukaj `node-red-contrib-supla`. Albo
w katalogu Node-RED (zwykle `~/.node-red`, w obrazie Dockera `nodered/node-red` to `/data`):

```
npm install node-red-contrib-supla
```

i restart Node-RED.

Potem otwórz dowolny węzeł SUPLA i dodaj serwer:

1. W SUPLA Cloud wejdź w Bezpieczeństwo, Osobiste tokeny dostępowe i utwórz token. Zaznacz co
   najmniej odczyt i wykonywanie akcji na kanałach, a jeśli chcesz ich używać, to samo dla grup
   kanałów i scen.
2. Wklej token. Adres serwera jest zapisany w tokenie, więc pole pod nim może zostać puste. Wpisz go
   tylko wtedy, gdy Node-RED widzi Cloud pod innym adresem, niż Cloud sam o sobie myśli. Przycisk
   „Sprawdź połączenie” pokaże, czy wszystko działa.
3. Wybierz, skąd węzły mają wiedzieć o zmianach:
   - **MQTT** – zmiany przychodzą od razu i działają zdarzenia przycisków. Na supla.org włącz broker
     MQTT w Cloud (Integracje, Broker MQTT), wygeneruj tam hasło i przepisz do węzła host, port
     i hasło, a jeśli strona tak podaje, zaznacz TLS. Użytkownika można zostawić pustego, węzeł
     weźmie go z tokena. Na własnym serwerze supla-server musi publikować do brokera, którego sam
     stawiasz: ustaw zmienne `SUPLA_MQTT_BROKER_*` w pliku `.env` supla-docker, uruchom go ponownie
     i włącz MQTT dla konta w Cloud. Potem w węźle podajesz adres i login tego brokera.
   - **Pytanie Cloud** – bez MQTT, węzeł co kilka sekund (domyślnie co 10) pobiera stan wszystkich
     kanałów. Zmiany przychodzą z opóźnieniem, a zdarzenia przycisków nie działają. Cloud pozwala
     na ok. 1000 zapytań na godzinę, więc nie schodź poniżej 5 s.
   - **Brak** – tylko akcje i odczyt stanu na żądanie.

Własny serwer z samopodpisanym certyfikatem (supla-docker ma taki domyślnie): uruchom Node-RED
ze zmienną `NODE_EXTRA_CA_CERTS=/ścieżka/do/ca.crt`, wskazującą certyfikat serwera albo jego CA,
albo zaznacz w węźle serwera „Akceptuj każdy certyfikat”. MQTT z TLS ma do tego osobne pole.

Zamiast wpisywać to wszystko w węźle, można zaznaczyć „Ustawienia ze zmiennych środowiskowych”
i ustawić je dla Node-RED, co przydaje się przy docker-compose. Token nie jest wtedy zapisany
w przepływach:

- `SUPLA_TOKEN` – token,
- `SUPLA_MQTT_URL` – np. `mqtts://host:8883`; bez niej węzeł co kilka sekund pyta Cloud,
- `SUPLA_MQTT_USERNAME`, `SUPLA_MQTT_PASSWORD` – login brokera,
- `SUPLA_MQTT_PREFIX`, `SUPLA_SERVER`, `SUPLA_TLS_INSECURE` – opcjonalnie.

## Używanie

**supla action** bierze akcję z ustawień węzła, z `msg.action` albo z `msg.payload`:

| `msg.payload` | co robi |
|---|---|
| `true` / `false` | włącz / wyłącz; rolety odsłoń / zasłoń; bramy i zawory otwórz / zamknij |
| liczba | procent zasłonięcia rolety, jasność ściemniacza, temperatura termostatu |
| `"#FF8800"` | kolor oświetlenia RGB |
| `"toggle"`, `"stop"`, `"open_close"`… | ta akcja |
| `{"action": "SHUT_PARTIALLY", "percentage": 30}` | akcja z parametrami |

Parametry mogą też przyjść w `msg.params`, np. `{"brightness": 50}` albo `{"durationMs": 60000}`.
Cel można zmienić przez `msg.channelId` albo `msg.target = {"type": "scene", "id": 12}`.

**supla in** i **supla get** podają stan w `msg.payload`, tak samo jak API Cloud, np.
`{"on": true, "connected": true}` dla przekaźnika, `{"shut": 40}` dla rolety albo
`{"temperature": 21.4}` dla termometru. W `msg.channel` jest ID, nazwa i funkcja kanału, a supla in
podaje też `msg.previous` i `msg.changed`.

**supla trigger** wstawia akcję do `msg.payload`: `press_x1`…`press_x5`, `toggle_x1`…`toggle_x5`,
`hold`, `turn_on`, `turn_off`.

Kilka przykładowych przepływów jest w Import, Examples, node-red-contrib-supla. Na początek dobry
jest „door-left-open”, wystarczy do niego czujnik otwarcia drzwi albo okna. Zaimportowane węzły same
dostają serwer, jeśli jest tylko jeden, w przeciwnym razie trzeba go wybrać w każdym węźle.

## Testy

```
npm install
npm test
```

## Licencja

GPL-3.0
