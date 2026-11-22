# openwrt-mieru

OpenWrt packages for the **[mieru](https://github.com/enfein/mieru)** proxy
client (upstream enfein/mieru, GPL-3.0-or-later):

| Package | Purpose |
|---|---|
| `mieru/` | client binary (built from Go sources, `CGO_ENABLED=0`), UCI config, procd init with **multi-port/range** bindings |
| `luci-app-mieru/` | LuCI UI: settings, port bindings, `mierus://` link import/export, status & metrics; EN + full RU |

**English** | [Русский](#русский)

## English

The mieru client exposes a local **SOCKS5** (and optional HTTP/HTTPS) proxy —
use it as an upstream in **Podkop / Xray / OpenClash**.

### Features

- **Multi-port/range bindings**: main port plus any number of extra
  `port_binding` sections, each a single port or `start-end` range with its
  own TCP/UDP protocol; validation and overlap warnings.
- **Upstream-compatible `mierus://` links**: import and export; the generator
  reproduces `mieru export config simple` byte-for-byte (verified against the
  real v3.39.0 binary). Compact import form supported
  (`port=2012,2020-2030/UDP,3000/TCP`); export is always canonical, so
  link → UCI → link round-trips losslessly.
- Also imports `mieru://` (base64 protobuf, via `mieru explain config`) and
  client JSON configs; traffic-pattern protobuf is preserved opaquely.
- **Status panel**: process state, version, traffic/speed and connections from
  `mieru get metrics`, Start/Stop/Restart, **Test connection** (`mieru test`),
  log view. On-demand rpcd queries — no permanent monitor daemon.
- **procd init**: UCI → upstream JSON config → `mieru run` with
  `MIERU_CONFIG_JSON_FILE`, respawn, reload trigger (Save & Apply restarts the
  client), logs to logd.
- **Clean-room implementation**: written from scratch against upstream
  enfein/mieru docs/sources; no code copied from third-party OpenWrt ports.
- Builds for all `golang/host` architectures (target: Banana Pi BPI-R4,
  `aarch64_cortex-a53`).
- i18n: English source strings, full Russian translation (`luci-i18n-mieru-ru`).

### Install

Clone into an OpenWrt build tree (both Makefiles are found recursively):

```sh
git clone https://github.com/IncubusRK/openwrt-mieru.git package/openwrt-mieru
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # Network → Web Servers/Proxies → mieru; LuCI → Applications → luci-app-mieru
make package/openwrt-mieru/mieru/compile V=s
make package/openwrt-mieru/luci-app-mieru/compile V=s
```

On the router: `apk add mieru luci-app-mieru luci-i18n-mieru-ru`, then
configure via **Services → Mieru** and start the service. Default SOCKS5:
`127.0.0.1:1080` (LAN access configurable), service disabled until configured.

### Tests

```sh
node --test tests/mieru-link.test.cjs   # 31 link parser/generator tests
node tests/i18n-check.cjs   # 116/116 EN → ru coverage
```

CI runs these on every push (`.github/workflows/tests.yml`).

### Documentation

Detailed Russian documentation (link format, UCI schema, init internals,
integration examples, validation log): [docs/details.ru.md](docs/details.ru.md).

Developed for the [IncubusRK/openwrt-bpi-r4](https://github.com/IncubusRK/openwrt-bpi-r4)
firmware recipe (Banana Pi BPI-R4, OpenWrt main / LuCI master); built into the
FULL image and verified on device 2026-11-22 (mieru 3.39.0, multi-port import
checked in the UI).

### Licenses

- **Our code** (Makefiles, init, UCI, LuCI views, rpcd plugin, link library,
  tests, docs): **GPL-2.0-or-later** — see [LICENSE](LICENSE).
- **Upstream mieru** binary: **GPL-3.0-or-later** (declared in `mieru/Makefile`;
  built from upstream sources).

---

## Русский

Пакеты OpenWrt для прокси-клиента **[mieru](https://github.com/enfein/mieru)**
(upstream enfein/mieru, GPL-3.0-or-later): `mieru/` — клиентский бинарник
(сборка из исходников Go), UCI-конфиг и procd init; `luci-app-mieru/` —
LuCI-интерфейс (настройки, привязки портов, импорт/экспорт ссылок `mierus://`,
статус и метрики; EN + полный RU).

Клиент mieru поднимает локальный **SOCKS5** (и опционально HTTP/HTTPS) прокси —
используйте его как upstream в **Podkop / Xray / OpenClash**.

### Возможности

- **Multi-port/range привязки**: основной порт + любое число дополнительных
  секций `port_binding` (порт или диапазон `start-end`, свой протокол TCP/UDP
  на каждую); валидация и предупреждения о пересечениях.
- **Совместимые с upstream ссылки `mierus://`**: импорт и экспорт; генератор
  воспроизводит `mieru export config simple` побайтово (проверено против
  реального бинарника v3.39.0). Поддерживается компактная форма импорта
  (`port=2012,2020-2030/UDP,3000/TCP`); экспорт всегда канонический, поэтому
  round-trip «ссылка → UCI → ссылка» без потерь.
- Также импортируются `mieru://` (base64 protobuf, через `mieru explain config`)
  и JSON-конфиги клиента; traffic-pattern protobuf сохраняется без изменений.
- **Панель статуса**: состояние процесса, версия, трафик/скорость и соединения
  из `mieru get metrics`, Start/Stop/Restart, **Test connection** (`mieru test`),
  лог. Запросы через rpcd по требованию — постоянного демона-монитора нет.
- **procd init**: UCI → upstream JSON-конфиг → `mieru run` с
  `MIERU_CONFIG_JSON_FILE`, respawn, reload trigger (Save & Apply перезапускает
  клиент), логи в logd.
- **Clean-room реализация**: написано с нуля по документации/исходникам
  upstream enfein/mieru; код сторонних OpenWrt-портов не копировался.
- Собирается для всех архитектур `golang/host` (целевая: Banana Pi BPI-R4,
  `aarch64_cortex-a53`).
- Локализация: исходные строки EN, полный русский перевод (`luci-i18n-mieru-ru`).

### Установка

Клонирование в дерево OpenWrt (оба Makefile находятся рекурсивно):

```sh
git clone https://github.com/IncubusRK/openwrt-mieru.git package/openwrt-mieru
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # Network → Web Servers/Proxies → mieru; LuCI → Applications → luci-app-mieru
make package/openwrt-mieru/mieru/compile V=s
make package/openwrt-mieru/luci-app-mieru/compile V=s
```

На роутере: `apk add mieru luci-app-mieru luci-i18n-mieru-ru`, настройка через
**Services → Mieru**, затем запуск службы. SOCKS5 по умолчанию:
`127.0.0.1:1080` (LAN-доступ настраивается), служба выключена до настройки.

### Тесты

```sh
node --test tests/mieru-link.test.cjs   # 31 тест парсера/генератора ссылок
node tests/i18n-check.cjs   # покрытие EN → ru: 116/116
```

CI запускает их на каждый push (`.github/workflows/tests.yml`).

### Документация

Подробная документация (формат ссылок, UCI-схема, устройство init, примеры
интеграции, журнал валидации): [docs/details.ru.md](docs/details.ru.md).

Разработано для рецепта прошивки
[IncubusRK/openwrt-bpi-r4](https://github.com/IncubusRK/openwrt-bpi-r4)
(Banana Pi BPI-R4, OpenWrt main / LuCI master); включено в FULL-образ и
проверено на устройстве 2026-11-22 (mieru 3.39.0, импорт multi-port ссылки
проверен в UI).

### Лицензии

- **Наш код** (Makefile, init, UCI, LuCI views, rpcd-плагин, библиотека ссылок,
  тесты, документация): **GPL-2.0-or-later** — см. [LICENSE](LICENSE).
- **Бинарник upstream mieru**: **GPL-3.0-or-later** (указан в `mieru/Makefile`;
  собирается из исходников upstream).
