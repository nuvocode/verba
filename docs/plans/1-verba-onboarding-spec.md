# Verba — Onboarding Spesifikasyonu

**Durum:** Hedef tasarım (olması gereken)
**Kapsam:** Uygulamanın ilk açılışından ilk oturumun (Day 1) başlangıcına kadar geçen her ekran
**Not:** Bu doküman mevcut yapının düzeltme listesi değildir. Onboarding'in nasıl davranması gerektiğini tanımlar. Uygulama planı bu spesifikasyondan türetilir.

---

## 1. Amaç

Onboarding'in tek işi var: **kullanıcıyı, çalıştığından emin olduğumuz bir kurulumla ilk konuşmasına ulaştırmak.**

Onboarding bir kayıt formu değildir. Toplanan her veri, ilk oturumu daha iyi hale getirdiği ölçüde meşrudur. Bir soru "ileride lazım olur" diye soruluyorsa, onboarding'de yeri yoktur — ilk oturumun içinde ya da ayarlarda sorulur.

## 2. Başarı kriterleri

| Ölçüt | Hedef |
|---|---|
| Kurulumu tamamlayıp Day 1'i başlatan kullanıcı oranı | Ölçülür, birincil metrik |
| Teknik olmayan kullanıcının kurulumu tamamlaması | Dışarıdan yardım almadan mümkün olmalı |
| Modelin hazır olduğu durumda toplam süre | ~90 saniye |
| Kurulumun geri döndürülemez adım sayısı | 0 — her karar sonradan değiştirilebilir |
| Bir kullanıcının takıldığı yerde eline geçen şey | Her zaman bir sonraki eylem; asla yalnız bir hata mesajı |

## 3. Tasarım ilkeleri

1. **Ucuz kararlar önce, pahalı kararlar sonra.** Kullanıcı, teknik kurulumun yükünü üstlenmeden önce ürüne duygusal olarak yatırım yapmış olmalı.
2. **Hiçbir ekran, kullanıcının bilmediği bir şeyi bildiğini varsaymaz.** "Çektiğin modeli seç" cümlesi, modelin nasıl çekileceğini anlatmadan kurulamaz.
3. **Beklemeler gizlenir.** Model yanıtı beklenen her an, kullanıcının başka bir şey yaptığı bir ana denk getirilir.
4. **Söylenen ile yapılan aynıdır.** "Sen nerede durursan orada dururuz" deniyorsa test adaptif olmalıdır; değilse cümle kurulmaz.
5. **Her adım atlanabilir, her karar geri alınabilir.** Onboarding'in çıktısı bir sözleşme değil, bir başlangıç noktasıdır.
6. **Gizlilik iddiası her ekranda doğrulanabilir olmalı.** Yerelliği vaat eden bir arayüz, uzak sunucuya giden bir seçeneği aynı cümlenin altında sunamaz.

---

## 4. Akış haritası

```
0. Arayüz dili (ilk açılış, tek seferlik)
   ↓
1. Hedef dil
   ↓
2. Günlük süre
   ↓                      ┌─ model bağlantısı doğrulandığında
3. Model kurulumu ────────┤   seviye testi soruları arka planda
   ↓                      └─ hazırlanmaya başlar
4. Seviye
   ↓
5. Day 1
```

Adım sayacı **4 adım** gösterir (arayüz dili ekranı ve Day 1 sayaca dahil değildir). Bir adım birden fazla ekrana bölünüyorsa (örn. seviye testi soruları), sayaç o adım içinde kendi ilerleme göstergesini kullanır ve üst sayaç sabit kalır.

Ayrı bir "planın hazır" özet ekranı **yoktur**. Özet, Day 1'in içinde kenarda duran ve tıklanabilir olan bir bilgi bloğuna dönüşür.

---

## 5. Ekranlar

### Ekran 0 — Arayüz dili

**Ne zaman:** Uygulamanın ilk açılışında, kurulum sayacından önce.
**Amaç:** Kullanıcının uygulamayı kendi dilinde okumasını sağlamak.

- Sistem diline göre bir seçenek **önceden işaretli gelir**; kullanıcı onaylar veya değiştirir.
- Liste kısa tutulur; desteklenen arayüz dilleri kendi dillerinde yazılır (Türkçe, English, Español…).
- Bu seçim, aksi belirtilmedikçe **ana dil (native language)** için de varsayılan değer olur.
- Sonradan ayarlardan değiştirilebilir. Bu ekran bir daha gösterilmez.

**Geri dönen kullanıcı:** Bu ekranda, sayfanın üstünde **"Daha önce Verba kullandım — klasörümü seç"** girişi bulunur. Bu, tüm kurulumu atlayan tek adımlık bir yoldur ve kurulumun sonunda değil, en başında durur.

---

### Ekran 1 — Hedef dil

**Amaç:** Kullanıcının hangi dili öğrendiğini belirlemek.

- Diller kendi yazımlarıyla ve ana dildeki karşılıklarıyla birlikte gösterilir.
- **OFFICIAL / COMMUNITY** etiketleri açıklanır: "Resmi paketler Verba ekibi tarafından hazırlanır ve dilbilgisi/telaffuz notları içerir. Topluluk paketleri gönüllüler tarafından hazırlanır ve daha az kapsamlı olabilir." Etiketin üzerine gelince bu açıklama görünür.
- **Ana dil ile aynı dil seçilemez.** Ana dil İngilizce ise İngilizce kartı seçilebilir durumda kalır ama seçildiğinde kullanıcıya "Ana dilin İngilizce görünüyor — hedef dilin de İngilizce mi olsun, yoksa ana dilini mi değiştirelim?" sorusu sorulur.
- Kartın altında ana dil satırı bulunur: **"Açıklamalar ve düzeltmeler Türkçe yazılacak — değiştir"**. Kullanıcı buraya hiç dokunmadan devam edebilir, ama seçim görünürdür.
- Seçim yapıldığında ekran **otomatik ilerlemez**; diğer ekranlarla aynı onay hareketi (Enter / Devam) kullanılır.

---

### Ekran 2 — Günlük süre

**Amaç:** Oturum uzunluğunu belirlemek.

- Üç seçenek: kısa / orta / uzun. Her birinin altında ne anlama geldiğini anlatan tek satır.
- Bu ekran **modelden bağımsızdır**; teknik kurulumdan önce gelir.
- "Mostly for" (Seyahat / İş / Aile / Kitap-film) çipleri **bu ekrandan çıkarılır.** Bu bilgi, ilk konuşmanın içinde doğal bir soru olarak sorulur ve oradan kaydedilir.

---

### Ekran 3 — Model kurulumu

Onboarding'in en kırılgan adımı. Tek bir ekran değil, **kullanıcının içinde bulunduğu duruma göre farklı içerik gösteren bir adımdır.**

#### 3a. Hiçbir sağlayıcı bulunamadı (varsayılan varsayım)

Kullanıcı Ollama veya LM Studio kurmamış olabilir. Bu, hata değil **beklenen başlangıç durumudur.**

Ekran şunları içerir:
- Neye ihtiyaç duyulduğunun tek cümlelik açıklaması: "Verba'nın konuşabilmesi için bilgisayarında çalışan bir dil modeline ihtiyacı var. Kurulumu bir kez yapılır, sonra unutulur."
- İki sağlayıcı, her biri için: ne olduğu, indirme bağlantısı, tahmini kurulum süresi ve boyutu.
- **Kurulumdan sonra ne yapılacağı adım adım yazılır** — modelin nasıl indirileceği dahil, kopyalanabilir komut ile birlikte.
- Uygulama arka planda sağlayıcıyı **saniyede bir yoklar**; kullanıcı kurulumu bitirdiğinde ekran kendiliğinden bir sonraki duruma geçer. Kullanıcının "yenile"ye basması gerekmez.

#### 3b. Sağlayıcı bulundu, model yok

- Bulunan sağlayıcı ve sürümü gösterilir: "Ollama çalışıyor — henüz yüklü model yok."
- Cihazın kapasitesine göre **tek bir model önerilir**, kopyalanabilir indirme komutu ile birlikte.
- İndirme ilerlemesi okunabiliyorsa gösterilir.

#### 3c. Sağlayıcı ve model bulundu

- Bağlantı durumu her zaman görünür: **"Ollama'ya bağlı · 10 model"** — yeşil değil, sadece açık bir ifade.
- Modeller ham etiket adlarıyla değil, **anlaşılır biçimde** listelenir. Her model için:
  - insan tarafından okunabilir ad,
  - boyut,
  - hız/kalite dengesine dair tek kelimelik ipucu,
  - bu makinede çalışıp çalışmayacağına dair uyarı ("Bu model belleğine sığmayabilir").
- Bir model **"Önerilen"** olarak işaretlenir ve önceden seçili gelir. Kullanıcı hiçbir şeye dokunmadan devam edebilmelidir.
- Sunucu adresi (`localhost:11434`) varsayılan olarak **gizlidir**, "Gelişmiş" başlığı altında açılır. Çoğu kullanıcı bu alanı hiç görmemeli.

#### Yerellik ve bulut ayrımı

Uzak sunucuya giden modeller (`:cloud` vb.) listede **açıkça ayrılır ve etiketlenir.**

- Yerel modeller: "Bu makinede çalışır. Hiçbir veri dışarı çıkmaz."
- Bulut modelleri: "Sağlayıcının sunucusunda çalışır. Konuşmaların bu sunucuya gönderilir."
- Kullanıcı bulut modeli seçerse, gizlilik vaadinin bu seçim için geçerli olmadığı ekranda görünür ve **onboarding'in başındaki genel "hiçbir şey makineni terk etmiyor" ifadesi kaldırılır** veya "yerel model seçtiğinde" koşuluyla yazılır.
- Bu iki grup asla aynı listede ayrımsız gösterilmez.

#### Bağlantı doğrulama

Devam edilmeden önce uygulama modele **gerçek bir istek gönderir** ve yanıtı alır.

- Kullanıcı kısa bir doğrulama görür: "Model yanıt veriyor — 1,2 sn."
- Bu doğrulama başarısızsa kullanıcı ilerleyemez ve hatanın nedeni (sunucu kapalı / model yüklenemedi / zaman aşımı) ile birlikte somut bir sonraki adım gösterilir.
- Doğrulama başarılı olduğu anda, **seviye testi soruları arka planda üretilmeye başlar.** Kullanıcı bunu görmez.

---

### Ekran 4 — Seviye

**Amaç:** Day 1'in nereden başlayacağını belirlemek.

**Varsayılan yol: kullanıcının kendi seçmesi.** Seviye çubuğu (A1–C2) doğrudan gösterilir, kısa açıklamalarıyla birlikte ("B1 — günlük konuları takip edebiliyorum"). Kullanıcı bir seviye seçer ve devam eder.

Testin kendisi **ikincil ve isteğe bağlı bir bağlantıdır**: "Emin değil misin? 8 soruluk kısa bir test al."

Bu tercih bilinçlidir: test, onboarding'in en pahalı, en yavaş ve en kırılgan parçasıdır; zorunlu olduğunda tamamlanma oranını düşürür. Ayrıca coach ilk günlerde seviyeyi zaten kendisi ayarlar — testin doğruluğu kritik değildir.

#### Test seçilirse

- **Sorular önceden hazırlanmış olmalıdır.** Kullanıcı testi seçtiğinde beklemez; ilk soru anında gelir. (Üretim, Ekran 3'ün sonunda başlamıştır.)
- Sorular hazır değilse: ilerleme durumu, tahmini süre, **iptal** ve "kendim seçeyim"e dönüş yolu gösterilir. Bekleme ekranı çıkışsız olamaz.
- Soru kaynağı:
  - **Resmi diller için küratörlü, sabit bir soru havuzu kullanılır.** Seviye ataması, modelin o anki üretim kalitesine bırakılmayacak kadar önemlidir.
  - Model üretimi yalnızca topluluk dilleri veya havuzun yetmediği durumlar için yedek yoldur.
- **Test adaptif olmalı ya da öyle olduğu iddia edilmemelidir.** Adaptif ise: ardışık yanlışlarda erken durur, sabit 8 soru vaadi kaldırılır. Değilse: "8 soru, hepsini görürsün" denir.
- Soru altındaki metin gerilim yaratmaz. "Tahmin etmek serbest — ama yanlış cevap tavanını belirler" gibi kendi içinde çelişen ifadeler kullanılmaz. Doğrusu: **"Bilmiyorsan geç. Seviyeni istediğin zaman değiştirebilirsin."** — ve gerçekten bir "geç" seçeneği bulunur.
- Sonuç ekranı sonucu **öneri olarak** sunar, kilit olarak değil: seçili seviye değiştirilebilir durumdadır ve değiştirme eylemi ikincil değil, eşit görünürlüktedir.

---

### Ekran 5 — Day 1

Onboarding, ayrı bir özet ekranıyla değil, **doğrudan ilk oturumla** biter.

- Day 1 başlamadan önce kullanıcı **ne olacağını görür**: bir cümlelik önizleme ve oturumun uzunluğu.
- Kurulum özeti (model, diller, seviye, süre) ilk oturumun kenarında, katlanmış halde durur ve her satırı oradan değiştirilebilir.
- Sesli konuşma varsa: mikrofon izni ve kısa bir ses testi **burada** istenir, kurulumun ortasında değil. Sesli konuşma yoksa, hiçbir ekranda "conversation-first" ifadesi kullanılmaz.
- Verilerin nerede saklandığı bir kez, açıkça gösterilir ve klasör değiştirilebilir.
- Günlük hatırlatma isteyip istemediği burada sorulur. "Her sabah taze planlanır" vaadi ediliyorsa, "her sabah"ın saatinin ne olduğu kullanıcıya sorulmuş olmalıdır.

---

## 6. Kurulum boyunca geçerli kurallar

### Durum yönetimi
- Kullanıcının verdiği her cevap **anında kalıcı hale getirilir.** Uygulama kapanıp açıldığında kurulum kaldığı yerden devam eder.
- Ekran 4'te seçilen seviye, Day 1'e **birebir** aktarılır. Onboarding boyunca hiçbir değer sessizce dönüştürülmez.
- Ana dil ve hedef dil aynı olamaz; bu kural kurulum içinde ve ayarlarda aynı şekilde uygulanır.

### Atlama
- "Kurulumu atla" **her ekranda** bulunur ve aynı yerde durur.
- Atlandığında ne olduğu açıktır: makul varsayılanlarla (sistem dili, orta süre, B1) devam edilir ve bunların değiştirilebileceği söylenir.
- Model kurulumu atlanamaz; onsuz ürün çalışmaz. Bunun yerine 3a durumu gösterilir.

### Hata ve boş durumlar
Her adım için tanımlanması gereken durumlar:

| Durum | Karşılık |
|---|---|
| Sağlayıcı bulunamadı | Kurulum yönlendirmesi + otomatik yoklama |
| Sağlayıcı var, model yok | Öneri + indirme komutu |
| Model yanıt vermiyor / zaman aşımı | Neden + tekrar dene + model değiştir |
| Model cihaz için fazla büyük | Uyarı + daha küçük öneri |
| Test üretimi başarısız | Küratörlü havuza düş, olmadı "kendim seçeyim"e yönlendir |
| Test üretimi yavaş | İlerleme + iptal + alternatif yol |
| Geri yükleme klasörü geçersiz | Ne beklendiğinin açıklaması + yeniden seçim |

Hiçbir hata durumu kullanıcıyı çıkışsız bırakmaz.

### Klavye ve etkileşim
- Tüm ekranlarda aynı model: sayı tuşları seçer, **Enter onaylar**, Esc geri gider.
- Hiçbir ekran seçim anında kendiliğinden ilerlemez.
- Tüm etkileşimler klavyeyle tamamlanabilir; odak sırası görsel sırayla aynıdır.

### Görsel tutarlılık
- Başlık bloğu tüm ekranlarda **aynı dikey konumda** başlar; geçişlerde içerik zıplamaz.
- İçerik sütunu, pencere genişliğinden bağımsız olarak ortalanır; geniş pencerede sağda ölü alan bırakmaz.
- İlerleme çubuğu yalnızca bir adım birden çok ekrana bölündüğünde görünür ve o adıma aittir.

### Metin kuralları
- Hiçbir cümle kendi içinde çelişmez.
- Teknik terim (server, endpoint, model tag) kullanıcıya gösterilen ana akışta geçmez; "Gelişmiş" alanına taşınır.
- Gizlilik ifadeleri koşulludur ve koşul yazılır.
- Süre vaadi verilen her yerde ("iki dakika sürer"), gerçek süre ölçülür ve ifade buna göre tutulur.

---

## 7. Kapsam dışı

Bu adımlar onboarding'de **yer almaz**, ilk oturum içinde veya ayarlarda ele alınır:

- İlgi alanları / konu tercihleri
- Bildirim ayrıntıları (saat dışında)
- Hesap oluşturma, e-posta, senkronizasyon
- İleri model parametreleri (sıcaklık, bağlam uzunluğu)
- Öğrenme hedefi tarihi, seri takibi

---

## 8. Tamamlanma tanımı

Onboarding, aşağıdakilerin tümü sağlandığında hazır kabul edilir:

- [ ] Ollama/LM Studio kurulu olmayan bir makinede, terminal bilgisi olmayan bir kişi kurulumu tamamlayabiliyor
- [ ] Bölüm 6'daki hata tablosundaki her durumun tasarlanmış bir ekranı var
- [ ] Model doğrulaması geçilmeden Ekran 4'e ulaşılamıyor
- [ ] Testi seçen kullanıcı ilk soruyu beklemeden görüyor
- [ ] Kurulum ortasında uygulama kapatılıp açıldığında ilerleme korunuyor
- [ ] Seçilen seviye, Day 1'de aynı değerle görünüyor
- [ ] Bulut modeli seçildiğinde gizlilik ifadesi buna göre değişiyor
- [ ] Her ekran yalnızca klavyeyle tamamlanabiliyor
- [ ] Ana dil ve hedef dil hiçbir yoldan aynı olamıyor
