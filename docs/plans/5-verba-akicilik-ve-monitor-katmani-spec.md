# Verba — Akıcılık ve Monitör Yükü Katmanı Spesifikasyonu

**Durum:** Hedef tasarım (olması gereken)
**Kapsam:** Kullanıcının bildiği dili spontane üretimde kullanamadığı anın tespiti, ölçümü ve azaltılması; akıcılık modunun kuralları; Coach'un bu veriyi kullanıcıya geri yansıtma biçimi
**İlişki:** `verba-onboarding-spec.md`, `verba-ana-ekran-ve-ayarlar-spec.md`, `verba-activity-layer-spec.md` ve `verba-repair-katmani-spec.md` dokümanlarının üzerine gelen katmandır. Repair katmanının ikizidir: repair "anlamadığın an"ı, bu katman "bildiğin halde söyleyemediğin an"ı ele alır. Etkinlik katmanındaki döngü (Coach → Plan → Aktivite → Sinyal → Coach) çalışmadan uygulanamaz.
**Not:** Bu bir düzeltme listesi değildir. Uygulama planı bu spesifikasyondan türetilir.

---

## 0. Bu katman neden var

Yetişkin dil öğrenenlerin en sık ve en az adı konmuş şikâyeti şudur:

> "Dilbilgisini biliyorum. Yazarken sorun yok. Ama konuşurken her şey doğru olsun diye o kadar uğraşıyorum ki hem cümle hem fikir dağılıyor."

Bu bir bilgi eksikliği değildir. Ölçülebilir bir davranış imzasıdır ve mevcut hiçbir dil uygulaması bunu ölçmez — hepsi *hata sayar*, oysa buradaki kişinin hatası zaten azdır. Sorun, doğruluk denetiminin yanlış anda ve aşırı çalışmasıdır.

Verba'nın bu katmandaki tek cümlelik iddiası:

> **Verba, doğru konuşma baskısının seni nasıl yavaşlattığını ölçen ve bu baskıyı kademeli olarak indiren uygulamadır.**

---

## 1. Kavramsal temel

Ürün kararlarının dayandığı çerçeve. Uygulama içinde bu isimler kullanıcıya **gösterilmez**; sadece tasarım gerekçesidir.

| Kaynak | Ne söylüyor | Üründeki karşılığı |
|---|---|---|
| Krashen — Monitor Model, "over-user" | Bilinçli kural denetimi konuşma anında devreye girerse akış kopar | Akıcılık modunda düzeltmenin tamamen ertelenmesi |
| Skehan — Trade-off Hypothesis (CAF) | Doğruluk, akıcılık ve karmaşıklık aynı sınırlı dikkat havuzunu paylaşır | Her aktivitenin tek bir açık önceliği olması; üçünü aynı anda talep etmemek |
| Eysenck & Calvo — Processing Efficiency / Attentional Control | Kaygı sonucu değil *verimliliği* düşürür; aynı çıktı için daha çok kaynak harcanır | Süre ve gecikme ölçümlerinin doğruluk kadar önemsenmesi |
| Levelt — konuşma üretimi ve self-repair | Cümle içi kesme ve yeniden başlama, formülasyon sıkışmasının doğrudan göstergesidir | Duraklamanın *yerinin* ölçülmesi, sayısının değil |
| Horwitz — Foreign Language Anxiety (özellikle "fear of negative evaluation") | Değerlendirilme korkusu üretimi bozar | Coach'un puan vermemesi, düzeltmeyi toplu ve geç vermesi |
| Nation — 4/3/2 | Aynı içeriğin daralan sürede tekrarı akıcılığı doğruluğu bozmadan yükseltir | Ana egzersiz (§5.2) |
| Ellis — pre-task planning | Görev öncesi kısa planlama akıcılık ve karmaşıklığı birlikte artırır | Planlama süresi kontrolü (§5.1) |

**Tasarım ilkesi:** Verba kullanıcıya psikolojik bir etiket koymaz. "Kaygılısın", "mükemmeliyetçisin", "özgüvenin düşük" gibi ifadeler **yasaktır**. Verba yalnızca davranış raporlar: ne kadar durakladın, nerede kestin, neyi gereksiz düzelttin.

---

## 2. Ne ölçülür

Tüm sinyaller mevcut ses akışı + transcript'ten türetilir. Ek donanım, kamera, biyometri **yoktur ve önerilmez**.

### 2.1 Zamanlama sinyalleri

| Sinyal | Tanım | Nasıl hesaplanır |
|---|---|---|
| `initiationLatency` | Sıra kullanıcıya geçtikten ilk sese kadar geçen süre | ms |
| `speechRate` | Toplam süreye bölünmüş hece sayısı (duraklamalar dahil) | hece/dk |
| `articulationRate` | Yalnızca ses üretilen süreye bölünmüş hece sayısı | hece/dk |
| `meanLengthOfRun` | 250 ms üzeri duraklamalar arasındaki ortalama hece sayısı | sayı |
| `midClausePauseRatio` | Cümle *içi* duraklamaların tüm duraklamalara oranı | 0–1 |
| `filledPauseRate` | 100 kelimede "uh/um/şey/yani" sayısı | sayı |

`speechRate` ile `articulationRate` arasındaki fark önemlidir: ikisi yakınsa kişi yavaş ama akıcı konuşuyordur; arada büyük fark varsa kişi hızlı konuşup sık takılıyordur. Bunlar farklı sorunlardır ve farklı egzersiz alırlar.

`midClausePauseRatio` bu katmanın **en teşhis edici tek sinyalidir.** Cümle sonunda duraklamak normal ve hatta iyi konuşmacı davranışıdır. Cümlenin ortasında, öbeğin içinde duraklamak formülasyonun sıkıştığını gösterir.

### 2.2 Onarım sinyalleri (Levelt taksonomisi)

Her kendini düzeltme olayı sınıflandırılır:

| Tür | Tanım | Yorum |
|---|---|---|
| `E-repair` | Gerçek hata düzeltildi | Sağlıklı. Öğrenmenin işareti. |
| `A-repair` | Hata yoktu, daha uygun ifade arandı | Nötr; aşırıysa monitör göstergesi |
| `D-repair` | Fikir değişti, baştan kuruldu | Planlama sıkışması |
| `C-repair` | Kelime ortasında kesme, örtük onarım | Monitörün en güçlü göstergesi |
| `falseAlarmRepair` | **Düzeltilen ifade zaten doğruydu** | Bu katmanın çekirdek metriği |

`falseAlarmRepair` tespiti: kesilen parça, LLM'e "bu ifade hedef dilde doğru muydu?" olarak sorulur. Doğruysa ve kullanıcı yine de değiştirdiyse, bu gereksiz monitör hareketidir. **Kullanıcıya en çarpıcı gelen tek veri budur** ve mutlaka geri yansıtılır.

### 2.3 Tamamlanma sinyalleri

| Sinyal | Tanım |
|---|---|
| `abandonedUtteranceRate` | Yarıda bırakılıp hiç tamamlanmayan cümlelerin oranı |
| `l1FallbackRate` | Ana dile kayma sayısı (kelime veya cümle) |
| `avoidanceScore` | Hedeflenen yapıdan kaçınıp daha basitine dönme (Coach'un plandaki hedef yapısı ile üretilen yapının karşılaştırması) |

`avoidanceScore` sessiz bir sinyaldir: kullanıcı hata yapmaz, çünkü riskli cümleyi hiç kurmaz. Hata sayan sistemler bunu göremez; Verba görmelidir.

### 2.4 Bağlam sinyalleri

Her ölçüm şu bağlamla birlikte kaydedilir, yoksa karşılaştırılamaz:

```
context: {
  mode: "fluency" | "accuracy" | "free",
  planningTimeSec: number,       // 0 = planlamasız
  taskRepetition: 1 | 2 | 3,     // aynı içeriğin kaçıncı tekrarı
  interlocutorPressure: "none" | "paced" | "interrupting",
  modality: "spoken" | "written",
  topicFamiliarity: "prepared" | "novel"
}
```

---

## 3. Teşhis — Monitör Yükü profili

### 3.1 Karşılaştırma ekseni

Tek başına hiçbir sayı anlam taşımaz. Teşhis **aynı kullanıcının kendi iki koşulu arasındaki farktan** çıkar:

| Karşılaştırma | Ne gösterir |
|---|---|
| Yazılı doğruluk ↔ Sözlü doğruluk | Fark küçükse bilgi yerinde, sorun üretimde |
| Planlamalı ↔ Planlamasız | Fark büyükse formülasyon darboğazı |
| 1. tekrar ↔ 3. tekrar (4/3/2) | Fark büyükse kapasite var, erişim yavaş |
| Baskısız ↔ Araya girilen konuşma | Fark büyükse sosyal baskı bileşeni baskın |

Bu dört farktan oluşan tabloya **Monitör Yükü profili** denir. Tek bir bileşik puana indirgenmez; indirgemek, kullanıcının kendini değerlendirilmiş hissetmesine ve tam da ölçülen sorunun büyümesine yol açar.

### 3.2 Profil çıkarma koşulları

- Profil, **en az 3 farklı oturumdan** ve her koşuldan en az 2 örnekten sonra gösterilir.
- Yeterli veri yoksa Coach bu konuda hiçbir şey söylemez. Yarım veriyle yorum yapmak **yasaktır.**
- Profil, kullanıcı isterse tamamen kapatılabilir (Ayarlar → Coaching). Kapatıldığında ölçüm de durur, sadece gösterim değil.

### 3.3 Profilin dört tipik sonucu

| Sonuç | İmza | Verba'nın yanıtı |
|---|---|---|
| **Monitör baskın** | Yazılı ≈ sözlü doğruluk, yüksek `falseAlarmRepair`, yüksek `midClausePauseRatio` | Akıcılık modu + 4/3/2 |
| **Erişim yavaş** | Doğruluk iyi, `initiationLatency` ve duraklama yüksek, `falseAlarmRepair` düşük | Tekrar ve otomatikleştirme egzersizleri |
| **Bilgi eksiği** | Yazılı doğruluk da düşük | Bu katman devreye girmez; Read/Memory katmanına yönlendirilir |
| **Sorun yok** | Tüm farklar küçük | **Coach bunu açıkça söyler.** "Ölçtük, gerçekten iyisin" demek bu katmanın meşru çıktılarından biridir. |

---

## 4. Akıcılık modu

Aktivite katmanına eklenen yeni bir çalışma modu. Talk ve Today içinden başlatılabilir.

### 4.1 Sözleşme

Mod başlamadan önce tek ekranda, tek paragrafta kullanıcıya söylenir ve onaylatılır:

> "Önümüzdeki 5 dakikada hata serbest. Seni durdurmayacağım, düzeltmeyeceğim, ekranda hiçbir şey kırmızı olmayacak. Sonunda en fazla üç şey söyleyeceğim. Amaç doğru konuşmak değil, durmadan konuşmak."

Bu sözleşme dekoratif değildir; modun etkisi büyük ölçüde buradan gelir. Her oturumda tekrar gösterilir, "bir daha gösterme" seçeneği **yoktur.**

### 4.2 Mod kuralları (bağlayıcı)

Akıcılık modu aktifken:

1. Coach **tur ortasında hiçbir koşulda araya girmez.**
2. Transcript'te canlı hata işaretlemesi, altı çizili kelime, renk uyarısı **görünmez.**
3. "If you're stuck" paneli görünür kalır ama **kendiliğinden açılmaz.**
4. Karşı taraf (LLM) kullanıcının yarım kalan cümlesini **tamamlamaz**; sabır ayarı devreye girer (repair spec §"ayarlanabilir sabır").
5. Kullanıcı sustuğunda LLM en az 2 saniye bekler. Bu süre ayarlanabilir, varsayılan 2 sn.
6. Oturum sonunda geri bildirim **en fazla 3 madde**dir ve şu sırayla seçilir: (a) anlamı bozan hata, (b) tekrar eden kalıp hata, (c) bir güçlü an. Rastgele hata listesi verilmez.
7. Süre dolduğunda mod kendiliğinden kapanır; uzatma kullanıcı isteğine bağlıdır.

### 4.3 Doğruluk modu

Zıt mod da açıkça var olmalıdır, yoksa akıcılık modu "kolaycılık" gibi algılanır. Doğruluk modunda düzeltme anında ve ayrıntılıdır, süre baskısı yoktur. **İki modun aynı oturumda çalışması yasaktır** — CAF çatışmasının ürün karşılığı budur.

---

## 5. Egzersizler

### 5.1 Planlama süresi kontrolü

Her konuşma görevi, planlama süresi parametresiyle başlatılır: `0 / 30 / 60 sn`.

- Planlama sırasında ekranda **not alma alanı yoktur** — yazılı hazırlık, ölçülmek istenen şeyi bozar. Sadece konu ve bir geri sayım görünür.
- Sistem, aynı kullanıcıyı zamanla 60 → 30 → 0 sn'ye taşır ve farkı ölçer.

### 5.2 4/3/2

Bu katmanın ana egzersizi.

- Kullanıcı bir konuyu 4 dakika anlatır, aynı konuyu 3 dakikada, sonra 2 dakikada tekrar anlatır.
- Dinleyici (LLM) her turda **aynı ilgiyle** dinler, "bunu zaten söyledin" demez.
- Ölçüm: üç turun `speechRate`, `meanLengthOfRun` ve `falseAlarmRepair` değerleri.
- Beklenen sonuç: hız artar, duraklama azalır, doğruluk **düşmez.** Bu üç sayının kullanıcıya yan yana gösterilmesi, egzersizin ikna edici kısmıdır.
- Yetişkin kullanıcı için varsayılan 3/2/1 dakika da sunulabilir; oran korunduğu sürece etki korunur.

### 5.3 Baskı merdiveni

Kademeli olarak zorlaşan dört basamak. Kullanıcı basamağı kendi seçer, sistem zorlamaz.

| Basamak | Koşul |
|---|---|
| 1 | Hazırlıklı konu, planlama süresi var, karşı taraf sabırlı |
| 2 | Hazırlıklı konu, planlama yok |
| 3 | Yeni konu, planlama yok |
| 4 | Yeni konu, karşı taraf hızlı konuşur ve nazikçe araya girer |

4. basamak yalnızca kullanıcı açıkça istediğinde açılır ve tek tuşla terk edilebilir. Her oturum en yüksek basamakta bitmez; sistem, kullanıcıyı bir alt basamağa döndürerek bitirmeyi tercih eder.

### 5.4 Sessiz kaçınmanın kırılması

`avoidanceScore` yüksekse Coach, hedeflenen yapıyı görev öncesinde **açıkça masaya koyar**: "Bu sefer geçmiş zaman kullanman gereken bir konu seçtim. Yanlış kurman sorun değil, kurmaman sorun." Kaçınma ancak görünür kılınınca kırılır.

---

## 6. Coach'un davranışı

### 6.1 Aynayı gösterme

Coach'un bu katmandaki en değerli çıktısı düzeltme değil, **kullanıcının kendisi hakkındaki inancını verilerle karşılaştırmaktır.** Örnek çıktı biçimi:

> "Bu hafta yazarken doğruluğun %89, konuşurken %84. Aradaki fark anlamlı değil — bildiğin şeyleri konuşurken de kullanıyorsun.
> Ama 12 kez, zaten doğru olan bir cümleyi cümlenin ortasında kesip yeniden kurdun. Kaybettiğin süre yaklaşık 40 saniye.
> Duraklamalarının %70'i cümle ortasında. Cümle sonunda duraklamak normal; ortada duraklamak, cümleyi kurarken kendini denetlediğin anlamına geliyor."

Kurallar:
- Sayı verilir, sıfat verilmez.
- Karşılaştırma daima kullanıcının kendisiyledir; başka kullanıcılarla, "ortalama öğrenci"yle veya seviye normlarıyla **asla** kıyaslanmaz.
- Kötüleşme de dürüstçe söylenir, ama tek oturuma dayanarak söylenmez.

### 6.2 Övgü kuralı

Repair spec'indeki kural burada da geçerlidir: övgü saklanır, hak edilince verilir. Bu katmanda hak edilmiş övgünün tanımı nettir — **`falseAlarmRepair` veya `midClausePauseRatio` düşerken doğruluğun sabit kalması.** Bu gerçekleştiğinde Coach bunu açıkça kutlar, çünkü ölçtüğü şey tam olarak budur.

### 6.3 Yasaklar

Coach şunları **yapmaz:**
- Kullanıcıyı kaygı, özgüven, mükemmeliyetçilik terimleriyle tanımlamak
- "Rahatla", "kendine güven", "hata yapmaktan korkma" türü içi boş telkin
- Akıcılık puanı, monitör puanı gibi tek bileşik skor göstermek
- Nefes egzersizi, meditasyon, terapötik müdahale önermek — **bu ürünün işi değildir**
- Kullanıcı belirgin bir sıkıntı dile getirirse konuyu ölçüme çevirmek; o durumda Coach sadece insanca karşılık verir ve veriye geçmez

---

## 7. Ekranlar

### 7.1 Talk — akıcılık modu göstergesi

- Ekranın üstünde tek satır: **"Akıcılık modu · 4:12 kaldı · düzeltme yok"**
- Renk paleti sakinleşir; hata vurgusu için kullanılan renk bu modda sistemden tamamen çekilir.
- Sağ paneldeki Coach kartı, mod boyunca **kapalı ve sessizdir**; yerinde tek cümle durur: "Şu an dinliyorum."

### 7.2 Oturum sonu kartı

Üç bölüm, bu sırayla:

1. **Ne oldu** — süre, kelime sayısı, kesintisiz en uzun konuşma anı
2. **Ne değişti** — önceki oturuma göre 2 sinyal, ok işaretiyle
3. **Üç not** — §4.2/6'daki kurala göre seçilmiş en fazla üç madde

Kart, kullanıcı istemedikçe ayrıntı açmaz. "Tüm düzeltmeleri gör" bağlantısı vardır ve varsayılan olarak kapalıdır.

### 7.3 Coach — Monitör Yükü bölümü

- §3.1'deki dört karşılaştırma, dört satır halinde.
- Her satır: koşul adı, iki sayı, aradaki fark, tek cümlelik düz Türkçe yorum.
- Veri yetersizse satır griye alınır: "Henüz yeterli örnek yok."
- Grafik yalnızca zaman içindeki tek bir sinyal için çizilir; birden çok sinyali aynı grafiğe bindirmek yasaktır.

### 7.4 Ayarlar

`Coaching` sekmesi altında:

- **Varsayılan mod:** Akıcılık / Doğruluk / Her seferinde sor
- **Sabır süresi:** 1–5 sn
- **Monitör ölçümü:** Açık / Kapalı (kapalıysa ölçüm de durur)
- **Baskı merdiveni en üst basamağı:** 1–4

---

## 8. Diğer katmanlarla ilişki

| Katman | İlişki |
|---|---|
| **Repair** | Repair, anlamanın koptuğu anı ele alır; bu katman üretimin koptuğu anı. İkisi aynı oturumda ölçülür ama **aynı anda öğretilmez.** Akıcılık modunda repair öğretimi de askıya alınır. |
| **Memory** | `falseAlarmRepair` üretilen ifadeler Memory'ye **hata olarak yazılmaz.** Doğru oldukları için oraya girmeleri sistemi bozar. Ayrı bir "gereksiz yere şüphelendiğin yapılar" listesi tutulur ve kullanıcıya güven verici biçimde gösterilir. |
| **Read / Listen** | Yazılı ve alımlama doğruluğu, §3.1'deki karşılaştırmanın referans tarafını sağlar. Bu katman Read'in doğruluk verisi olmadan çalışamaz. |
| **Today** | Profil "monitör baskın" çıktıysa günlük plana haftada en az iki akıcılık görevi girer. |
| **Onboarding** | Onboarding'de bu katmanla ilgili **hiçbir soru sorulmaz.** Profil ölçümden çıkar, beyandan değil. |

---

## 9. Gizlilik

- Tüm sinyaller cihazda hesaplanır ve cihazda kalır. Bu katman, uygulamanın yerel çalışma vaadinin istisnası değildir.
- Ses kaydı sinyal çıkarımı bittikten sonra **saklanmaz**; yalnızca türetilmiş sayılar ve transcript kalır. Kullanıcı isterse kayıt saklamayı açabilir, varsayılan kapalıdır.
- Monitör ölçümü kapatıldığında geçmiş veriler tek tuşla silinebilir.

---

## 10. Tamamlanma kontrol listesi

- [ ] §2'deki sinyaller transcript + ses akışından hesaplanıyor, hepsi bağlam nesnesiyle birlikte kaydediliyor
- [ ] `falseAlarmRepair` tespiti çalışıyor ve doğruluğu elle örneklenerek doğrulandı
- [ ] `midClausePauseRatio` için cümle sınırı tespiti hedef dilde test edildi
- [ ] Akıcılık modu §4.2'deki yedi kuralın hepsine uyuyor; canlı hata işaretlemesi bu modda kod düzeyinde devre dışı
- [ ] Sözleşme ekranı her oturumda gösteriliyor, atlanamıyor
- [ ] Doğruluk modu ayrı ve aynı oturumda birlikte çalışamıyor
- [ ] 4/3/2 egzersizi üç turun karşılaştırmasını gösteriyor
- [ ] Baskı merdiveninin 4. basamağı tek tuşla terk edilebiliyor
- [ ] Coach yetersiz veriyle yorum yapmıyor; "sorun yok" sonucunu açıkça söyleyebiliyor
- [ ] §6.3'teki yasaklar prompt düzeyinde uygulanıyor ve test edildi
- [ ] Memory, `falseAlarmRepair` kayıtlarını hata olarak almıyor
- [ ] Monitör ölçümü kapatıldığında ölçüm gerçekten duruyor
- [ ] Ses kaydı varsayılan olarak saklanmıyor

---

## 11. Kapsam dışı

- Klinik kaygı ölçümü, tarama veya müdahale
- Biyometrik sinyal (kalp atışı, kamera, ses tonundan duygu çıkarımı)
- Kullanıcılar arası karşılaştırma veya sıralama
- Tek bileşik "akıcılık puanı"
- Telaffuz doğruluğu — ayrı bir katmandır, buradaki sinyallerle karıştırılmamalıdır
