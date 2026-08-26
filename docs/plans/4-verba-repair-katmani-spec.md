# Verba — Anlaşma Onarımı ve Koçluk Katmanı Spesifikasyonu

**Durum:** Hedef tasarım (olması gereken)
**Kapsam:** Konuşma sırasında anlamanın koptuğu anın tespiti, ölçümü ve öğretilmesi; koçun insan gibi davranmasını sağlayan kurallar
**İlişki:** `verba-onboarding-spec.md`, `verba-ana-ekran-ve-ayarlar-spec.md` ve `verba-activity-layer-spec.md` dokümanlarının üzerine gelen katmandır. Etkinlik katmanındaki döngü (Coach → Plan → Aktivite → Sinyal → Coach) çalışır durumda olmadan bu katman uygulanamaz.
**Not:** Bu bir düzeltme listesi değildir. Uygulama planı bu spesifikasyondan türetilir.

---

## 0. Bu katman neden var

Dil öğrenenlerin gerçek hayatta donmasının sebebi dilbilgisi eksiği değildir. Sebep şudur: **anlaşma koptuğunda ne yapacağını bilmemek.**

Öğrenci bir cümleyi kaçırır. Sorması gerekir. Sormaz — başını sallar, "sorry" der, konuşmayı sürdürmeye çalışır. Karşı taraf anlaşıldığını sanır ve devam eder. Kopukluk büyür. Öğrenci konuşmanın sonunda hiçbir şey anlamamış ve kendini yetersiz hissetmiş olarak çıkar.

Bu davranışın dilbilimdeki adı **anlam müzakeresinin başarısızlığı**dır; çözümü ise **repair** (onarım) becerileridir: durdurmak, tekrar istemek, yavaşlatmak, doğrulamak, açıklama istemek.

Mevcut dil uygulamalarının hiçbiri bunu öğretmez, çünkü hiçbiri öğrenciyi anlamadığı bir duruma sokmaz. Her şey tam anlaşılır hızda, tam seviyesinde, tam beklediği kelimelerle gelir. Öğrenci hiç kopmaz, dolayısıyla hiç onaramaz.

**Verba'nın bu katmandaki tek işi:** öğrenciyi kontrollü biçimde kopma anına götürmek, o anda ne yaptığını ölçmek ve onarım refleksini kurmaktır.

### Üç yönlendirici ilke

1. **Kopma bir hata değil, dersin kendisidir.** Öğrenci anlamadığında sistem geri çekilmez; o anı işler.
2. **Ölçtüğümüz şey anlama değil, davranıştır.** "Anladın mı?" sorusunun cevabı güvenilmezdir. Öğrencinin anlamadığında *ne yaptığı* güvenilirdir ve ölçülebilir.
3. **Koç, öğrencinin blöfünü görür ama utandırmaz.** Tespit sessizdir, müdahale nazikçedir, kayıt tutulur.

---

## 1. Temel kavramlar

Bu bölümdeki terimler tüm kod tabanında aynı adlarla geçer.

| Terim | Tanım |
|---|---|
| **Kopma (breakdown)** | Öğrencinin karşı tarafın söylediğini anlamadığı an. |
| **Onarım (repair)** | Öğrencinin kopmayı gidermek için ürettiği hamle: tekrar isteme, yavaşlatma, doğrulama, açıklama isteme. |
| **Blöf (bluff)** | Kopma yaşandığı hâlde onarım yapılmadan konuşmanın sürdürülmesi. |
| **Onarım envanteri** | Öğrencinin kullanabildiği onarım kalıplarının ve kullanım sıklığının kaydı. |
| **Blöf oranı** | Belirli bir dönemde tespit edilen kopmaların kaçının onarımsız geçtiği. |
| **Geri sarma (rewind)** | Koçun blöf tespit ettiğinde konuşmayı durdurup son cümleye dönmesi. |
| **Kontrollü zorluk** | Modelin bilinçli olarak öğrencinin rahat alanının bir tık üstünde konuşması. |

---

## 2. Onarım envanteri

### 2.1 Kalıp kategorileri

Onarım hamleleri altı kategoriye ayrılır. Her kategori bağımsız olarak izlenir; öğrenci bir kategoriyi kullanabiliyorken diğerini hiç kullanmıyor olabilir ve envanterin amacı tam olarak bunu görünür kılmaktır.

| Kod | Kategori | Ne yapar | Örnek işlev |
|---|---|---|---|
| `REPEAT` | Tekrar isteme | Cümlenin yeniden söylenmesini ister | "Tekrar eder misin?" |
| `SLOW` | Hız düzenleme | Konuşma hızının düşürülmesini ister | "Biraz daha yavaş konuşabilir misin?" |
| `CONFIRM` | Doğrulama | Anladığını sandığı şeyi kontrol eder | "… demek istedin, değil mi?" |
| `CLARIFY` | Açıklama isteme | Belirli bir kelime/ifadeyi sorar | "… ne demek?" |
| `PARAPHRASE` | Başka türlü söyletme | Aynı şeyin farklı kelimelerle söylenmesini ister | "Başka nasıl söylenir?" |
| `HOLD` | Zaman kazanma | Düşünmek için süre ister | "Bir saniye, düşüneyim." |

`HOLD` bir onarım kalıbı olarak sayılır çünkü blöfün en yaygın alternatifidir: öğrenci sessizlikten korktuğu için blöf yapar; sessizliği meşru kılan bir ifade bu baskıyı kaldırır.

### 2.2 Envanterde tutulan bilgi

Her kategori için öğrenci profilinde şu veri tutulur:

- **Durum:** `bilinmiyor` | `tanıyor` | `kullanıyor` | `akıcı`
  - `bilinmiyor`: hiç gözlenmedi
  - `tanıyor`: koç öğretti, öğrenci kabul etti, henüz kendiliğinden kullanmadı
  - `kullanıyor`: kendiliğinden en az birkaç kez kullandı
  - `akıcı`: son oturumlarda tereddütsüz ve doğru bağlamda kullanıyor
- **Kullanılan varyantlar:** öğrencinin gerçekten ürettiği ifadeler (kendi kelimeleriyle, listeden değil)
- **Son kullanım:** tarih ve hangi aktivitede
- **Kullanım sayısı:** toplam ve son 7 gün

**Kural:** Envanter yalnızca gözleme dayanır. Öğrencinin bir kalıbı "bildiğini" söylemesi durumu değiştirmez. Test ile ölçülmez; konuşmada kullanılarak ölçülür.

### 2.3 Öğretme sırası

Koç aynı anda tek bir eksik kategoriyi hedefler. Sıra öğrencinin ihtiyacına göre belirlenir, sabit değildir; ancak varsayılan öncelik şudur:

`HOLD` → `REPEAT` → `SLOW` → `CLARIFY` → `CONFIRM` → `PARAPHRASE`

Gerekçe: ilk üçü öğrenciyi panikten çıkarır ve anında rahatlama sağlar. Son ikisi daha ileri becerilerdir ve öğrencinin zaten bir miktar rahatlamış olmasını gerektirir.

---

## 3. Kopma ve blöf tespiti

### 3.1 Sinyaller

Sistem "anladın mı?" diye sormaz. Aşağıdaki gözlemlenebilir sinyalleri toplar. Hiçbiri tek başına kesin değildir; birlikte değerlendirilir.

| Sinyal | Neye işaret eder |
|---|---|
| Uzun yanıt gecikmesi | İşleme zorluğu veya panik |
| İçerikten kopuk yanıt | Sorunun kendisi anlaşılmamış |
| Aşırı genel yanıt ("evet", "olabilir", "doğru") | Konumlanma yerine geçiştirme |
| Özür ifadeleri ("sorry", "pardon") ardından devam | Klasik blöf imzası |
| Son cümledeki anahtar kelimenin yanıtta hiç geçmemesi | Anahtar kelime kaçırılmış |
| Konuyu değiştirme | Kaçınma |
| Ses tonunda tereddüt / yarım bırakılmış cümle | Kopma |
| Öğrencinin cümlesinin aniden kısalması | Güven düşüşü |

**Eşikler tasarım parametresidir.** Gecikme süresi, "kısa yanıt" tanımı ve benzeri değerler sabit kodlanmaz; öğrencinin kendi ortalamasına göre normalize edilir. Yavaş konuşan bir öğrenci için 4 saniye normaldir; hızlı konuşan biri için kopma işaretidir. Sistem her öğrenci için kendi taban çizgisini ilk oturumlarda oluşturur.

### 3.2 Blöf kararı

Bir tur şu koşullarda blöf olarak işaretlenir:

1. Kopma sinyallerinden **en az ikisi** aynı turda gözlendi, **ve**
2. Öğrenci o turda hiçbir onarım kalıbı üretmedi, **ve**
3. Konuşma devam etti (öğrenci sessiz kalmadı).

Sadece bir sinyal varsa tur **şüpheli** olarak işaretlenir, kayda geçer ama müdahale tetiklemez.

### 3.3 Yanlış pozitif politikası

Yanlış blöf tespiti, kaçırılan blöften daha zararlıdır — öğrenciyi anlamışken durdurmak güveni kırar. Bu yüzden:

- Şüphede kalınırsa müdahale edilmez, yalnızca kayıt tutulur.
- Aynı oturumda en fazla **iki** geri sarma yapılır. Üçüncü blöf kayda geçer ama konuşma bölünmez.
- Öğrenci bir geri sarmada "hayır, anlamıştım" derse, o tur işaretten düşer ve tespit eşiği o oturum için yükseltilir.

---

## 4. Geri sarma davranışı

Blöf tespit edildiğinde koç konuşmayı durdurur. Bu, sistemin en hassas etkileşimidir; yanlış tonda yapılırsa öğrenci utanır ve uygulamayı bırakır.

### 4.1 Zorunlu davranış

1. **Durdur ve sahiplen.** Suçlama öğrenciye değil, koça yöneltilir: "Bir saniye — sanırım ben çok hızlı gittim."
2. **Tekrar et, basitleştirme.** Aynı cümle daha yavaş söylenir. Kelime değiştirilmez; ilk tekrar **her zaman** aynı cümledir. Öğrencinin gerçekten sadece hızdan kaçırdığını test etmenin tek yolu budur.
3. **Hâlâ anlaşılmadıysa parçala.** Cümle bölünür, anahtar kelime izole edilir, ana dilde karşılığı verilir.
4. **Kalıbı hediye et.** Onarım kalıbı öğretilir ama emir kipiyle değil, model kendi kullanımıyla: "Bu arada, böyle bir durumda 'Could you say that again?' diyebilirsin — bana bunu istediğin kadar söyleyebilirsin."
5. **Konuşmaya kaldığı yerden dön.** Geri sarma bir ders arası değildir; konuşma aynı noktadan sürer.

### 4.2 Yasaklar

- Geri sarma **puan düşürmez**, uyarı göstermez, kırmızı renk kullanmaz.
- "Anlamadın galiba" denmez. Sorumluluk her zaman koçun hızındadır.
- Aynı kalıp aynı oturumda **iki kereden fazla** öğretilmez.
- Öğrenci onarım kalıbını kendiliğinden kullandığında koç bunu **övmez**, sadece **karşılık verir** — yani gerçekten yavaşlar veya gerçekten tekrar eder. Ödül, isteğin işe yaramasıdır. (Bkz. §6.2)

---

## 5. Kontrollü zorluk

Onarım ancak kopma varsa öğrenilir. Kopma yoksa üretilmelidir.

### 5.1 Zorluk kolları

Koç aşağıdaki eksenlerde bilinçli olarak zorluk ekler. Her oturumda **en fazla bir** eksen aktiftir.

| Eksen | Ne yapılır |
|---|---|
| **Hız** | Normal konuşma temposuna çıkılır (ders temposu değil) |
| **Kelime** | Öğrencinin seviyesinin bir üstünde, bağlamdan çıkarılabilir bir kelime kullanılır |
| **Uzunluk** | Tek seferde iki-üç cümlelik bir blok söylenir |
| **Yapı** | Öğrencinin henüz üretemediği ama anlayabileceği bir yapı kullanılır |
| **Beklenmedik yön** | Konuşma öğrencinin hazırladığı cevabın dışına çıkar |

### 5.2 Kalibrasyon kuralı

Hedef, oturum başına **birkaç** kopma — sıfır değil, sürekli değil. Sıfır kopma zorluğun az olduğunu, her turda kopma öğrencinin boğulduğunu gösterir.

- İki oturum üst üste hiç kopma yoksa zorluk bir kademe artar.
- Bir oturumda kopma oranı öğrenciyi konuşamaz hâle getiriyorsa zorluk **anında** düşer ve o oturumun geri kalanı rahat alanda geçer.
- Zorluk artışı öğrenciye duyurulmaz. "Bugün seni biraz zorlayacağım" cümlesi öğrenciyi savunmaya geçirir.

### 5.3 Öğrenci kontrolü

Öğrenci her an "bugün beni zorlama" diyebilir ve bu isteğe **koşulsuz uyulur**. İstek o oturum için geçerlidir, kalıcı bir ayara dönüşmez, ancak sık tekrarlanıyorsa Coach bunu profile not eder.

---

## 6. Koçun insan gibi davranması

Bu bölüm, "yapay zekâyla konuşuyorum" hissini üreten davranışları ortadan kaldırır.

### 6.1 Sabır

- Öğrenci sustuğunda koç **beklemek zorundadır**. Varsayılan bekleme süresi, öğrencinin kendi ortalama yanıt süresinin belirgin biçimde üstünde olmalıdır ve ayarlardan üç kademede değiştirilebilir (`sabırlı` / `normal` / `hızlı`).
- Bekleme sırasında ipucu, öneri, "yardım ister misin?" balonu **gösterilmez**.
- Öğrenci `HOLD` kalıbı kullanırsa (ör. "bir saniye") bekleme süresi sıfırlanır ve koç gerçekten susar.
- Süre dolduğunda koç yardım *önerir*, dayatmaz: "İstersen ben başlatayım?"

### 6.2 Övgü ekonomisi

Yapay zekâyı ele veren tek davranış her cümleden sonra olumlu geri bildirim vermektir.

- **Varsayılan tepki övgü değil, konuşmanın devamıdır.** Öğrenci doğru cümle kurduğunda koç konuya devam eder; bu zaten onaydır.
- Övgü yalnızca **profildeki bir kayda dayanabildiğinde** verilir: "Bunu geçen hafta üç kez kaçırmıştın, bugün doğru kurdun."
- Dayanaksız övgü ("Harika!", "Çok iyi!") **üretilmez**. Bu kural sistem prompt'unda açık biçimde yer alır.
- Oturum başına övgü sayısı sınırlıdır. Sınır aşılırsa övgü değersizleşir.

### 6.3 Hafızanın yüzeye çıkması

Koç hissi büyük ölçüde hatırlamadan gelir. Memory katmanı zaten mevcuttur; bu katmanın eklediği şey, hafızanın **liste olarak değil, konuşmanın içinde** görünmesidir.

- Her oturumun açılışında koç, profilden **en fazla bir** kişisel ayrıntıyı doğal biçimde konuşmaya sokar.
- Seçim kuralı: yakın zamanlı, açık uçlu ve öğrencinin kendi anlattığı bir şey. Sistemin çıkardığı istatistikler (seviye, hata sayısı) bu amaçla kullanılmaz.
- Bir ayrıntı bir kez sorulduktan sonra tekrar sorulmaz; cevap profile işlenir.
- Öğrenci "bunu nereden biliyorsun?" diye sorarsa koç dürüst cevap verir ve Memory ekranına yönlendirir.

### 6.4 Tutarlı kişilik

- Koçun adı, konuşma tarzı ve doğrudanlık seviyesi oturumlar arası **değişmez**.
- Öğrenci koçun tarzını ayarlardan seçebilir (ör. `sıcak` / `nötr` / `doğrudan`), ancak seçim yapıldıktan sonra her yüzeyde aynı uygulanır.
- Koç kendi sınırları hakkında dürüsttür. Bilmediği bir şeyi uydurmaz; bir kelimeden emin değilse söyler.

---

## 7. Kendi hayatından malzeme

Yetişkin öğrenciyi bağlayan şey oyunlaştırma değil, **yarın işine yarayacak olmasıdır**.

### 7.1 Prova modu

Öğrenci gerçek bir konuşmaya hazırlanmak için oturum açabilir.

- Girdi: birkaç cümlelik bağlam (kiminle, ne konuda, ne kadar resmî).
- Koç önce **karşı taraf rolünü** oynar, sonra rolden çıkıp geri bildirim verir.
- Prova sırasında zorluk kolları **kapalıdır**; amaç öğretmek değil, hazırlamaktır.
- Prova bitiminde çıktı: öğrencinin tıkandığı noktalar ve o konuşmada işine yarayacak beş ifade.
- Prova oturumları da sinyal üretir ve profili besler.

### 7.2 Getirilen içerik

Öğrenci kendi metnini getirebilir: e-posta, makale, iş yazışması, bir videonun metni.

- İçerik yerelde işlenir ve varsayılan olarak yerelde kalır.
- Koç içeriği bir **konuşma malzemesi** olarak kullanır — çeviri aracı olarak değil. Metin okunur, üzerine konuşulur, öğrencinin kendi cümleleriyle özetlemesi istenir.
- Getirilen içerikten çıkan yeni kelimeler Memory'ye düşer ve sonraki günlerin planında geri döner.

---

## 8. Gerçek dinleme koşulları

Stüdyo kalitesinde tek bir sesi anlayan öğrenci gerçek hayatta donar. Dinleme aktiviteleri şu değişkenleri kademeli olarak devreye alır:

| Değişken | Kademeler |
|---|---|
| Konuşma hızı | ders temposu → doğal tempo → hızlı |
| Aksan / varyant | tek standart → bölgesel varyantlar |
| Ses ortamı | temiz → hafif arka plan → gürültülü ortam |
| Kanal | net kayıt → telefon kalitesi |
| Konuşmacı sayısı | tek → iki kişi → üst üste binen konuşma |

**Kural:** Aynı anda en fazla iki değişken zorlaştırılır. Öğrenci başarısız olduğunda değişken **anlaşılana kadar geri alınır**, aktivite atlanmaz — çünkü asıl öğrenilecek şey, zor koşulda onarım istemektir.

Bu değişkenlerin uygulanabilirliği kullanılan ses motoruna bağlıdır. Motor bir değişkeni desteklemiyorsa o kademe **gösterilmez**; taklit edilmez.

---

## 9. Yüzeylerde görünüm

### 9.1 Today

- Günün planındaki aktivitelerden **en az biri** aktif onarım hedefi taşır. Kart üzerinde bu teknik dille değil, sonuçla anlatılır: "Bugün seni durdurmayı çalışacağız."
- Blöf oranı Today'de **sayı olarak gösterilmez**. Ham metrik öğrenciye ait değildir; koçun malzemesidir.

### 9.2 Coach

Coach ekranı bu katmanla ilgili şunları gösterir:

- **Onarım envanteri:** altı kategori, her birinin durumu ve öğrencinin kendi kullandığı ifadeler. Öğrencinin kendi cümlelerini görmesi, listeden ezberlemekten çok daha güçlüdür.
- **Zaman içindeki değişim:** blöf oranının seyri. Sayı olarak değil, yön olarak: "Anlamadığında artık daha sık soruyorsun." Yeterli veri yoksa bu bölüm **boş durum gösterir**, tahmin üretmez.
- **Bir sonraki hedef:** hangi kategoriyi çalıştığı, tek cümlede.

### 9.3 Talk / Listen

- Geri sarma anı görsel olarak sakin işaretlenir — konuşmanın akışını bozan bir uyarı değil, ayırt edilebilir bir duraklama.
- Oturum sonunda kopma yaşanan anlar tekrar dinlenebilir/okunabilir olmalıdır.

---

## 10. Sınır ve hata durumları

| Durum | Davranış |
|---|---|
| Ses girişi yok / mikrofon reddedildi | Katman metin üzerinden çalışır; hız ve ses değişkenleri devre dışı, diğer sinyaller geçerli |
| Sinyaller güvenilmez (çok kısa oturum, çok az veri) | Blöf tespiti kapalı kalır, envanter yalnızca pozitif gözlemle dolar |
| Model gecikmesi öğrencinin gecikmesine karışıyor | Model yanıt süresi ölçümden düşülür; ölçülemiyorsa o tur değerlendirmeye alınmaz |
| Öğrenci ana diline kaçıyor | Kopma sinyali sayılır; koç dili zorlamaz, kısa bir köprü kurup hedef dile döner |
| Öğrenci geri sarmadan rahatsız olduğunu belirtiyor | Geri sarma o öğrenci için kapatılabilir; envanter ve ölçüm çalışmaya devam eder |
| Yeterli veri yokken Coach ekranı açılıyor | Boş durum metni gösterilir; uydurma yüzde veya grafik **gösterilmez** |

---

## 11. Bu katmanın yapmayacakları

- Öğrenciye anlayıp anlamadığını **sormaz**. Ölçüm davranıştandır.
- Blöfü **cezalandırmaz**, seri bozmaz, rozet düşürmez.
- Onarım kalıplarını **ezberletmez**. Çoktan seçmeli alıştırma, kalıp listesi, flashcard üretilmez — bu beceri yalnızca gerçek kopma anında öğrenilir.
- Zorluğu **duyurmaz**.
- Dayanaksız **övmez**.
- Ölçemediği hiçbir sayıyı **göstermez**.

---

## 12. Tamamlanma kontrol listesi

Bu katman şu maddelerin tamamı sağlandığında tamamlanmış sayılır:

- [ ] Altı onarım kategorisi tanımlı ve profilde durumları izleniyor
- [ ] Envanter yalnızca gözlemle doluyor; öğrencinin beyanı durumu değiştirmiyor
- [ ] Öğrenci başına yanıt süresi taban çizgisi oluşturuluyor ve sinyaller buna göre normalize ediliyor
- [ ] Model gecikmesi öğrenci gecikmesinden ayrıştırılıyor
- [ ] Blöf kararı en az iki sinyal koşuluna bağlı; tek sinyal yalnızca kayıt üretiyor
- [ ] Oturum başına geri sarma sınırı uygulanıyor
- [ ] Geri sarmada ilk tekrar her zaman aynı cümle, yavaşlatılmış hâlde
- [ ] Geri sarma dili sorumluluğu koça yüklüyor; öğrenciyi işaret eden hiçbir metin yok
- [ ] Öğrencinin kendiliğinden kullandığı onarım isteğine koç **gerçekten** uyuyor (yavaşlıyor / tekrar ediyor)
- [ ] Sabır süresi öğrenci ortalamasına bağlı ve ayarlardan değiştirilebiliyor
- [ ] Bekleme sırasında hiçbir ipucu görünmüyor
- [ ] Övgü yalnızca profildeki bir kayda referansla üretiliyor; oturum başına sınırlı
- [ ] Her oturum açılışında profilden en fazla bir kişisel ayrıntı konuşmaya giriyor ve tekrar sorulmuyor
- [ ] Koç kişiliği oturumlar arası tutarlı; tarz ayarı tüm yüzeylerde aynı uygulanıyor
- [ ] Aynı anda en fazla bir zorluk ekseni aktif
- [ ] Kopma yokluğunda zorluk artıyor, boğulma durumunda anında düşüyor
- [ ] "Bugün beni zorlama" isteğine koşulsuz uyuluyor
- [ ] Prova modu çalışıyor; rol oynama ve geri bildirim ayrışmış durumda
- [ ] Getirilen içerik yerelde işleniyor ve Memory'ye bağlanıyor
- [ ] Dinleme değişkenleri kademeli; desteklenmeyen kademe gösterilmiyor
- [ ] Coach ekranında envanter öğrencinin kendi ifadeleriyle görünüyor
- [ ] Blöf oranı öğrenciye ham sayı olarak gösterilmiyor
- [ ] Veri yetersizken boş durum gösteriliyor, uydurma metrik yok
- [ ] Ses girişi olmadığında katman metin üzerinden çalışıyor
