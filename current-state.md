# M2 · Kalan iş planı

Temel: `master` @ `e7798a1` (PR #94 merge sonrası). Spec: `docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md`.

## Durum

Kapatıldı (bu oturumda): **#41** (Advanced — altı maddesi de kodda, doğrulandı), **#34** (yedi maddesinin altısı #90'da; arayüz dili maddesi **#95**'e taşındı).

M2'de kalan: **#28, #30** → PR A · **#29, #32** → PR B · **#40** → PR C · **#44, #42** → PR D.
M2 dışı: **#95** (i18n katmanı — milestone atanmadı, senin kararın).

## Bu depoda çalışma kuralları

Uygulayacak ajanın bilmesi gerekenler:

- **Ponytail.** Merdivenin ilk tutan basamağında dur. İstenmemiş soyutlama yok, tek uygulamalı arayüz yok, "ileride lazım olur" iskelesi yok. En kısa çalışan diff kazanır. Bilinçli sadeleştirme `// ponytail:` yorumuyla işaretlenir ve tavanını söyler.
- **`*.check.ts`.** `scripts/check.mjs` `src/` altındaki her `*.check.ts` dosyasını çalıştırır, biri patlarsa 1 döner. Önemsiz olmayan her mantık **bir** çalışabilir kontrol bırakır. Şu an 29 dosya.
- **Değişmez defteri.** `src/lib/invariants.check.ts` (27 satır) ve `src/lib/states.check.ts` (§7, 9 satır, hepsi cevaplı). Bir satırın karşılığı yazıldığında `pending` yerine `assertedIn: [{file, marker}]` konur; marker hedef dosyada yorum olarak geçer. Yeni durum eklersen deftere de ekle.
- **Ayarların tek yazma kapısı.** `applyPatch` (`src/lib/rules.ts`); App'in `update()`'i tek yazardır. Doğrudan `setSettings` yok.
- **Dil adı kapısı.** `src/lib/lang.check.ts` `src/` içinde paket dili adı literali arar; yalnızca `*.check.ts`, `src/lib/packs/`, `src/lib/langs.ts`, `src/lib/settings.ts` serbest. Bir dil adı göstermen gerekiyorsa parametre olarak al.
- **Metin.** Yorumlar *neden*i anlatır, *ne*yi değil, ve deponun mevcut sesiyle yazılır. Ekrandaki her cümle §6'ya tabi: sayı tek başına durmaz, teknik terim ana akışta geçmez, hiçbir cümle bir başkasıyla çelişmez.
- **Kapılar:** `npm run check`, `npx tsc --noEmit`, `npm run build` — üçü de commit öncesi temiz.
- **PR gövdesi**: ne bozuktu, ne yapıldı, neden bu şekilde, ne doğrulandı, ne bırakıldı. `Closes #N` satırları.

---

# PR A — #28 + #30 · Üst gezinme ve tek klavye haritası

Branch önerisi: `feat/m2-nav-keymap`.

Birlikte, çünkü ikisi tek bir eksikliğin iki yüzü: uygulamanın kısayolları hakkında **tek bir doğru kaynağı yok**. #28 topbar'daki rakamların kısayol gibi okunmasını istiyor, #30 duyurulan kısayol sayısının çalışan sayıya eşit olmasını istiyor. İkincisi olmadan birincisi yalan söyler.

## Bulunan somut ihlaller

Bunlar tahmin değil, kodda okundu. Uygulayan ajan işe bunları doğrulayarak başlasın.

**Klavye (#30):**

1. **Yedi ayrı global `keydown` dinleyicisi** birbirinden habersiz: [App.tsx:303](src/App.tsx:303), [Settings.tsx:110](src/views/Settings.tsx:110), [Onboarding.tsx:303](src/views/Onboarding.tsx:303), [Memory.tsx:167](src/views/Memory.tsx:167), [Prompter.tsx:220](src/views/read/Prompter.tsx:220), [Passage.tsx:48](src/views/read/Passage.tsx:48). Ayrıca yerel `onKeyDown`'lar: [Talk.tsx:360](src/views/Talk.tsx:360), [AskSheet.tsx:67](src/views/read/AskSheet.tsx:67), [Onboarding.tsx:86](src/views/Onboarding.tsx:86).
2. **Topbar `1`'i Today'in yanına yazıyor, Talk ekranında `1` Today'e gitmiyor.** [App.tsx:350](src/App.tsx:350) önerileri `1`–`3`'e bağlıyor ve `return` ediyor; nav haritasına hiç ulaşılmıyor. Altı ekranın birinde topbar'ın vaadi yanlış. **#28 ile #30'un kesiştiği yer burası.**
3. **`Space` iki şey demek:** Memory tekrarında kartı açıyor ([Memory.tsx:157](src/views/Memory.tsx:157)), Prompter'da oynat/duraklat ([Prompter.tsx:195](src/views/read/Prompter.tsx:195)). #30'un birinci maddesinin doğrudan ihlali.
4. **Listening bir medya yüzeyi ve hiç tuş dinlemiyor.** `listening.play()` / `listening.stop` var, `Space` yok. §3.1'in "Space = medya yüzeylerinde oynat/duraklat" satırı yarım.
5. **Palet var olmayan kısayol duyuruyor.** Palet `R` (resurface) ve `P` (teleprompter) yazıyor; App'te global `R` yok, `P` yalnızca Read'de ve metin yüklüyken çalışıyor. Prompter'ın kendi `R`'si "baştan başlat" demek. Duyurulan ≠ çalışan.
6. **Settings'in `[` `]` `↑` `↓` bölüm gezintisi hiçbir yerde duyurulmuyor** — Settings'in `hints` satırı hiç yok.
7. **`,` → Settings çalışıyor**, yalnızca paletin içinde duyuruluyor; Today'in ipucu satırı "1–6 spaces" diyor.
8. **İpucu satırları dört dosyada elle yazılmış** ([Today.tsx:199](src/views/Today.tsx:199), [Passage.tsx:120](src/views/read/Passage.tsx:120), [Prompter.tsx:296](src/views/read/Prompter.tsx:296), [Onboarding.tsx:718](src/views/Onboarding.tsx:718)) ve hiçbiri kendi handler'ından türemiyor. İki liste, tek doğruluk iddiası.

**Topbar (#28), [App.tsx:459-497](src/App.tsx:459) — §4.3'ün dört maddesi, dördü de ihlalde:**

9. `.status` düğmesi `Ollama · local` yazıyor. §4.3: sağlayıcının ticari adı orada geçmez.
10. `.dots` şeridi etiketsiz bir gösterge. §4.3: "Etiketsiz hiçbir gösterge bulunmaz."
11. Ayarlara **görünür** giriş yok: fareyle giden tek yol, üstünde "Settings" yazmayan durum düğmesi (yalnızca `title`'da).
12. `.nav-item .k` rakamları kısayol mu sayaç mı belli değil ve gerçek bir bekleyen sayısı (Memory'de tekrarı gelen kelimeler) hiçbir yerde görünmüyor.

## Yapılacaklar

### A1 · `src/lib/keys.ts` — tek tablo

Tasarım, "duyurulan == çalışan"ı iddia değil **yapı** hâline getirir: tabloda olmayan tuş ateşleyemez, tabloda olan tuş duyurulur.

```ts
export type Surface =
  | "today" | "talk" | "read" | "prompter" | "listening"
  | "memory" | "review" | "coach" | "settings" | "onboarding";

export interface Shortcut {
  key: string;            // KeyboardEvent.key ile eşleşen biçim ("1", " ", "Enter", "ArrowRight")
  label: string;          // ipucu satırında görünecek tuş ("↵", "1–6", "space")
  does: string;           // ne yaptığı, tek fiil öbeği ("begin next", "play the chapter")
  on: Surface[];          // hangi yüzeylerde geçerli
}

export const KEYS: Shortcut[] = [ /* … */ ];

/** Bu yüzeyde şu an geçerli olan kısayollar — hem handler'ın kapısı hem ipucu satırının kaynağı. */
export function keysFor(surface: Surface): Shortcut[];

/** Handler'ların ilk satırı. Tabloda yoksa hiçbir şey olmaz. */
export function live(surface: Surface, key: string): boolean;
```

Her global handler'ın gövdesi kalır; kaybettiği şey **hangi tuşların canlı olduğuna dair kendi fikri**:

```ts
if (!live(space, e.key)) return;
```

`ponytail:` yorumu tavanı söylesin — tablo düz bir dizidir, tuş sayısı iki haneli kaldığı sürece `find` yeterlidir; indekslemek gerekirse orası.

**Yapma:** tabloya `run` koyma, handler'ları tablodan üretme, tuş bağlamayı kullanıcıya açma. Üçü de istenmedi.

### A2 · Çakışmaların çözümü

Bunlar karar gerektiriyordu; kararlar verildi, ajan uygulasın:

- **Memory tekrarında kartı açan tuş `Space` değil `Enter` olur.** Harita `Enter`'a zaten "birincil eylem" diyor ve kartı açmak tam olarak odur. Böylece `Space` tek bir şey demeye başlar. Memory'nin ipucu satırı ve `.grade .k` etiketleri buna göre güncellenir.
- **`Space` Listening'de bölümü çalar/durdurur.** Ama etiket "pause" olamaz: yüzey `listening.stop` sunuyor, duraklatma değil durdurma. İpucu `space · play the chapter` / `space · stop` der. Bir eylemin adı yaptığı işi söyler (§6).
- **Talk'ta `1`–`3` öneri gönderiyor, dolayısıyla o ekranda nav rakamı değildir.** İki yol var; **ikincisi seçilsin**: ~~önerileri başka tuşa taşımak~~ / **topbar Talk'tayken nav rakamlarını göstermez.** Sebep: öneri seçmek Talk'ın birincil etkileşimi, `1`–`3` orada doğru tuş; yalan söyleyen şey topbar. Vaadini tutamadığı ekranda vaadi çeker. (Bunu `keysFor("talk")` zaten üretiyor — topbar `.k` rozetini `live(space, kbd)` ile koşullar.)
- **Paletin `R` ve `P` rozetleri** ya gerçek olur ya gider. `P` zaten yüzeye bağlı: rozet yalnızca Read'de gösterilir. `R` için global bir kısayol icat etme — rozeti kaldır, palet satırı kalsın.
- **Settings'in `[` `]` `↑` `↓`'sü** tabloya girer ve Settings bir `hints` satırı kazanır. Duyurulmayan çalışan kısayol kalmaz.

### A3 · Tek `Hints` bileşeni

Dört elle yazılmış satır yerine, yüzey adından başka bir şey almayan bir bileşen:

```tsx
<Hints surface="today" />   // settings.showHints'i kendi içinde okur
```

Tabloyu kendisi okur. Tabloda olmayan bir tuşu duyurmak **mümkün olmaz** — #30'un dördüncü maddesi böyle bir iddia olmaktan çıkar.

Not: Prompter ve Passage'ın ipuçları koşullu (`read.canBilingual` gibi). `keysFor`'a ikinci bir opsiyonel argüman (`{ has: string[] }`) ver ya da `Shortcut`'a `when?: string` koy — hangisi daha az kod ise. Üçüncü bir mekanizma açma.

### A4 · Topbar

- `.status`: **"On this computer" / "Online"**. Sağlayıcı adı, host ve model `title`'a iner (§4.3 "üzerine gelindiğinde ayrıntı görünür"). `PROVIDER_NAMES` tablosu App.tsx'ten kalkar — `models.ts` zaten `PROVIDERS`'ı tutuyor, ikinci kopya orada durmasın.
- `.dots` **silinir**. Today aynı bilgiyi `progressLine` ile cümleyle söylüyor; şeridi etiketlemek, cümlenin yanına ikinci bir dil eklemek olurdu. Silme ekleme yerine geçer.
- **Ayarlara görünür giriş**: nav'ın sonunda, altı bölümden görsel olarak ayrılmış bir *Settings* girişi (§5.1 ayarları bölüm saymıyor, o yüzden nav öğesi gibi değil ayrı durur). `,` rozetini `live()` üzerinden taşır.
- **Rakamlar ve sayaç ayrışır**: `.k` kısayol rozeti kalır (mono, çerçeveli, soluk — bugünkü stil zaten kısayol gibi); Memory'nin tekrarı gelen kelime sayısı **ayrı** bir sayaç rozeti olarak, sayı yalnız durmasın diye `title`'ında ne olduğu yazılı şekilde eklenir.
  Bunun için `useDay` `due`'yu dışarı versin: [useDay.ts:107](src/lib/useDay.ts:107)'de state var, `Day` arayüzünde ve `return`'de yok. İki satır.

### A5 · Kontroller

`src/lib/keys.check.ts`:
- Aynı yüzeyde bir tuş iki farklı `does` taşımaz. (3 ve 4 numaralı bulguların nöbetçisi.)
- Her `Surface` en az bir kısayol taşır; taşımıyorsa o yüzeyin ipucu satırı hiç çizilmez — sessiz boş kutu kalmaz.
- Her `Shortcut.on` boş değil, her `label`/`does` boş değil.
- **Kendi doğrulayıcısını sına:** bilerek çakışan bir tabloyla aynı fonksiyon çağrılır ve patlaması beklenir (deponun ledger'larındaki desen).

`src/lib/states.check.ts`: yeni durum eklenmiyor, dokunma.

### A6 · Kabul

- [ ] Topbar'daki her rakam, bulunduğun her ekranda yazdığı yere gidiyor — gitmediği ekranda yazmıyor
- [ ] `Space` uygulamanın tamamında tek bir şey demek
- [ ] Listening'de bölüm klavyeyle çalıyor ve duruyor
- [ ] Settings'in bölüm gezintisi duyuruluyor
- [ ] `hints` satırlarının tamamı `keysFor`'dan geliyor; elle yazılmış tek satır kalmadı
- [ ] Topbar'da sağlayıcı adı geçmiyor, etiketsiz gösterge kalmadı, ayarlara fareyle görünür bir giriş var
- [ ] Memory'nin bekleyen sayısı kısayol rozetinden ayırt edilebiliyor

### A7 · Tarayıcıda doğrulama

Bu depoda alışılmış yöntem: `npm run dev`, sonra `http://localhost:1420/src/lib/db.ts`'e gidip (vite düz JS metni olarak servis eder, uygulama boot etmez) aynı exec içinde `window.__TAURI_INTERNALS__` stub'ını kur, `location.hash`'i ayarla, `document.body.innerHTML`'i `<div id="root"></div>` yap, react-refresh preamble'ını inline module olarak enjekte et, sonra `/src/main.tsx` script'ini ekle. `plugin:sql|load` **yol string'i** döndürmeli, `plugin:sql|execute` **dizi** `[rowsAffected, lastInsertId]` döndürmeli.

Bakılacaklar: her ekranda ipucu satırı ile çalışan tuşların birebir eşleşmesi; Talk'ta `1`'in öneri göndermesi ve topbar'ın o sırada rakam göstermemesi; Listening'de `Space`; Memory tekrarında `Enter`; topbar'ın iki durum metni.

---

# PR B — #29 + #32 · Palet ve ayar araması

Branch önerisi: `feat/m2-settings-search`.

Birlikte, çünkü ikisi aynı veriyi istiyor: her ayar satırının **adı, açıklaması ve nereye gittiği**. Ayrı yazılırsa iki liste doğar ve zamanla birbirinden sapar — bu depoda `PROVIDERS`'ın iki kopyası zaten bir kez temizlendi.

**Tek kaynak:** `src/lib/settingsIndex.ts` — `{ id, title, desc, panel: keyof typeof AT, hash }` satırları. `AT` (`src/lib/rules.ts`) zaten panel → `#settings/<panel>` eşlemesini tutuyor; indeks onun üstüne satır düzeyinde kurulur.

- **#32:** Settings'e arama alanı (§5.2). Eşleşme **ad + açıklama** üzerinde. Sonuç ayarı açar ve **yerinde vurgular** — ayrı bir sonuç sayfası değil, hedef satıra kaydırıp kısa süre işaretlemek. (`element.scrollIntoView` + geçici sınıf; yeni bir yönlendirme mekanizması açma.)
- **#29:** Palet ([App.tsx](src/App.tsx) `paletteItems`) bugün yalnızca altı bölüme ve `settings` köküne atlıyor. Aynı indeksi okuyup ayar sayfalarına ve tek tek ayarlara atlar. Paletin "Ask the coach" düşüşü korunur.
- Her ikisi de: paletin yaptığı her şeye başka bir yoldan da ulaşılabilir (#29'un ikinci maddesi) — indeks üzerinden gelen her satırın zaten bir sayfası var, bu bedava geliyor.

**Kontrol** (`settingsIndex.check.ts`): her satırın `panel`'i `AT`'de var; her satırın `desc`'i boş değil (§5.2 "açıklaması yazılamayan ayar ana akışta bulunmaz" — indeks bunu uygulanabilir kılıyor); iki satır aynı `id`'yi taşımıyor; bilinen aramalar ("voice", "microphone", "delete", "language" — issue'nun kendi örnekleri) en az bir satır buluyor.

**Dikkat:** indeksi ayarların *ikinci bir kopyası* hâline getirme. Satırlar yalnızca arama ve atlama için meta veridir; değerler `Settings`'te kalır, yazma kapısı `applyPatch` olmaya devam eder.

---

# PR C — #40 · Hakkımda

Branch önerisi: `feat/m2-about-me`.

Kalan tek ayar bölümü, §5.6. Kendi depolamasını gerektiriyor (koçun öğrendikleri: metin, öğrenilme zamanı, hedef dil).

- Satır başına: bilginin kendisi, ne zaman öğrenildiği, **düzenle / sil**.
- Kullanıcı **kendi eliyle** ekleyebilir — "Bana X de", "vejetaryenim".
- **Öğrenmeyi duraklat** anahtarı: mevcut bilgiler kullanılmaya devam eder, yenisi eklenmez.
- **Tümünü unut** onay ister ve §6 uyarınca **ne kaybedileceğini sayar**.
- Kaydın hedef dile özel olduğu tek cümleyle yazılır.
- "Prompt" kelimesi geçmez; koçun bunları her oturumda okuduğu düz dille söylenir.
- **Adlandırma kuralı:** uygulamada "hafıza" adını taşıyan tek kavram nav'daki kelime destesidir. Bu sayfa **Hakkımda**'dır. İki kavramı ayırmak için açıklama yazmak gerekiyorsa adlardan biri yanlıştır.

Depolama: `daily_sessions`/`signals` ile aynı yerde, `src/lib/db.ts` üzerinden bir tablo. Koçun bunu okuduğu yer zaten var mı, önce ona bak — varsa oraya bağlan, yoksa okuma tarafını bu PR'da açma, sayfa ve depolama yeter (#40'ın maddeleri arayüz maddeleri).

---

# PR D — #44 + #42 · Erişilebilirlik spec'i ve sessiz disabled'lar

Branch önerisi: `feat/m2-a11y-spec`.

**#44** — `docs/plans/6-verba-erisilebilirlik-spec.md`, kardeşleriyle aynı biçimde (numaralı bölümler, durum tablosu, kapsam dışı, tamamlanma tanımı — issue'ya çevrilebilecek bir kontrol listesi). PR A'daki klavye haritası tazeyken yazılır; odak sırası, kontrast, ekran okuyucu etiketleri, hareket. `3-verba-activity-layer-spec.md` §6'nın devrettiği yer burası.

**#42** — sweep. Bulunan sessiz disabled'lar:

| Yer | Neden kapalı | Ne yapmalı |
|---|---|---|
| [Advanced.tsx:441](src/views/settings/Advanced.tsx:441) | Yapıştırma kutusu boş | #88'den devrolan kalıntı; kutunun altında tek satır |
| [Onboarding.tsx:388](src/views/Onboarding.tsx:388) | Model adı girilmemiş | Gerekçe satırı |
| [Listening.tsx:142](src/views/Listening.tsx:142) | Soru cevaplanmamış | Gerekçe satırı |
| [Talk.tsx:389](src/views/Talk.tsx:389) | Kutu boş / istek uçuşta | Değerlendir — etiketi zaten durumu söylüyorsa dokunma |

Zaten doğru olanlar (örnek alınacak desen): [DataPanel.tsx:461](src/views/DataPanel.tsx:461) `Because` + `cloudGate` ile kapatan ayarı ve ona giden bağlantıyı yazıyor; [DataPanel.tsx:532](src/views/DataPanel.tsx:532) gerekçe gerektirmediğini yorumla söylüyor; [Advanced.tsx:161](src/views/settings/Advanced.tsx:161) düğme yerine cümle koyuyor.

Uçuş hâlindeki disabled'lar (`disabled={!!busy}`, `disabled={testing}`) etiketi değişiyorsa ("Asking…") sessiz sayılmaz — dokunma. Bu ayrımı PR gövdesinde yaz.

---

# Açık kalan karar

**#95** (i18n) hangi milestone'a girecek? Arayüz dili onboarding'de soruluyor, dolayısıyla M3 · Onboarding savunulabilir; ama katmanın kendisi uygulamanın tamamına dokunuyor ve M3'ün kapsamını şişirir. Şu an milestone'suz duruyor.