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

W Node-RED: Manage palette, Install, wyszukaj `node-red-contrib-supla`. Albo w katalogu Node-RED
(zwykle `~/.node-red`):

```
npm install node-red-contrib-supla
```

Potrzebny jest Node.js 18 lub nowszy i Node-RED 3.1 lub nowszy.

## Konfiguracja

1. W SUPLA Cloud wejdź w Bezpieczeństwo, Osobiste tokeny dostępowe i utwórz token. Zaznacz co
   najmniej odczyt i wykonywanie akcji na kanałach, a jeśli chcesz ich używać, to samo dla grup
   kanałów i scen.
2. Dodaj do przepływu dowolny węzeł SUPLA, otwórz go i dodaj nowy serwer. Wklej token. Adres
   serwera jest zapisany w tokenie, więc pole pod nim może zostać puste. Przycisk „Sprawdź
   połączenie” pokaże, czy wszystko działa.
3. Wybierz, skąd węzły mają wiedzieć o zmianach:
   - **MQTT** – zmiany przychodzą od razu. Włącz broker MQTT w Cloud (Integracje, Broker MQTT),
     wygeneruj tam hasło i przepisz do węzła host, port i hasło. Użytkownika można zostawić pustego,
     węzeł weźmie go z tokena. Na własnym serwerze supla-server musi mieć ustawione publikowanie
     do brokera.
   - **Pytanie Cloud** – bez MQTT, węzeł co kilka sekund (domyślnie co 10) pobiera stan wszystkich
     kanałów. Cloud pozwala na ok. 1000 zapytań na godzinę.
   - **Brak** – tylko akcje i odczyt stanu na żądanie.

Zdarzenia przycisków (supla trigger) przychodzą tylko przez MQTT.

Jeśli własny serwer ma samopodpisany certyfikat, podaj Node-RED certyfikat CA w zmiennej
`NODE_EXTRA_CA_CERTS` albo zaznacz „Akceptuj każdy certyfikat”.

W gotowych instalacjach węzeł serwera może wziąć wszystko ze zmiennych środowiskowych:
`SUPLA_TOKEN`, `SUPLA_SERVER` (opcjonalnie), `SUPLA_MQTT_URL` (np. `mqtt://mosquitto:1883`),
`SUPLA_MQTT_USERNAME`, `SUPLA_MQTT_PASSWORD`, `SUPLA_MQTT_PREFIX` i `SUPLA_TLS_INSECURE`. Wystarczy
zaznaczyć w węźle „Ustawienia ze zmiennych środowiskowych”.

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

Kilka przykładowych przepływów jest w Import, Examples, node-red-contrib-supla.

## Testy

```
npm install
npm test
```

## Licencja

GPL-3.0
