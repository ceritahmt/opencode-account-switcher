# AGENTS.md

Bu dosya, bu repository üzerinde çalışan AI coding agent’ları için project-specific çalışma kurallarını, mimari notları ve güvenlik sınırlarını tanımlar.

## Dil ve İletişim

- Kullanıcıya yapılan açıklamalar Türkçe olmalı.
- Teknik terimler English bırakılmalı: `function`, `class`, `method`, `interface`, `command`, `flag`, `config`, `plugin`, `provider`, `profile`, `logger`.
- Code identifier’ları çevrilmemeli.
- Belirsiz veya kapsamı eksik isteklerde önce kısa netleştirme sorusu sorulmalı.
- Gereksiz uzun açıklama yapılmamalı; yapılan değişiklikler kısa ve net özetlenmeli.

## Project Özeti

`opencode-as`, OpenCode için OpenAI account/profile switcher’dır.

Temel amaç:

- OpenCode’un aktif provider auth dosyasından sadece seçili provider objesini almak.
- Bu objeyi named profile olarak saklamak.
- İstenilen profile’ı tekrar OpenCode auth dosyasına merge ederek aktif etmek.
- TUI tarafında `/as-connect` ve `/as-accounts` native slash command’leri ile kullanıcı akışı sağlamak.

## Önemli Command’ler

```bash
npm run build
npm test
npm run as -- --help
npm run as -- list
npm run as -- who
npm run as -- add <profile> --provider openai --current
npm run as -- update <profile> --provider openai --current
npm run as -- use <profile>
npm run as -- rm <profile>
```

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
  - Şu an desteklenen provider: `openai`.
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

### TUI Plugin

- `as-tui.ts`
  - Native OpenCode TUI plugin.
  - `/as-connect`: OpenAI provider connect flow + auto-save.
  - `/as-accounts`: Profile listesi + action seçimi.
  - TUI içinde CLI spawn etmek için `process.execPath` kullanma; OpenCode runtime’da bu `opencode` executable olabilir.
  - Bunun yerine built module dynamic import kullan:

```ts
import(pathToFileURL(path.join(process.cwd(), "dist", "src", "index.js")).href)
```

## TUI Command Davranışları

### `/as-connect`

Beklenen akış:

1. `Profile Name` prompt açılır.
2. Input her açılışta boş olmalı.
3. `provider.connect` native OpenCode command’i trigger edilir.
4. `~/.local/share/opencode/auth.json` içindeki OpenAI provider hash değişimi beklenir.
5. Auth değişirse `runCli(["add", profile, "--provider", "openai", "--current"])` ile profile kaydedilir.

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
  - Profile summary ve expiry extraction.
- `test/log.test.ts`
  - JSONL logger ve redaction.
- `test/paths.test.ts`
  - Storage/log path layout.
- `test/tui-plugin.test.ts`
  - TUI plugin registration ve source-level behavior guard.
- `test/command-doc.test.ts`
  - Legacy markdown command’in kaldırıldığını ve native `/as-connect` command’in kaldığını doğrular.

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
