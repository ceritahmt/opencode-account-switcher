# AGENTS.md

Bu dosya, bu repository üzerinde çalışan AI coding agent’ları için project-specific çalışma kurallarını, mimari notları ve güvenlik sınırlarını tanımlar.

## Dil ve İletişim

- Kullanıcıya yapılan açıklamalar Türkçe olmalı.
- Teknik terimler English bırakılmalı: `function`, `class`, `method`, `interface`, `command`, `flag`, `config`, `plugin`, `provider`, `profile`, `logger`.
- Code identifier’ları çevrilmemeli.
- Belirsiz veya kapsamı eksik isteklerde önce kısa netleştirme sorusu sorulmalı.
- Gereksiz uzun açıklama yapılmamalı; yapılan değişiklikler kısa ve net özetlenmeli.

## Project Özeti

`@ceritahmt/opencode-as`, OpenCode için provider account/profile switcher’dır. CLI bin adı `opencode-as` olarak kalır.

Temel amaç:

- OpenCode’un aktif provider auth dosyasından sadece seçili provider objesini almak.
- Bu objeyi named profile olarak saklamak.
- İstenilen profile’ı tekrar OpenCode auth dosyasına merge ederek aktif etmek.
- TUI tarafında `/as-connect`, `/as-accounts`, `/as-settings`, `/as-export` ve `/as-import` native slash command’leri ile kullanıcı akışı sağlamak.
- OpenCode usage-limit event’lerinde aktif account’u limited olarak işaretlemek ve gerekirse sonraki profile’a geçmek.

Published package kurulumu için önerilen yol:

```bash
opencode plugin @ceritahmt/opencode-as@latest --global
```

Bu installer package `exports["./server"]` ve `exports["./tui"]` target’larını okuyup server plugin’i `opencode.json`, TUI slash command plugin’ini `tui.json` tarafına ekleyebilir. Sadece `opencode.json` içine manuel package eklenirse server hook’lar çalışabilir ama `/as-connect`, `/as-accounts`, `/as-settings`, `/as-export`, `/as-import` görünmeyebilir.

OpenCode `@latest` spec’ini cache’leyebilir. Installer output’unda sadece `Detected server target` görünürse cache eski package’ı okuyordur; exact version ile `opencode plugin @ceritahmt/opencode-as@<version> --global --force` öner veya `~/.cache/opencode/packages/@ceritahmt/opencode-as@latest` cache’ini temizlet.

## Önemli Command’ler

```bash
npm run build
npm test
```

Kullanıcı akışı OpenCode TUI içinde `/as-connect`, `/as-accounts`, `/as-settings`, `/as-export`, `/as-import` üzerinden anlatılmalı; README veya user-facing dokümanda `npm run as -- use/add --provider openai` örnekleri önerilmemeli.

Her code değişikliğinden sonra en azından şunu çalıştır:

```bash
npm test
```

## Storage Layout

Default project data root:

```text
~/.local/share/opencode/opencode-as-account/
```

Alt klasörler:

```text
~/.local/share/opencode/opencode-as-account/
├── profiles/
├── logs/
├── backups/
├── trash/
├── config.json
└── lock
```

`config.json` içinde `activeProfile`, `settings.autoSwitch` ve local `profileStatus` bilgileri tutulur. `profileStatus` limited account marker’ları içindir; `limitedAt`, `limitedReason`, `availableAt` tutar ve auth secret içermez.

OpenCode’un aktif auth dosyası burada kalır:

```text
~/.local/share/opencode/auth.json
```

Profile snapshot path’i:

```text
~/.local/share/opencode/opencode-as-account/profiles/<profile-name>/auth.json
```

Metadata path’i:

```text
~/.local/share/opencode/opencode-as-account/profiles/<profile-name>/metadata.json
```

Log path’i:

```text
~/.local/share/opencode/opencode-as-account/logs/logYYYYMMDD.log
```

Environment override’ları:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
XDG_DATA_HOME=/tmp/xdg-data
```

## Güvenlik Kuralları

- Auth secret, token, key veya credential değerleri stdout/stderr/log içinde raw olarak yazılmamalı.
- `profiles/`, `backups/`, `trash/` auth secret içerir; bu dosyaları commit etme.
- `.env`, credential JSON, gerçek `auth.json`, generated secret dosyaları commit edilmemeli.
- Profile save/update sırasında sadece seçili provider objesi saklanmalı; tüm OpenCode auth dosyası profile içine kopyalanmamalı.
- `rm` secure delete yapmaz; profile’ı `trash/` altına taşır. Kullanıcıya bunu açık belirt.
- Logging command execution’ı asla bozmayacak şekilde best-effort olmalı.

## Mimari Dosya Haritası

### CLI

- `src/cli.ts`
  - CLI entry ve `runCli(argv, env)` public function.
  - `add`, `update`, `use`, `rm/remove`, `list/ls`, `who`, `providers`, `help` command’lerini yönetir.
  - Project-wide logger ile command lifecycle log yazar.

### Profile Store

- `src/profile-store.ts`
  - `ProfileStore` class.
  - Profile create/update/use/remove/list/status akışları burada.
  - Atomic write, lock, rollback ve backup mantığı burada tutulur.

### Provider Auth

- `src/provider-auth.ts`
  - Provider auth extraction ve merge logic.
  - Provider id’leri OpenCode `auth.json` içindeki provider key’lerinden dinamik okunur; örn. `openai`, `zai-coding-plan`.
  - `extractProviderAuth()` sadece provider objesini çıkarır.
  - `mergeProviderAuth()` aktif auth dosyasındaki diğer provider’ları korur.

### Paths

- `src/paths.ts`
  - Runtime path hesaplamaları.
  - `getRuntimePaths()` ve `getDailyLogPath()` burada.
  - Default project root `~/.local/share/opencode/opencode-as-account/` olmalı.

### Logger

- `src/log.ts`
  - Project-wide pino-like JSONL logger.
  - `appendProjectLog()` ve `appendDebugLog()` export edilir.
  - Log entry shape: `time`, `level`, `event`, `details`.
  - Redaction burada yapılır.

### Profile Summary

- `src/profile-summary.ts`
  - `/as-accounts` için profile summary listesi üretir.
  - `expires_at`, `expiresAt`, `expires`, `expiry`, `expiration` benzeri field’lardan expiry çıkarır.
  - `config.profileStatus` üzerinden limited account bilgisini summary’ye ekler.

### Account Settings

- `src/account-settings.ts`
  - `/as-settings` için account settings ve limited profile runtime state helper’larını içerir.
  - `loadAccountSettings()`, `setAutoSwitch()`, `markActiveProfileLimited()`, `clearLimitedProfiles()`, `findNextAvailableProfile()` export eder.
  - Config mutation işlemlerini lock içinde yapar.

### Account Transfer

- `src/account-transfer.ts`
  - `/as-export` ve `/as-import` için encrypted all-account backup/restore helper’larını içerir.
  - `exportAccountsEncrypted()`, `importAccountsEncrypted()`, `getDefaultAccountExportPath()` export eder.
  - Export default current working directory içinde `as-account-exported.json.enc` dosyasına yazılır.
  - Export içeriği tüm profile `auth.json` snapshot’ları, `metadata.json`, settings ve local `profileStatus` bilgilerini içerir.
  - Dosya encrypted olduğu halde auth secret içerdiği varsayılmalı; plain JSON export önerilmez.
  - Import mevcut profile’ların üzerine yazmamalı; conflict varsa fail etmeli.

### TUI Plugin

- `src/tui-plugin.ts`
  - Native OpenCode TUI plugin.
  - Package `./tui` export’u olarak publish edilir.
  - Published TUI config içinde `.opencode/tui.json` `plugin: ["@ceritahmt/opencode-as@latest"]` şeklinde yüklenir.
  - Local dev shim: `.opencode/plugins/as-tui.ts` built `dist/src/tui-plugin.js` default export’unu re-export eder.
  - Local dev config `.opencode/tui.json` `plugin: ["./plugins/as-tui.ts"]` kullanır; `npm run build` sonrası OpenCode restart gerekir.
  - `/as-connect`: Provider connect flow + değişen provider auto-detect + auto-save.
  - `/as-accounts`: Profile listesi + action seçimi.
  - `/as-settings`: Auto-switch ayarı, limited marker temizleme ve version bilgisi.
  - `/as-export`: Current working directory içine encrypted account backup oluşturur.
  - `/as-import`: Encrypted backup path ve passphrase alıp account profile’larını import eder.
  - TUI event bus üzerinden usage-limit sinyali yakalamayı dener.
  - Server plugin tarafından yazılan persisted limited state’i polling ile görüp confirmation/auto-switch akışını başlatır.
  - TUI içinde CLI spawn etmek için `process.execPath` kullanma; OpenCode runtime’da bu `opencode` executable olabilir.
  - Bunun yerine package içinde relative built module dynamic import kullan:

```ts
import("./index.js")
```

### Server Plugin

- `src/server-plugin.ts`
  - Package root default export olarak yayınlanan OpenCode server plugin.
  - Package `./server` export’u olarak da publish edilir.
  - Published config içinde `.opencode/opencode.json` `plugin: ["@ceritahmt/opencode-as@latest"]` şeklinde yüklenir.
  - Local dev shim: `.opencode/plugins/as-server.ts` built `dist/src/server-plugin.js` default export’unu re-export eder.
  - Local dev config `.opencode/opencode.json` `plugin: ["./plugins/as-server.ts"]` kullanır; `npm run build` sonrası OpenCode restart gerekir.
  - `event` hook ile `session.next.retried`, `session.error`, `session.next.step.failed`, `session.status`, `message.updated` event’lerini dinler.
  - `usage limit` veya `limit has been reached` text yakalanırsa `attempt #1` için sadece log yazar; `attempt #2` ve sonrası aktif profile’ı 5 saat limited işaretler.
  - TUI plugin bu persisted limited marker’ı okuyup confirmation veya auto-switch akışını çalıştırır.

## TUI Command Davranışları

### `/as-connect`

Beklenen akış:

1. `Profile Name` prompt açılır.
2. Input her açılışta boş olmalı.
3. `provider.connect` native OpenCode command’i trigger edilir.
4. `~/.local/share/opencode/auth.json` içindeki provider hash değişimi beklenir.
5. Auth değişirse değişen provider auto-detect edilir ve `runCli(["add", profile, "--provider", detectedProvider, "--current"])` ile profile kaydedilir.

### `/as-accounts`

Beklenen akış:

1. Kayıtlı profile’lar `DialogSelect` ile listelenir.
2. Aktif profile işaretlenir.
3. Expire bilgisi varsa description içinde gösterilir.
4. Profile seçildikten sonra action seçilir:
   - `Use`
   - `Reconnect`
   - `Delete`
5. `Delete` confirmation ister ve `rm` command’i ile `trash/` altına taşır.
6. `Reconnect` expire yenilemek için provider reconnect flow çalıştırır ve mevcut profile snapshot’ını update eder.

### `/as-settings`

Beklenen akış:

1. `Account Settings` dialog açılır.
2. `Auto-switch: Enabled` seçilirse `settings.autoSwitch = true` yazılır.
3. `Auto-switch: Disabled` seçilirse `settings.autoSwitch = false` yazılır.
4. `Clear limited markers` seçilirse `profileStatus` altındaki limited marker’lar temizlenir.
5. Dialog içinde installed package version read-only olarak gösterilir.

### `/as-export`

Beklenen akış:

1. `Export Passphrase` prompt açılır.
2. Passphrase boşsa error toast gösterilir.
3. Current working directory içine `as-account-exported.json.enc` yazılır.
4. Dosya zaten varsa overwrite yapılmaz; error toast gösterilir.
5. Export tüm profile auth snapshot’larını, metadata’yı, settings’i ve local limited marker’ları encrypted payload içinde taşır.

### `/as-import`

Beklenen akış:

1. `Import File Path` prompt açılır; default değer `as-account-exported.json.enc` olur.
2. Native file picker yoktur; path kullanıcıdan text olarak alınır.
3. `Import Passphrase` prompt açılır.
4. Export decrypt edilir ve tüm profile’lar import edilir.
5. Mevcut profile ile isim çakışması varsa overwrite yapılmaz; import fail eder.

### Usage Limit Auto-switch

Beklenen akış:

1. Server/TUI plugin `session.next.retried`, `session.error`, `session.next.step.failed`, `session.status`, `message.updated` ve `tui.toast.show` event’lerini dinler.
2. Event text içinde sadece `usage limit` veya `limit has been reached` ifadeleri aranır.
3. `session.next.retried` için `attempt #1` sadece loglanır; `attempt #2` ve sonrası switch akışını başlatır.
4. Eşik geçilince aktif profile `limitedAt`, `limitedReason` ve 5 saat sonrası için `availableAt` ile işaretlenir.
5. Sonraki limited olmayan profile bulunur.
6. `settings.autoSwitch = false` ise switch için confirmation istenir.
7. `settings.autoSwitch = true` ise `runCli(["use", nextProfile])` ile otomatik geçilir.
8. Auth secret veya provider response body raw olarak loglanmamalı; reason summary/truncation ile yazılmalı.

## Logger Kuralları

- Log formatı JSONL olmalı.
- Her satır parse edilebilir JSON olmalı.
- Büyük `stderr` veya help output’ları log’a full basılmamalı; summary/truncation kullanılmalı.
- Redaction yapılmadan hiçbir user/provider/auth value log’a yazılmamalı.
- Logger hatası command veya TUI flow’u kırmamalı.

Örnek log:

```json
{"time":"2026-05-06T17:56:15.441Z","level":"info","event":"cli command started","details":["command: --help","args: <none>"]}
```

## Test Stratejisi

Mevcut test dosyaları:

- `test/profile-store.test.ts`
  - Profile save/use/remove/status behavior.
- `test/provider-auth.test.ts`
  - Provider extraction/merge validation.
- `test/profile-summary.test.ts`
  - Profile summary, expiry extraction, account settings ve limited status behavior.
- `test/log.test.ts`
  - JSONL logger ve redaction.
- `test/paths.test.ts`
  - Storage/log path layout.
- `test/tui-plugin.test.ts`
  - TUI plugin registration, settings command, event hook ve source-level behavior guard.
- `test/command-doc.test.ts`
  - Legacy markdown command’in kaldırıldığını ve native slash command listesini doğrular.

Yeni behavior eklenirse test ekle veya ilgili testi güncelle.

## Kod Standartları

- TypeScript strict uyumlu code yaz.
- Gereksiz abstraction ekleme.
- File operation’larda atomic/safe helper’ları tercih et:
  - `atomicWriteFile`
  - `ensureSecureDir`
  - `fsyncDirectory`
  - `pathExists`
  - `readTextFile`
  - `readJsonFile`
- Profile mutation işlemleri lock içinde olmalı.
- Auth update/switch işlemlerinde rollback düşünülmeli.
- TUI plugin içinde user-facing message kısa ve actionable olmalı.

## Yapılmaması Gerekenler

- Legacy markdown command dosyası geri eklenmemeli.
- Yeni markdown slash command oluşturulmamalı.
- `process.execPath` ile CLI spawn etme.
- Auth secret’ları test snapshot, README veya log içine raw yazma.
- `profiles/`, `logs/`, `backups/`, `trash/`, `auth.json` gibi runtime data’ları repository’ye ekleme.
- Build output `dist/` üzerinde manuel edit yapma; source TypeScript’i değiştir.

## Release/Validation Checklist

Değişiklik bitince:

1. `npm test` çalıştır.
2. Storage path değiştiyse `README.md` ve `test/paths.test.ts` güncelle.
3. TUI command değiştiyse `test/tui-plugin.test.ts` güncelle.
4. Auth/profile behavior değiştiyse `test/profile-store.test.ts` veya `test/profile-summary.test.ts` güncelle.
5. Logger behavior değiştiyse `test/log.test.ts` güncelle.
6. Kullanıcıya kısa özet ve test sonucunu bildir.
