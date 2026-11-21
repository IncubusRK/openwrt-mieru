# openwrt-mieru

Монорепозиторий пакетов OpenWrt для прокси-клиента **[mieru](https://github.com/enfein/mieru)**
(upstream enfein/mieru, лицензия GPL-3.0-or-later):

| Пакет | Назначение |
|---|---|
| `mieru/` | клиентский бинарник (сборка из исходников Go), UCI-конфиг, procd init с **multi-port/range** привязками |
| `luci-app-mieru/` | LuCI-интерфейс (JS views): настройки, привязки портов, импорт/экспорт ссылок `mierus://`, статус; EN + полный RU |

Целевая платформа: **Banana Pi BPI-R4 (`aarch64_cortex-a53`)**, FULL-вариант прошивки
OpenWrt main (2026). Пакет собирается и для всех архитектур, поддерживаемых
`golang/host` (`GO_ARCH_DEPENDS`: aarch64, arm, mips/mipsel/mips64, x86, riscv64, loongarch64…).

Клиент mieru поднимает локальный **SOCKS5** (и опционально HTTP/HTTPS) прокси —
используйте его как upstream в **Podkop / Xray / OpenClash** (см. [Интеграция](#интеграция)).

---

## 1. Гейт анализа (этап 0) и clean-room

Перед реализацией был изучен референс **[alexxttss/mieru-openwrt](https://github.com/alexxttss/mieru-openwrt)**
(клон для анализа — в `_analysis/`, в репозиторий не коммитится):

- **У репозитория нет файла LICENSE**, а заголовки файлов противоречат друг другу
  (Makefile заявляет GPL v3, ucode-плагин — Apache 2.0). Правовой статус кода не
  определён, поэтому **код референса не копировался и не переносился**. Вся
  реализация openwrt-mieru написана с нуля (clean-room); референс использовался
  только для понимания паттернов: структура Makefile/init, UCI-схема, подход к
  ucode-монитору, состав ACL, формат ссылок.
- Выявленные пробелы референса, закрытые в этом репо:
  - **нет multi-port** — один порт/диапазон и один протокол на весь конфиг;
  - парсер ссылок понимает только один порт и **не совместим с upstream-форматом**
    `mierus://` (нет `profile=`, нет парных `port`/`protocol`);
  - монолитный LuCI-view с прямыми DOM-манипуляциями и хардкодом русских строк;
  - тяжёлый постоянный ucode-монитор (poll + curl + shell);
  - местами shell-инъекции в rpcd-плагине.
- Также изучен **upstream enfein/mieru v3.39.0**: README, docs/client-install.md,
  docs/client-install-openwrt.md, исходники (`pkg/appctl/url.go`, `pkg/cli/client.go`,
  `pkg/metrics`, proto-схема) и GitHub Releases. Ключевые факты:
  - клиентский бинарник называется **`mieru`** (`mita` — сервер);
  - конфиг — JSON (`profiles[] → servers[] → portBindings[]`, `port`/`portRange`,
    `protocol` TCP/UDP per-binding); **multi-port поддержан нативно**;
  - запуск на OpenWrt: `mieru run` (foreground) с env `MIERU_CONFIG_JSON_FILE`
    (паттерн из upstream `configs/examples/etc_initd_mieru`); логи при этом идут в stdout;
  - **формат `mierus://` существует в upstream** (`mieru export config simple` /
    `mieru import config`), это не изобретение референса;
  - метрики: `mieru get metrics` → JSON-группы `traffic` (DownloadBytes/UploadBytes),
    `connections` (CurrEstablished), `underlay`, `socks5`…;
  - prebuilt `linux_arm64` в релизах есть (запасной вариант, см. ниже).

Подробный журнал анализа: `_analysis/NOTES.md` (не коммитится).

## 2. Выбор способа сборки: исходники, не prebuilt

**Выбрано: сборка из исходников через `golang/host`** (образец —
`feeds/packages/net/xray-core`), потому что:

1. покрываются **все** архитектуры `GO_ARCH_DEPENDS` (включая mips softfloat),
   а не только amd64/arm64/armv7/riscv64 из релизов upstream;
2. обновление версии = смена тега и хеша, единый пайплайн с остальными Go-пакетами фида;
3. бинарник собирается из проверяемого исходного tarball, а не берётся готовым;
4. в сборочном дереве уже есть `golang/host` (go1.27), CGO не нужен —
   mieru полностью написан на чистом Go (`CGO_ENABLED=0`).

Исходники берутся с `codeload.github.com/enfein/mieru/tar.gz/v3.39.0`;
**`PKG_HASH` верифицирован скачиванием**:

```
434198ea0558bc440379e9a0a97f6904ba8dd6b213dd6fb9d578388eba7d2f12
```

Prebuilt-вариант (образец `naiveproxy`) тоже возможен: в релизах есть
`mieru_3.39.0_linux_arm64.tar.gz` (sha256
`23337061e8cbba9869ef17ce2c44121a318a66c40da5e2655e8c0e404b0f18ed`),
который подходит для `aarch64_cortex-a53`. Он не выбран из-за ограниченного
списка архитектур; при необходимости Makefile легко переделать по образцу
naiveproxy (per-arch `PKG_HASH`).

Особенности `mieru/Makefile`:

- `GO_PKG:=github.com/enfein/mieru/v3`, `GO_PKG_BUILD_PKG:=…/cmd/mieru`;
- `GO_PKG_VARS+=CGO_ENABLED=0`, `GO_PKG_LDFLAGS:=-s -w`, `PKG_BUILD_FLAGS:=no-mips16`;
- include `$(TOPDIR)/feeds/packages/lang/golang/golang-package.mk` — монорепо
  клонируется в `package/openwrt-mieru`, поэтому путь абсолютный (не относительный);
- ставятся `/usr/bin/mieru`, `/etc/config/mieru` (conffiles), `/etc/init.d/mieru`.

## 3. Формат ссылок `mierus://`

### Канонический формат (совместим с upstream)

Наш генератор воспроизводит формат `mieru export config simple` **побайтово**
(проверено против реального бинарника v3.39.0, см. [Валидация](#6-валидация-без-сборки-openwrt)):

```
mierus://<user>:<pass>@<host>?handshake-mode=<MODE>&mtu=<N>&multiplexing=<LEVEL>&port=<P1>&port=<P2>…&profile=<NAME>&protocol=<PR1>&protocol=<PR2>…[&traffic-pattern=<base64>]
```

Правила (как в upstream `pkg/appctl/url.go`):

- ключи query идут **в алфавитном порядке** (так делает Go `url.Values.Encode()`);
- `port` и `protocol` повторяются и **сопоставляются по индексу** (port[i] ↔ protocol[i]),
  порядок — порядок привязок; все `port=` идут перед `profile=`, все `protocol=` — после;
- `port` — одиночный порт `1–65535` или диапазон `start-end` (`1 ≤ start ≤ end ≤ 65535`);
- `protocol` — `TCP` или `UDP` (**per-binding**);
- `profile` — имя профиля (у нас по умолчанию `default`);
- `mtu` (1280–1400), `multiplexing` (`MULTIPLEXING_OFF|LOW|MIDDLE|HIGH`),
  `handshake-mode` (`HANDSHAKE_STANDARD|HANDSHAKE_NO_WAIT`) — включаются всегда;
- `traffic-pattern` — base64 protobuf, включается только если задан (opaque, сохраняется без изменений);
- userinfo percent-encoded; IPv6-адрес сервера — в квадратных скобках;
- один сервер на ссылку (как в upstream).

Пример (эталон из документации upstream, воспроизводится нашим генератором точно):

```
mierus://baozi:manlianpenfen@1.2.3.4?handshake-mode=HANDSHAKE_NO_WAIT&mtu=1400&multiplexing=MULTIPLEXING_HIGH&port=6666&port=9998-9999&port=6489&port=4896&profile=default&protocol=TCP&protocol=TCP&protocol=UDP&protocol=UDP&traffic-pattern=CCoQARoECAEQCiIYCAMQASoIMDAwMTAyMDMqCDA0MDUwNjA3
```

### Компактная форма (наше расширение, решение §7)

Для удобства импорта принимается компактный список портов с per-binding суффиксом протокола:

```
mierus://user:pass@1.2.3.4?port=2012,2020-2030/UDP,3000/TCP&profile=default
```

- элементы через запятую; у каждого элемента опциональный суффикс `/TCP` или `/UDP`;
- элемент без суффикса берёт протокол из единственного параметра `protocol=` (иначе `TCP`);
- смешивать компактную форму с несколькими `protocol=` нельзя (ошибка неоднозначности).

Компактная форма **только импортируется**; экспорт всегда канонический (upstream-совместимый),
поэтому round-trip «ссылка → UCI → ссылка» сохраняет все привязки без потерь
(строка нормализуется к каноническому виду; семантика идентична).

### Lenient-импорт (дополнительно принимается)

- порт в authority: `mierus://user:pass@host:2012` → одна TCP-привязка (с предупреждением);
- `#fragment` (отбрасывается), обрамляющие кавычки и пробелы;
- unicode-тире в диапазонах (`2020–2030` → `2020-2030`), пробелы внутри диапазона;
- короткие имена enum: `multiplexing=high`, `handshake-mode=no_wait`;
- отсутствие `profile=` → `default`; отсутствие `protocol=` → TCP для всех привязок (с предупреждением);
- посторонние параметры (например `socks5_port=` из диалекта alexxttss) игнорируются.

### Стандартные ссылки `mieru://` и JSON

- `mieru://<base64 protobuf ClientConfig>` (полный конфиг, `mieru export config`)
  в чистом JS не декодируется — UI отправляет её в rpcd-плагин, который вызывает
  **`mieru explain config <URL>`** и импортирует полученный JSON.
- JSON-конфиг клиента (`profiles[]`) импортируется напрямую (берётся активный профиль,
  первый сервер). Объект `trafficPattern` в JSON не может быть перекодирован в
  protobuf без бинарника — он отбрасывается с предупреждением (используйте ссылку
  `mierus://` для переноса traffic pattern без потерь).

### Экспорт

Вкладка **Import / Export**: «Generate link» (канонический `mierus://`),
«Generate JSON» (полный клиентский JSON, как генерирует init), Copy / Download.
Экспортируется **сохранённая** конфигурация (сначала нажмите Save).

## 4. UCI-схема и multi-port

`/etc/config/mieru`:

```
config mieru 'main'
	option enabled '0'
	option server_addr ''          # IP (v4/v6) или домен сервера mita
	option port '2012'             # основная привязка: порт или диапазон
	option protocol 'TCP'          # TCP | UDP
	option username ''
	option password ''
	option profile 'default'
	option socks5_port '1080'
	option socks5_listen_lan '1'
	option http_proxy_port ''      # пусто = HTTP-прокси выключен
	option http_proxy_listen_lan '0'
	option rpc_port '8964'         # локальный RPC (статус/метрики), ≠ socks5/http
	option mtu '1400'              # 1280–1400, как на сервере
	option multiplexing 'MULTIPLEXING_LOW'
	option handshake_mode 'HANDSHAKE_STANDARD'
	option log_level 'ERROR'
	option traffic_pattern ''      # base64 protobuf из ссылки (opaque)

config port_binding              # дополнительные привязки, по порядку
	option port '2020-2030'
	option protocol 'UDP'
```

- **Основная привязка** — `main.port` + `main.protocol`; каждая секция
  `port_binding` добавляет ещё одну (порт или диапазон, свой протокол).
  Порядок секций = порядок привязок в конфиге и ссылке (в UI поддерживается
  сортировка перетаскиванием).
- Init генерирует `portBindings[]` upstream-JSON: основная привязка + все секции.
  Mieru выбирает случайную привязку на каждое новое соединение.
- **Валидация** (UI и init): порт 1–65535, `start ≤ end`, протокол TCP/UDP;
  пересечения диапазонов **одного протокола** и дубликаты — предупреждение
  (кнопка «Check overlaps» на вкладке привязок и предупреждения при импорте);
  один порт на TCP и UDP одновременно — корректно, не предупреждение.
- Init (`/etc/init.d/mieru`, procd): проверка полей → генерация
  `/var/etc/mieru_client_config.json` (jshn, права 0600) → `mieru run` с env
  `MIERU_CONFIG_JSON_FILE` и `HOME=/root`; `respawn`, stdout/stderr → logd
  (`logread -e mieru`), `procd_add_reload_trigger mieru` (Save&Apply перезапускает клиент).
- **Traffic pattern**: protobuf нельзя выразить в JSON-конфиге, поэтому если
  `traffic_pattern` задан, init делает `mieru replace config <json>` +
  `mieru import config <mierus-ссылка>` (бинарник сам декодирует protobuf) и
  запускает клиент из сохранённого конфига (`/root/.config/mieru/client.conf.pb`).
  Без traffic pattern — чистый env-режим без записи во flash.

## 5. LuCI-интерфейс

Меню: **Services → Mieru** (`admin/services/mieru`, view `mieru/mieru`).

- **Settings** — сервер/порт/протокол, учётка (пароль маскирован), профиль,
  SOCKS5/HTTP/RPC порты и LAN-доступ, MTU, multiplexing, handshake, log level,
  traffic pattern; подсказка про SOCKS5-upstream для Podkop/Xray/OpenClash;
  Save & Apply / Save / Reset — стандартные кнопки form.Map.
- **Port Bindings** — таблица дополнительных привязок (порт/диапазон + TCP/UDP),
  добавление/удаление/сортировка, валидация, кнопка проверки пересечений.
- **Import / Export** — вставка ссылки/JSON → предпросмотр (поля + таблица привязок +
  предупреждения) → применение (заменяет привязки, включает сервис, commit+apply);
  экспорт ссылки/JSON, копирование, скачивание.
- **Status** (панель под вкладками, обновление раз в 5 с): состояние процесса
  (PID/uptime/RSS), версия клиента, автозапуск, SOCKS5 endpoint, трафик и скорость
  (из `mieru get metrics`), активные/underlay соединения; кнопки
  Start/Stop/Restart, **Test connection** (`mieru test`), лог (`logread -e mieru`).
  Постоянный демон-монитор **не используется** — статус по запросу через rpcd.

rpcd-плагин `luci.mieru` (ucode): `getStatus`, `getVersion`, `getLog`,
`testConnection`, `explainLink` (read), `serviceAction` (write, whitelist
start/stop/restart/enable/disable). Все shell-команды — из фиксированных строк
или с quoting/валидацией scheme; никаких опасных методов (удаление конфигов и т.п.).

**ACL** (`luci-app-mieru.json`, образец podkop + требования uhttpd 2026.11.05
pre-check ubus-scope): per-app `uci: [mieru]` read/write; `ubus luci.mieru`
(read-методы / write `serviceAction`); `ubus service: [list]`;
`file exec` на `/etc/init.d/mieru` и `/usr/bin/mieru`. Глобальный luci-base ACL
покрывает ubus-методы `uci` (get/set/add/apply/confirm…), per-app `uci`-секция
даёт доступ к конфигу `mieru`.

**i18n**: исходные строки EN, `po/ru/mieru.po` — полный перевод (116 строк),
`po/templates/mieru.pot`; собирается `luci-i18n-mieru-ru`. Покрытие проверяется
скриптом `tests/i18n-check.cjs`.

## 6. Валидация (без сборки OpenWrt)

Выполнено в этом репо:

- `node --check` — все JS (views + библиотека) и тесты; JSON-валидация menu.d/acl.d.
- **`node --test tests/` — 31 тест, все проходят**: одиночный порт, списки,
  диапазоны, TCP/UDP per-binding, компактная форма, IPv6, спецсимволы в учётке,
  невалидные кейсы (порты 0/65536, start>end, mismatch port/protocol, плохие
  enum/mtu/base64…), semantic round-trip, строковая стабильность генератора,
  **побайтовое воспроизведение эталонной ссылки из доков upstream**, предупреждения
  о пересечениях, импорт JSON, UCI-mapping round-trip.
- `node tests/i18n-check.cjs` — 116/116 строк покрыты pot и ru.
- ucode-плагин: синтаксис проверен хостовым `ucode -c` из сборочного дерева.
- `po/ru/mieru.po` компилируется реальным `po2lmo` из дерева (9412 байт .lmo).
- init: `dash -n` (POSIX-синтаксис) + функциональные тесты `is_port_spec`,
  `url_encode`, `build_share_link` (shell-генератор ссылки побайтово совпадает с JS).
- **Верификация против реального бинарника** `mieru 3.39.0 linux_amd64`
  (в WSL, изолированный HOME; роутер и сборочное дерево не затрагивались),
  12/12 проверок:
  - сгенерированные нами JSON-конфиги принимаются `mieru replace config`
    (полная upstream-валидация, включая multi-port и IPv6);
  - наши ссылки декодируются `mieru explain config`;
  - `mieru import config <наша ссылка>` → `mieru export config simple`
    **возвращает нашу ссылку побайтово** (3 кейса, включая IPv6 + спецсимволы);
  - traffic-pattern из эталонной ссылки проходит import→export без потерь;
  - `mieru run` с `MIERU_CONFIG_JSON_FILE` стартует, `mieru status` /
    `mieru get metrics` работают (группы `traffic`/`connections` подтверждены).

Что осталось проверить центральной сборкой/на роутере (см. также «Открытые вопросы»):
сборка пакета через `golang/host`, работа procd-инстанса и respawn на целевой
архитектуре, рендеринг UI в браузере, применение traffic pattern на реальном сервере.

## 7. Установка

### В сборочном дереве (CI / локально)

Репозиторий клонируется в `package/openwrt-mieru`; Makefile обоих пакетов
находятся рекурсивно (`mieru/Makefile`, `luci-app-mieru/Makefile`):

```sh
git clone https://github.com/IncubusRK/openwrt-mieru package/openwrt-mieru
./scripts/feeds update -a && ./scripts/feeds install -a   # если ещё не сделано
make menuconfig   # Network → Web Servers/Proxies → mieru; LuCI → Applications → luci-app-mieru (+ ru)
make package/openwrt-mieru/mieru/compile V=s
make package/openwrt-mieru/luci-app-mieru/compile V=s
```

Зависимости: `golang/host` (собирается автоматически), `luci-base`, `rpcd`, `ucode`.
На выходе: `mieru_3.39.0-r1_<arch>.apk` (или .ipk), `luci-app-mieru_1.0.0-r1_all.apk`,
`luci-i18n-mieru-ru_…apk`.

### На роутере

```sh
apk add mieru luci-app-mieru luci-i18n-mieru-ru   # или opkg install *.ipk
# настроить /etc/config/mieru (или через LuCI: Services → Mieru)
/etc/init.d/mieru enable
/etc/init.d/mieru start
logread -e mieru
```

## 8. Интеграция

mieru слушает SOCKS5 на `127.0.0.1:1080` (порт настраивается; без аутентификации).
Для локальных потребителей `socks5_listen_lan` можно выключить (безопаснее);
оставьте включённым, если прокси нужен другим устройствам LAN.

### Podkop / sing-box

Добавьте SOCKS-outbound в конфиг sing-box (Podkop использует sing-box):

```json
{
  "type": "socks",
  "tag": "mieru",
  "server": "127.0.0.1",
  "server_port": 1080,
  "version": "5"
}
```

и направьте нужный трафик в outbound `mieru` (правила маршрутизации Podkop/sing-box).

### Xray

```json
{
  "tag": "mieru",
  "protocol": "socks",
  "settings": {
    "servers": [ { "address": "127.0.0.1", "port": 1080 } ]
  }
}
```

### OpenClash (mihomo)

Два варианта:

1. **Нативный mieru** в mihomo (поддерживается upstream, отдельный клиент не нужен):

   ```yaml
   proxies:
     - name: mieru-native
       type: mieru
       server: 1.2.3.4
       port-range: 2012-2022   # либо port: 2027
       transport: TCP
       udp: true
       username: user
       password: pass
       multiplexing: MULTIPLEXING_HIGH
   ```

2. **Через наш клиент** (SOCKS5-upstream):

   ```yaml
   proxies:
     - name: mieru-socks
       type: socks5
       server: 127.0.0.1
       port: 1080
       udp: true
   ```

## 9. Структура репозитория

```
openwrt-mieru/
├── README.md
├── LICENSE                      # GPL-2.0-or-later (наш код)
├── .gitignore                   # _analysis/ не коммитится
├── .github/workflows/tests.yml  # node-тесты + i18n-проверка в CI
├── mieru/
│   ├── Makefile                 # source build, golang/host, CGO_ENABLED=0
│   └── files/
│       ├── mieru.config         # UCI defaults
│       └── mieru.init           # procd: UCI → JSON → mieru run
├── luci-app-mieru/
│   ├── Makefile                 # luci.mk, LUCI_PKGARCH:=all
│   ├── htdocs/luci-static/resources/view/mieru/
│   │   ├── mieru.js             # entry: вкладки + статус-панель
│   │   ├── settings.js          # вкладка Settings
│   │   ├── bindings.js          # вкладка Port Bindings (GridSection)
│   │   ├── importexport.js      # вкладка Import / Export
│   │   ├── status.js            # статус, метрики, лог, кнопки управления
│   │   └── mieru-link.js        # чистый парсер/генератор (общий с тестами)
│   ├── root/
│   │   ├── usr/share/luci/menu.d/luci-app-mieru.json
│   │   ├── usr/share/rpcd/acl.d/luci-app-mieru.json
│   │   ├── usr/share/rpcd/ucode/luci.mieru
│   │   └── etc/uci-defaults/50_luci-mieru
│   └── po/
│       ├── templates/mieru.pot
│       └── ru/mieru.po
└── tests/
    ├── mieru-link.test.cjs      # node --test tests/
    └── i18n-check.cjs           # node tests/i18n-check.cjs
```

## 10. Лицензии

- **Наш код** (Makefile, init, UCI, LuCI views, rpcd-плагин, библиотека ссылок,
  тесты, документация): **GPL-2.0-or-later** — см. `LICENSE`.
- **Upstream mieru** (enfein/mieru): **GPL-3.0-or-later** — указывается в
  `mieru/Makefile` (`PKG_LICENSE`, `PKG_LICENSE_FILES:=LICENSE`); бинарник
  собирается из исходников upstream и распространяется под его лицензией.
- Референс alexxttss/mieru-openwrt **не имеет лицензии** — его код не используется
  (см. [Гейт анализа](#1-гейт-анализа-этап-0-и-clean-room)).

## 11. Открытые вопросы / что проверить при сборке

1. **Сборка через golang/host**: go.mod upstream требует go ≥ 1.20, в дереве go1.27 —
   совместимо; проверить, что `GO_PKG_VARS+=CGO_ENABLED=0` корректно переопределяет
   дефолтный `CGO_ENABLED=1` из `GO_PKG_TARGET_VARS` (последнее присваивание в env
   побеждает; паттерн подтверждён BUILD_LOG референса).
2. **procd на целевой платформе**: корректность SIGTERM-останова `mieru run`,
   respawn, попадание stdout в `logread -e mieru`; поведение file-trigger.
3. **UI в браузере**: рендеринг вкладок/грида, модальное окно импорта,
   Save&Apply → автоперезапуск через reload trigger; работа кнопок статуса.
4. **Traffic pattern на реальном сервере**: режим replace+import проверен на
   linux_amd64 в WSL; на роутере добавляется запись в `/root/.config/mieru/` (flash) —
   только при заданном traffic pattern и только на (ре)старте.
5. **Ссылки `mieru://`**: импорт зависит от наличия бинарника (пакет mieru
   установлен — зависимость luci-app-mieru); без него UI покажет ошибку rpcd.
6. Возможное расширение: импорт нескольких серверов/профилей (сейчас берётся
   активный профиль и первый сервер — как в simple-ссылках upstream).