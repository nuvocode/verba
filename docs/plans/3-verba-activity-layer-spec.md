# Verba — Etkinlik Katmanı Spesifikasyonu

> **Bu dökümanın amacı:** Verba'nın etkinlik katmanının (Today, Talk, Read, Listen, Memory, Coach) **olması gereken** halini tanımlamak.
> Bu bir hata listesi veya düzeltme planı değildir. Mevcut kodun bu spesifikasyondan nerede ayrıldığını tespit etmek ve düzeltme planını çıkarmak okuyucunun işidir.
> Çelişki durumunda bu döküman esas alınır.

---

## 0. Ürün niyeti

Verba, bir dil öğrenme **uygulaması** değil, bir dil öğrenme **döngüsüdür**. Uygulamanın tek işi şu döngüyü her gün kapatmaktır:

```
Öğrenci profili
      ↓
Coach → bugünün zayıflıklarını belirler
      ↓
Plan → o zayıflıkları hedefleyen 4-6 aktivite üretir
      ↓
Aktiviteler → Talk / Read / Listen / Memory
      ↓
Sinyal → her aktivite ölçülebilir kanıt üretir
      ↓
Coach → sinyali işler, profili günceller
      ↓
(ertesi gün başa dön)
```

Bu döngü kapanmıyorsa uygulama, birbirinden habersiz beş ayrı egzersiz aracının toplamıdır. **Verba'nın rakiplerinden tek farkı bu döngünün gerçekten kapanıyor olmasıdır.** Her tasarım kararı bu ölçüte göre değerlendirilir.

### Üç yönlendirici ilke

1. **Hiçbir sayı uydurulmaz.** Bir metrik hesaplanamıyorsa gösterilmez. Boş durum, yanlış sayıdan iyidir.
2. **Hiçbir içerik doldurmaca değildir.** Üretilen her cümle, her not, her soru öğrenciye bir şey öğretmek zorundadır. Şema bir alanı zorunlu kılıyorsa ve doldurulacak anlamlı içerik yoksa, şema yanlıştır.
3. **Öğrenci hiçbir zaman aynı şeyi iki kez anlatmaz.** Bir yüzeyde verilen bilgi (seviye, ilgi alanı, hata, kelime) diğer tüm yüzeylerde bilinir kabul edilir.

---

## 1. Ortak veri modeli

Tüm yüzeyler aynı state'ten okur. Yüzeye özel kopya tutulmaz.

### 1.1 `LearnerProfile` — tek doğruluk kaynağı

```ts
type LearnerProfile = {
  targetLanguage: LanguageCode      // öğrenilen dil
  nativeLanguage: LanguageCode      // açıklama dili
  level: CEFRLevel                  // A1 | A2 | B1 | B2 | C1 | C2 — YÜRÜRLÜKTEKİ seviye
  levelEstimate: {                  // Coach'un tahmini, ayrı alan
    value: number                   // 0-100 sürekli ölçek
    label: CEFRLevel                // value'dan türetilir
    confidence: 'low' | 'medium' | 'high'
    sampleSize: number              // kaç oturuma dayanıyor
  }
  interests: string[]               // tema üretimini besler
  goals: LearnerGoal[]              // ör. "Hamburg'a taşınıyorum", "Lead Fullstack rolü"
  weaknesses: Weakness[]            // Coach tarafından yazılır, Plan tarafından okunur
  createdAt, streak, timezone
}
```

**Değişmez kurallar:**

- `level` uygulamanın **tek** seviye kaynağıdır. Hiçbir yüzey kendi seviyesini hesaplamaz, hardcode etmez, tahmin etmez.
- `level` ile `levelEstimate.label` **farklı olabilir** — bu bir hata değil, ürünün bir özelliğidir. `level` öğrencinin şu an çalıştığı seviyedir; `levelEstimate` Coach'un gözlemidir. Coach ekranında ikisi de gösterilir ve aradaki fark açıkça anlatılır ("B2'de çalışıyorsun, üretimin C1'e yaklaşıyor").
- `levelEstimate.confidence` düşükken seviye ilerlemesi **önerilmez**, sadece gösterilir.
- `targetLanguage` her kullanıcıya görünen metinde **değişken** olarak geçer. Hiçbir dil adı statik metne gömülmez.

### 1.2 `DailyPlan`

```ts
type DailyPlan = {
  date: LocalDate
  dayIndex: number                  // öğrencinin kaçıncı günü
  theme: Theme                      // TÜM aktiviteleri bağlar
  targetedWeaknesses: WeaknessRef[] // bu planın hangi zayıflıkları hedeflediği
  activities: PlannedActivity[]
  estimatedMinutes: number          // aktivitelerin toplamı, ayrıca yazılmaz
}

type PlannedActivity = {
  id: ActivityId
  kind: 'talk' | 'read' | 'roleplay' | 'listen' | 'memory' | 'wrapup'
  title: string
  rationale: string                 // NEDEN bu aktivite bugün burada — öğrenciye gösterilir
  estimatedMinutes: number
  status: 'pending' | 'active' | 'completed' | 'skipped'
  dependsOn?: ActivityId            // ör. Read, Talk'un çıktısını kullanıyorsa
  producedSignalIds: SignalId[]     // tamamlanınca doldurulur
}
```

**Değişmez kurallar:**

- `estimatedMinutes` toplamı, aktivitelerin toplamına eşittir. Ayrı bir yerde ayrı bir sayı tutulmaz.
- Bir aktivite başka bir aktivitenin çıktısını kullanacağını iddia ediyorsa (`dependsOn`), o bağımlılık **gerçekten** kurulur. Kurulamıyorsa iddia da edilmez.
- `rationale` boş geçilemez. Bir aktivite için "neden bugün" cevabı yoksa o aktivite plana girmez.

### 1.3 `Signal` — aktivitelerin ölçüm çıktısı

Her aktivite bittiğinde **en az bir** sinyal üretir. Coach yalnızca sinyallerden besleir.

```ts
type Signal = {
  id: SignalId
  activityId: ActivityId
  kind: SignalKind
  observedAt: Timestamp
  payload: ...
}

type SignalKind =
  | 'correction'        // düzeltilen bir üretim hatası
  | 'unpromptedTurn'    // yardımsız üretilen tur (uzunluk, süre)
  | 'suggestionUsed'    // hazır öneri kullanıldı
  | 'lexicalItem'       // karşılaşılan/kaydedilen kelime
  | 'comprehension'     // anlama sorusu sonucu
  | 'pronunciation'     // telaffuz gözlemi
  | 'pace'              // okuma/konuşma hızı
```

**Kural:** Coach ekranındaki her sayının arkasında sayılabilir sinyaller vardır. Sinyalden türetilemeyen bir metrik ekranda yer almaz.

### 1.4 `VocabItem`

```ts
type VocabItem = {
  id, lemma, form
  type: 'word' | 'phrase' | 'phrasalVerb' | 'idiom' | 'collocation' | 'pronunciation'
  gloss: string                     // nativeLanguage'da kısa tanım
  example: string                   // KARŞILAŞILDIĞI gerçek bağlam
  sourceRef: { surface, sessionId } // nereden geldi
  capturedBy: 'learner' | 'coach'   // kullanıcı mı kaydetti, sistem mi ekledi
  levelBand: CEFRLevel              // öğeye ait tahmini seviye
  srs: {
    interval: number                // gün
    ease: number
    dueAt: Timestamp
    reps: number
    lapses: number
    strength: number                // 0-1, gösterimde bar
  }
}
```

### 1.5 `Weakness`

```ts
type Weakness = {
  id
  label: string                     // ör. "unstressed schwa /ə/"
  category: 'pronunciation' | 'grammar' | 'lexis' | 'fluency' | 'pragmatics'
  evidence: SignalId[]              // EN AZ 3 sinyal — altındaysa zayıflık ilan edilmez
  severity: number
  addressedBy: ActivityId[]         // bu zayıflığı hedefleyen planlanmış aktiviteler
  trend: 'improving' | 'flat' | 'worsening' | 'new'
}
```

**Kural:** Bir zayıflık ekranda gösteriliyorsa, `addressedBy` dolu olmak zorundadır. "Zayıfsın" demek ama bir şey yapmamak, bu ürünün yapmayacağı tek şeydir.

---

## 2. Yüzey spesifikasyonları

Her yüzey için: **amaç → girdi → davranış → ürettiği sinyal → durumlar.**

---

### 2.1 Today

**Amaç:** Öğrencinin düşünmeden başlayabilmesi. Karar verilecek hiçbir şey olmamalı.

**Girdi:** `DailyPlan`, `LearnerProfile`

**Davranış:**

- Üst şerit: gün, tarih, `dayIndex`, `targetLanguage` — hepsi profilden.
- Tek paragraflık açıklama: bugünün teması, akışın mantığı, toplam süre. Bu metin `plan.theme` ve `plan.targetedWeaknesses`'ten türetilir; sabit şablon değildir.
- Aktivite listesi: sıra numarası, başlık, `rationale`, süre, **durum**.
- Her aktivitenin durumu görünür: `pending` (nötr), `active` ("up next"), `completed` (işaretli + gerçekleşen süre), `skipped` (soluk).
- Bir aktivite tamamlanınca Today'e dönülür, satır işaretlenir, bir sonraki `active` olur. Öğrenci sonraki adımı aramak zorunda kalmaz.
- Gün içinde tekrar girildiğinde kalınan yerden devam eder; plan yeniden üretilmez.
- Sıra dışına çıkmak serbesttir, ancak `dependsOn` bağımlılığı olan bir aktivite bağımlılığı tamamlanmadan açılırsa uyarı verir ve bağımsız bir varyant üretir.
- Nav üzerinden doğrudan bir yüzeye girilirse (ör. Read), o yüzey **plandaki** ilgili aktiviteyi açar; alakasız yeni içerik üretmez. Plan dışı çalışma isteniyorsa bu açık bir eylemdir ("Plan dışı yeni pasaj").

**Ürettiği sinyal:** yok (yönlendirici yüzey).

**Durumlar:** plan üretiliyor / plan hazır / gün tamamlandı (özet + yarın önizlemesi) / üretim hatası (dünkü plan veya jenerik plan ile devam, sessizce boş kalmaz).

---

### 2.2 Talk

**Amaç:** Öğrencinin yardımsız üretim yapabildiği en yüksek noktayı bulmak ve oradan bir tık yukarısını zorlamak.

**Girdi:** `LearnerProfile`, seçilen `Scenario`, `plan.theme`

**Senaryo kataloğu:**

- Yerleşik senaryolar seviye bandı ile etiketlenir; öğrencinin `level`'ının **altındaki** senaryolar ayrı bir "daha kolay" grubunda toplanır, birincil grid'i işgal etmez.
- Öğrencinin kendi oluşturduğu senaryolar görsel olarak ayrışır ve **düzenlenebilir / silinebilir / kopyalanabilir**.
- Senaryo tanımı: rol, karşı taraf personası, bağlam, hedefler, başarı kriteri, seviye bandı.

**Oturum davranışı:**

- Karşı taraf tutarlı bir personadır: isim, rol, avatar ve ses **birbiriyle uyumlu** olur ve oturum boyunca değişmez.
- **Hedefler canlı takip edilir.** Her hedef üç durumdan birindedir: bekliyor / tamamlandı / kaçırıldı. Öğrenci hedefi karşıladığında işaret anında düşer. İşaretlenmeyen dokuz maddelik statik liste kabul edilemez.
- Hedef sayısı bir oturum için **5'i geçmez**. Fazlası ilgi dağıtır ve hiçbiri takip edilmez.
- **Düzeltmeler akışı kesmez.** Oturum sırasında toplanır, sonunda tek seferde sunulur. Sadece iletişimi tümüyle bozan hatalar anında ve kısa şekilde belirtilir.
- "If you're stuck" önerileri: gösterilen öneri sayısı ile klavye kısayolu **aynı sayıdır**. Öneri kullanımı `suggestionUsed` sinyali üretir ve confidence'ı düşürür — öğrenciye bu bağ açıklanır.

**Ses girişi (birincil giriş yöntemi):**

Konuşma pratiği uygulamasında ses, metnin alternatifi değil, ana yoldur.

- Kayıt sırasında canlı geri bildirim: seviye göstergesi ve akan kısmi transkripsiyon.
- Sessizlik algılama ile otomatik durdurma; manuel durdurma da mümkün.
- Transkripsiyon → **düzenlenebilir taslak** → gönder. Öğrenci yanlış tanınan kelimeyi düzeltebilir.
- Ses `pronunciation` ve `pace` sinyali üretir; sadece metne çevrilip atılmaz.
- Metin girişi her zaman erişilebilir kalır, ancak varsayılan ses'tir.

**Confidence göstergesi:**

- Tanım: yardımsız üretim oranı. Bileşenleri: yardımsız tur oranı, tur uzunluğu, öneri kullanım oranı, cevap gecikmesi.
- **Ölçüm başlamadan gösterilmez.** İlk anlamlı turdan önce `—` ve "ölçülüyor" durumu.
- Puan değil sinyal olduğu ekranda yazılıdır; bu iddia doğru kalmalı — ödül/ceza dili kullanılmaz.

**Ürettiği sinyaller:** `correction`, `unpromptedTurn`, `suggestionUsed`, `lexicalItem`, `pronunciation`, `pace`

**Oturum sonu (reflection):**

- Toplanan düzeltmeler, kategorilendirilmiş.
- Hedef karnesi: hangileri tutuldu.
- Yakalanan kelimeler → Memory'ye aday olarak akar (öğrenci onaylar).
- Tek paragraflık özet. **Bu özet ikinci tekil şahısla yazılır** ve tüm geçmişte aynı ses kullanılır.
- Özet üretimi başarısız olursa geçmiş kaydında ham model çıktısı **asla** gösterilmez; başlık + tarih ile minimal kayıt yazılır.

**Geçmiş:** tarihe göre gruplanır, aynı senaryonun tekrarları katlanır ("Lead Engineer Interview · 3 oturum"), her kayıt yeniden başlatılabilir ve kaldığı yerden devam ettirilebilir.

---

### 2.3 Read

**Amaç:** Öğrencinin kendi ürettiği dili, temiz bir modelde geri görmesi.

**Girdi:** `LearnerProfile.level`, `plan.theme`, önceki Talk oturumunun `lexicalItem` sinyalleri, Memory'de yakında due olan öğeler

**Pasaj üretim sözleşmesi:**

Pasaj, tek adımda üretilmez. Zorunlu akış:

1. **Outline:** 4-6 maddelik anlamsal iskelet. Her madde tek bir iddia/olay içerir.
2. **Draft:** iskeletten pasaj yazımı, hedef seviyeye uygun cümle uzunluğu ve kelime dağılımı ile.
3. **Coherence gate:** her cümle için — (a) bir önceki cümleyle mantıksal bağı var mı, (b) kendi içinde çelişiyor mu, (c) totoloji mi, (d) doğrulanabilir bir şey mi söylüyor. Bir cümle kalırsa yeniden yazılır.
4. **Reuse gate:** Talk'tan gelen hedef kelimelerin **en az yarısı** pasajda geçiyor mu. Geçmiyorsa 3. adıma dönülür.
5. **Level gate:** ölçülen seviye, hedef seviyenin ±1 bandında mı.

Bu kapılardan geçemeyen pasaj öğrenciye gösterilmez; yeniden üretilir veya güvenli bir yedek pasaj sunulur. **Anlamsız ama gramerli metin, bu üründe hata sayılır.**

**Coach Note sözleşmesi:**

Read'in notları, Talk'un düzeltme şemasından **tamamen ayrıdır**. Read notları öğrencinin yazdığı bir şeyi düzeltmez — okuduğu bir şeyi açar.

İzin verilen not tipleri:

| Tip | Ne yapar | Örnek |
|---|---|---|
| `lexis` | metinde geçen bir kelime/deyimi açar | "'run out of' — bir şeyin tükenmesi" |
| `structure` | cümledeki bir yapıyı açıklar | "'the biggest risk isn't X, it's Y' — karşıtlık kalıbı" |
| `register` | ton/resmiyet farkı | "'in a hurry' günlük; 'pressed for time' iş dilinde" |
| `culture` | kültürel bağlam | — |
| `contrast` | öğrencinin ana diliyle fark | — |

**Kurallar:**

- Her not, pasajda **fiilen geçen** bir ifadeye bağlıdır. Notta geçen ifade metinde yoksa not geçersizdir.
- **Cümle başına not zorunluluğu yoktur.** Bir pasajda 6 cümle varsa 2 not olabilir. Doldurmaca not üretmektense not üretmemek tercih edilir.
- Not sayısı üst sınırı: cümle sayısının yarısı.
- Notlar seviyeye göre önceliklendirilir: öğrencinin bilmediği tahmin edilen öğeler önce gelir.

**Close reading modu:**

- Cümleye tıklama → o cümle odaklanır, **ilgili not tek bir yerde** vurgulanır. Aynı not iki farklı yerde eş zamanlı gösterilmez.
- Kelimeye tıklama → tanım + bağlam + "Memory'ye ekle".
- Klavye: ok tuşları odak taşır, `Esc` odağı temizler.

**Teleprompter modu:**

- Süre hesabı tek kaynaktan gelir: `kelimeSayısı / wpm`. Üstteki tahmini süre ile teleprompter'ın kalan süresi aynı formülü kullanır.
- wpm değişince tüm süre göstergeleri güncellenir.
- **Sesli okuma dinlenir.** Mikrofon açıksa: telaffuz gözlemi, hız uyumu ve atlanan kelimeler ölçülür. Dinlemeyen bir teleprompter yalnızca kaydırma yapan bir metin kutusudur; bu modun varlık sebebi ölçümdür.
- Mikrofon kapalıysa mod yine çalışır ama "ölçüm yok" durumu görünür.

**Ürettiği sinyaller:** `lexicalItem`, `pace`, `pronunciation` (sesli okuma), `comprehension` (varsa)

---

### 2.4 Listen

**Amaç:** Yardımsız anlama kapasitesini ölçmek ve genişletmek.

**Girdi:** `level`, `theme`, bölüm ilerlemesi

**Davranış:**

- Hikaye bölümlere ayrılır; **bölüm ilerlemesi her zaman görünür** (1/3, 2/3, 3/3) ve kaldığı yerden devam eder.
- Tam oynatıcı kontrolü: oynat/duraklat, 10sn geri, hız (0.75× / 1× / 1.25×), ilerleme çubuğu üzerinde konumlanma.
- **Transkript açılıp kapanabilir.** Varsayılan kapalı. Açmak bir `comprehension` sinyalini "yardımlı" olarak işaretler — cezalandırılmaz, sadece kaydedilir.
- Sorular bölüm bittikten sonra gelir. Her soru sesin belirli bir aralığına bağlıdır (`audioRange`).
- **Yanlış cevaptan sonra:** doğru cevap açıklanır ve o cevabın geçtiği ses aralığı tek tuşla yeniden dinlenebilir. "Yanlış" demekle bitmez.
- Çeldiriciler rastgele değildir: her biri belirli bir yanlış anlamayı test eder (yanlış özne, yanlış zaman, metinde geçen ama alakasız detay).
- Sayfa dikey olarak dengeli yerleşir; içerik üst kenara yığılıp altta boş alan bırakmaz.

**Ürettiği sinyaller:** `comprehension` (soru başına doğru/yanlış + yardımlı mı), `lexicalItem` (transkriptten kaydedilenler)

---

### 2.5 Memory

**Amaç:** Karşılaşılan dilin unutulmadan önce geri gelmesi.

**Girdi:** tüm yüzeylerden gelen `lexicalItem` sinyalleri

**Toplama kuralları:**

- Bir öğe Memory'ye iki yolla girer: öğrenci kaydeder, veya Coach bir düzeltmeden türetir. Her ikisi de `capturedBy` ile işaretlenir.
- **Seviye eşiği vardır.** Öğrencinin `level`'ından belirgin şekilde düşük öğeler (ör. B2 öğrencisi için A1 kelimeleri) otomatik eklenmez. Öğrenci açıkça isterse eklenir.
- Her öğe, karşılaştığı **gerçek bağlamı** taşır — üretilmiş örnek cümle değil, öğrencinin gördüğü cümle.
- Öğe tipi (`word` / `phrase` / `phrasalVerb` / `pronunciation` ...) görünür şekilde etiketlenir. Telaffuz notu ile deyim aynı görsel muameleyi görmez.
- Telaffuz öğelerinde vurgu gösterimi **doğrulanır**. Yanlış vurgu öğreten bir kart, kart olmamasından kötüdür.

**Aralıklı tekrar:**

- Gerçek bir SRS algoritması çalışır (SM-2 veya FSRS). Her tekrar `interval`, `ease`, `dueAt`, `reps`, `lapses` alanlarını **kalıcı olarak** günceller.
- **Aynı anda tüm deck due olamaz.** Sağlıklı bir dağılımda due oranı deck'in küçük bir yüzdesidir. Tümü due görünüyorsa scheduler yazmıyor demektir.
- Günlük tekrar tavanı vardır (varsayılan 20). CTA bu tavanı gösterir: "Bugün 20 tekrar" — "112 due" değil. Birikmiş yük ayrı ve sakin bir dille belirtilir.
- `strength` çubuğu gerçek `interval`/`ease` değerinden türetilir; tüm kartlarda aynı görünüyorsa değer bağlanmamıştır.

**Görünüm:** due bugün / yakında / öğrenildi olarak ayrılır. Filtreleme: tip, kaynak yüzey, seviye, güç.

**Ürettiği sinyaller:** `lexicalItem` (tekrar sonucu), Coach'un `vocabularyDepth` metriğinin girdisi

---

### 2.6 Coach

**Amaç:** Öğrenciye ne olduğunu dürüstçe söylemek ve buna karşılık ne yapılacağını taahhüt etmek.

**Girdi:** yalnızca `Signal` kayıtları

**Metrik tanımları (ekranda da erişilebilir olmalı):**

| Metrik | Tanım | Girdi sinyalleri |
|---|---|---|
| Sentence complexity | üretilen cümlelerde ortalama kelime sayısı ve kelime uzunluğu | `unpromptedTurn` |
| Accuracy | tur başına düşen düzeltme sayısının tersi | `correction`, `unpromptedTurn` |
| Vocabulary depth | benzersiz kelime çeşitliliği + deck büyüklüğü ve gücü | `lexicalItem` |
| Consistency | son 7 günde pratik yapılan gün sayısı | tüm sinyaller, güne göre |
| Comprehension | yardımsız doğru cevap oranı | `comprehension` |
| Fluency | yardımsız tur oranı ve tur uzunluğu eğilimi | `unpromptedTurn`, `suggestionUsed` |

**Dürüstlük kuralları:**

- **Başlık, verinin söylediğini söyler.** 3/7 gün pratik varken "consistent week" yazılmaz. Başlık metni metriklerden türetilir, önceden yazılmış övgü havuzundan seçilmez.
- **Delta yalnızca karşılaştırılabilir iki dönem varsa gösterilir.** Önceki dönem yoksa `+değer` yerine "yeni" rozeti kullanılır. Bir deltanın metriğin kendisine eşit olması, karşılaştırma yapılmadığının işaretidir.
- **Wins bölümü uydurmaz.** Her "win" bir sinyal eşiğine bağlıdır ve o eşik tutmuyorsa madde yazılmaz. Boş bir wins bölümü, yanlış bir wins bölümünden iyidir.
- Consistency görselleştirmesi **7 kutu** gösterir ve pratik yapılan günler işaretlidir. Yanındaki grafik 7 günlük seriyi çizer; tek bir toplam bar değildir.
- Momentum grafiğinin ekseni ve zaman aralığı etiketlidir.
- Sayılar birimlidir: "1,700 words" neyin sayısı olduğu belirtilmeden yazılmaz.

**Zayıflık → aksiyon taahhüdü:**

Bu, Coach'un en önemli bölümüdür ve döngünün kapandığı yerdir.

- Her zayıflık kartı **kendi** gerekçesini ve **kendi** planlanmış müdahalesini gösterir. Kartlar arasında metin tekrarı olmaz.
- Kart şu biçimdedir: *ne gözlendi → kanıt (kaç sinyal) → yarın hangi aktivite bunu hedefleyecek.*
- Coach bir aktivite vaat ediyorsa, ertesi günün `DailyPlan`'ında o aktivite **fiilen** bulunur. Bu bir metin vaadi değil, veri bağıdır: `Weakness.addressedBy` → `PlannedActivity.id`.
- Ertesi gün Today ekranında ilgili aktivitenin `rationale`'ı bu zayıflığa atıfta bulunur ("Dün schwa'da zorlandın — bu ısınma onu hedefliyor").

**Seviye gösterimi:** slider `levelEstimate.value`'yu, metin `level`'ı gösterir; ikisi farklıysa fark açıklanır. Aynı ekranda iki farklı seviye iddiası açıklamasız duramaz.

---

## 3. Etkileşim standartları

### 3.1 Klavye

Tek bir harita, tüm uygulamada geçerli:

| Tuş | Anlam | İstisna yok |
|---|---|---|
| `Esc` | **her zaman** bir seviye yukarı çık | odak → görünüm → Today |
| `1`–`6` | üst navigasyon | |
| `Enter` | birincil eylemi çalıştır | |
| `⌘K` | komut paleti | |
| `Space` | oynat/duraklat (medya olan yüzeylerde) | |

**Kurallar:**

- Aynı tuş iki yüzeyde farklı iş yapamaz. Yüzeye özel eylemler kendi tuşunu alır ve genel tuşları ele geçirmez.
- Ekranda gösterilen kısayol sayısı, fiilen çalışan kısayol sayısına eşittir ("1–3" yazıp 2 öğe göstermek geçersizdir).
- Metin girişi odaktayken tek harfli kısayollar devre dışıdır.
- Her yüzeyin footer'ı yalnızca o an geçerli kısayolları gösterir.

### 3.2 Zorunlu durumlar

Her içerik üreten yüzey dört durumu da uygulamak zorundadır:

1. **Yükleniyor** — ne üretildiği ve tahmini süre görünür; boş ekran değil.
2. **Boş** — neden boş ve ne yapılabilir.
3. **Hata** — ne olduğu, ne denenebileceği, yeniden dene eylemi. Ham hata metni veya model çıktısı gösterilmez.
4. **Bozuk içerik** — kalite kapılarından geçemeyen üretim öğrenciye ulaşmaz; yedek içerik veya açık bir "yeniden üret" durumu gösterilir.

### 3.3 Yerelleştirme ve biçim

- Tarih, saat ve sayı biçimleri kullanıcının yereline göre; tüm uygulamada tek biçim.
- Yakın tarihler göreli yazılır ("2 gün önce"), eskiler mutlak.
- Arayüz dili ile `targetLanguage` bağımsızdır ve karışmaz.
- Etiketsiz gösterge bulunmaz — her ikon, nokta dizisi ve grafik ya açıklanır ya kaldırılır.

---

## 4. Metin ve ses (copy)

- **Kişi:** öğrenciye her zaman ikinci tekil şahısla hitap edilir. "The learner" gibi üçüncü şahıs anlatım hiçbir yerde kullanılmaz.
- **Ton:** doğrudan, sakin, abartısız. Övgü ancak veri destekliyorsa verilir.
- **Dil adları, seviyeler, sayılar** her zaman değişkendir; metne gömülmez.
- Aynı şablondan üretilen kartlar birbirinin aynısı olamaz; farklılaştırılamıyorsa şablon yanlıştır.
- Uygulamanın verdiği hiçbir söz karşılıksız kalmaz ("bu pasaj söylediklerini yeniden kullanıyor" diyorsa, kullanır).

---

## 5. Değişmezler (doğrulanabilir kabul kriterleri)

Aşağıdakiler her zaman doğru olmalıdır. Bunlar test edilebilir iddialardır.

**Profil ve seviye**
1. Kullanıcıya görünen hiçbir dil adı statik metinde yer almaz.
2. Bir ekranda gösterilen tüm seviye değerleri ya aynıdır ya da farkları açıklanmıştır.
3. `level` tek bir kaynaktan okunur.

**Plan döngüsü**
4. `plan.estimatedMinutes` === aktivite sürelerinin toplamı.
5. Her `PlannedActivity.rationale` boş değildir.
6. Coach'ta gösterilen her zayıflığın `addressedBy` alanı doludur ve işaret ettiği aktivite ertesi günün planında vardır.
7. `dependsOn` tanımlı bir aktivite, bağımlılığının çıktısını fiilen kullanır.

**Coach metrikleri**
8. Hiçbir delta, metriğin kendi değerine eşit değildir.
9. Consistency görselindeki kutu sayısı === 7; işaretli kutu sayısı === bildirilen gün sayısı.
10. Başlık metni ile metrik değerleri çelişmez.
11. Her "win" maddesi bir sinyal eşiğine dayanır.
12. Ekrandaki her sayının bir birimi ve bir tanımı vardır.

**Memory / SRS**
13. Due öğe sayısı < toplam öğe sayısı (deck 1 günden eskiyse).
14. Bir tekrar sonrası ilgili öğenin `dueAt` ve `interval` değerleri değişmiştir.
15. `strength` çubuklarının uzunlukları deck içinde çeşitlilik gösterir.
16. Öğrencinin seviyesinin iki bant altındaki öğeler otomatik eklenmez.

**İçerik üretimi**
17. Hiçbir Coach Note, pasajda geçmeyen bir ifadeye atıfta bulunmaz.
18. Not sayısı ≤ cümle sayısı / 2.
19. Read notları Talk'un düzeltme şemasını kullanmaz.
20. Kalite kapılarından geçmemiş içerik gösterilmez.
21. Bir pasaj "yeniden kullanım" iddiasıyla üretildiyse hedef kelimelerin ≥ %50'sini içerir.

**Arayüz**
22. Ham model çıktısı (JSON, stack trace) hiçbir kullanıcı yüzeyinde görünmez.
23. Ekranda ilan edilen kısayol sayısı === çalışan kısayol sayısı.
24. `Esc` her yüzeyde "bir seviye yukarı" anlamındadır.
25. Aynı bilgi aynı anda iki yerde gösterilmez.
26. Ölçüm başlamadan hiçbir ölçüm değeri gösterilmez.
27. Her yüzey dört durumu (yükleniyor / boş / hata / bozuk içerik) uygular.

---

## 6. Kapsam dışı

Bu döküman etkinlik katmanını tanımlar. Aşağıdakiler ayrı spesifikasyonların konusudur ve buradaki kararlar onları bağlamaz:

- Model seçimi, yerel/bulut yönlendirme, üretim maliyeti ve gecikme bütçesi
- Kimlik, senkronizasyon, çoklu cihaz
- Fiyatlandırma, kota
- İlk kurulum / kayıt akışı (seviye belirleme sınavı dahil)
- Erişilebilirlik (ayrı ve zorunlu bir spesifikasyon olarak ele alınmalı)
