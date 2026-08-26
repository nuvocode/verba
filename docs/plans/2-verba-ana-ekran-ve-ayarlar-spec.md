# Verba — Ana Ekran ve Ayarlar Spesifikasyonu

**Durum:** Hedef tasarım (olması gereken)
**Kapsam:** Onboarding tamamlandıktan sonraki uygulama kabuğu — Today ekranı, üst gezinme ve ayarların tamamı
**İlişki:** Bu doküman `verba-onboarding-spec.md` dokümanının devamıdır. Onboarding'de kurulan her değerin burada nerede yaşadığını ve nasıl değiştirildiğini tanımlar.
**Not:** Bu bir düzeltme listesi değildir. Mevcut yapıya atıfta bulunmaz. Uygulama planı bu spesifikasyondan türetilir.

---

## 1. Amaç

Ayarların tek işi var: **kullanıcının ürünü kendi hayatına uydurmasını sağlamak — ve bunu yaparken hiçbir şeyi bozmadığından emin olmasını sağlamak.**

Ayarlar bir kontrol paneli değildir. Her ayar, kullanıcının sorabileceği bir soruya cevap verdiği ölçüde meşrudur. Bir seçenek "sistemde böyle bir kavram var" diye duruyorsa, ana akışta yeri yoktur — Gelişmiş'e iner ya da hiç görünmez.

Ana ekranın tek işi de şudur: **kullanıcıyı düşünmeden bugünün oturumuna sokmak.**

## 2. Temel ilkeler

1. **Tek doğruluk kaynağı.** Bir değer bir yerde tanımlanır ve her yerde aynı görünür. Ayarlarda seçilen seviye, dil ve süre; ana ekranda, oturum içinde ve üretilen içerikte birebir aynı değerdir.
2. **Kullanıcının amacına göre bölünme.** Ayarlar, sistemin bileşenlerine göre değil, kullanıcının sorularına göre gruplanır.
3. **Sonucu söyle.** Bir ayarı değiştirmek başka bir şeyi etkiliyorsa, bu değiştirme anında yazılır — sonradan değil.
4. **Kapalı olan sebebini söyler.** Devre dışı hiçbir öğe sessiz kalmaz.
5. **Teknik terim ana akışta geçmez.** Sağlayıcı adları, model etiketleri, port numaraları, dosya biçimleri ve motor isimleri yalnızca Gelişmiş altında görünür.
6. **Geri alınamayan hiçbir şey tek tıkla olmaz.**
7. **Klavye ile yapılabilen her şey fareyle de yapılabilir.** Kısayollar hızlandırıcıdır, tek yol değildir.

---

## 3. Değer modeli

Aşağıdaki değerler tek bir yerde tutulur ve tüm ekranlara oradan akar. Hiçbir ekran kendi kopyasını üretmez, hiçbir metin bu değerleri sabit yazmaz.

| Değer | Nerede belirlenir | Nerede görünür |
|---|---|---|
| Arayüz dili | Ayarlar → Öğrenme | Tüm uygulama metinleri |
| Ana dil | Ayarlar → Öğrenme | Açıklamalar, düzeltmeler, çeviriler |
| Hedef dil | Ayarlar → Öğrenme | Ana ekran başlığı, tüm oturum içerikleri |
| Seviye | Ayarlar → Öğrenme | Üretilen metinlerin zorluğu, ana ekran kartları |
| Günlük süre | Ayarlar → Öğrenme | Günün planının toplam uzunluğu |
| Koçluk tarzı | Ayarlar → Öğrenme | Düzeltmelerin ne zaman görüneceği |
| Çevrimdışı kilidi | Ayarlar → Gizlilik ve veri | Sağlayıcı ve ses seçeneklerinin uygunluğu |

**Kurallar:**

- Ana dil ile hedef dil **hiçbir yoldan aynı olamaz.** Kullanıcı birini diğerine eşitlemeye çalıştığında değişiklik uygulanmaz; hangisini değiştirmek istediği sorulur.
- Günlük süre bir **hedeftir**, plan bu hedefe göre üretilir. Planın toplam süresi ile ayardaki değer arasındaki fark tek bir yuvarlama farkından büyük olamaz. Plan hedefe ulaşamıyorsa bunun sebebi ana ekranda yazılır.
- Seviye değiştiğinde o günün planı yeniden üretilir ve kullanıcıya "bugünün planı yenilendi" denir.
- Hedef dil değiştiğinde: kelime destesi, hafıza ve seri **dile özeldir**, silinmez, o dilin kaydına geçilir. Bu davranış değiştirme anında bir cümleyle anlatılır.

---

## 4. Ana ekran (Today)

### 4.1 Amaç

Kullanıcı uygulamayı açtığında tek bir soruya cevap arar: *bugün ne yapıyorum ve nereden başlıyorum?* Ekran bu soruya bir ekran boyu içinde, kaydırmadan cevap verir.

### 4.2 İçerik

**Üst satır — bağlam.** Tarih, kaçıncı gün ve **hedef dil**. Hedef dil burada her zaman yazılır; kullanıcı hangi dilin oturumunda olduğunu tahmin etmek zorunda kalmaz.

**Selamlama.** Günün saatine göre değişir. Tek cümle.

**Günün özeti.** Bugünün temasını, kaç bölümden oluştuğunu ve toplam süresini söyler. Süre, ayarlardaki günlük süre hedefiyle tutarlıdır.

**Temayı değiştirme.** Özetin yanında görünür bir bağlantı bulunur: "başka bir konu". Kullanıcı bugünün temasını beğenmediğinde plan yeniden üretilir. Bu, ürünün en sık istenecek eylemlerinden biridir ve bir menünün içine gizlenmez.

**Bölüm listesi.** Her satır şunları içerir:
- Sıra numarası
- Bölümün adı — **hedef dilin adı geçtiği her yerde gerçek hedef dil yazılır**
- Tek satırlık açıklama ve tahmini süre
- **Durum:** tamamlandı / sırada / bekliyor. Tamamlanan bölümler görsel olarak ayrışır ve tekrar açılabilir.
- Satırın tamamı tıklanabilirdir. Sıradaki bölüm ayrıca Enter ile başlar.

**Bugünün ilerlemesi.** Kaç bölümün bittiği ve kalan süre, liste başında tek satır olarak görünür. Oturum yarıda kesilip dönüldüğünde kullanıcı nerede kaldığını arayarak bulmaz.

**Dünün izi.** Ekranın altında, bir önceki oturumdan tek satırlık bir hatırlatma bulunur: en son çalışılan konu veya tekrar zamanı gelmiş kelime sayısı. Bu satır tıklanabilir.

**Klavye ipuçları.** Ayarlardan kapatılabilir. Kapatıldığında hiçbir işlev kaybolmaz.

### 4.3 Üst gezinme

- Bölüm adları yazıyla görünür. Yanlarındaki rakamlar **kısayol** olduklarını belli edecek şekilde biçimlendirilir; sayaç veya rozetle karıştırılmaz. Bir bölümde bekleyen öğe varsa (örneğin tekrarı gelen kelimeler), bu ayrı ve açıkça bir sayaç olarak gösterilir.
- **Ayarlara giden görünür bir giriş noktası bulunur.** Fareyle gezen bir kullanıcı ayarları arayarak değil, görerek bulur. Kısayol bu girişin yerine geçmez.
- Çalışma yeri göstergesi (yerel / çevrimiçi) düz dille yazılır: "Bu bilgisayarda" veya "Çevrimiçi". Sağlayıcının ticari adı burada geçmez; üzerine gelindiğinde ayrıntı görünür.
- Etiketsiz hiçbir gösterge bulunmaz. Bir şey bir durumu anlatıyorsa, adı vardır.

### 4.4 Komut paleti

- Her yerden açılır, arama yapar, bölümlere ve **ayar sayfalarına** atlar.
- Bir hızlandırıcıdır. Palet olmadan da uygulamanın tamamı kullanılabilir olmalıdır.

---

## 5. Ayarlar

### 5.1 Yapı

Ayarlar beş bölümden oluşur. Bölüm adları kullanıcının sorularının karşılığıdır:

| Bölüm | Cevapladığı soru |
|---|---|
| **Öğrenme** | Ne öğreniyorum, ne kadar, nasıl düzeltilmek istiyorum? |
| **Konuşma ve dinleme** | Sesini nasıl duyarım, beni nasıl duyar? |
| **Gizlilik ve veri** | Verilerim nerede, nasıl taşırım, nasıl silerim? |
| **Hakkımda** | Benim hakkımda ne biliyor? |
| **Gelişmiş** | (Yalnızca isteyen için) Hangi model, nereden, hangi eklentiler? |

### 5.2 Ayarların genel davranışı

- **Sayfa başlığı, bulunulan bölümün adıdır.** Ürün sloganı ayarlarda tekrar edilmez.
- **Arama alanı bulunur.** Kullanıcı "ses", "mikrofon", "sil", "dil" yazdığında ilgili ayara ulaşır. Arama, ayar adlarının yanında açıklamalarında da eşleşir.
- **Değişiklikler anında uygulanır ve anında geri bildirim verilir.** Kaydet düğmesi yoktur. Bir değişikliğin sonucu geniş kapsamlıysa (dil, seviye, çevrimdışı kilidi) satırın altında tek cümleyle ne olduğu yazılır ve **geri al** bağlantısı kısa süre görünür.
- **Her ayarın bir açıklaması vardır.** Başlık ne olduğunu, alt satır ne işe yaradığını söyler. Açıklaması yazılamayan ayar, ana akışta bulunmaz.

---

### 5.3 Öğrenme

Onboarding'de kurulan her şeyin yaşadığı yer. Sıralama onboarding ile aynıdır; kullanıcı aynı kavramları aynı sırada bulur.

**Arayüz dili**
- Uygulamanın kendi metinlerinin dili. Onboarding'de seçilen değer burada görünür ve değiştirilebilir.
- Değiştirildiğinde arayüz anında yeniden çizilir; yeniden başlatma istenmez.

**Ana dil**
- Açıklamaların ve düzeltmelerin yazılacağı dil. Varsayılanı arayüz dilidir.
- Serbest metin değildir; listeden seçilir.

**Hedef dil**
- Diller kendi yazımlarıyla ve ana dildeki karşılıklarıyla listelenir.
- Liste beş öğeyi geçtiğinde **filtre alanı** bulunur.
- **Resmî / Topluluk** etiketleri açıklanır. Etiketin yanında bir yardım işareti bulunur; içeriği: resmî paketlerin ekip tarafından hazırlandığı ve dilbilgisi/telaffuz notları içerdiği, topluluk paketlerinin gönüllülerce hazırlandığı ve daha dar olabileceği.
- Paket içeriği kullanıcının anlayacağı dille özetlenir. Ham sayı ("3 not") tek başına bir bilgi değildir; ne tür destek sağlandığı yazılır.
- Seçili dilin yanında **o dile ait ilerleme** görünür: kaçıncı gün, kaç kelime. Böylece dil değiştirmenin bir şey silmediği görülür.
- Ana dille aynı dil seçilemez (bkz. Bölüm 3).

**Seviye**
- CEFR kodu tek başına gösterilmez. Her seçenek, kodun yanında **ne anlama geldiğini** anlatan bir satırla birlikte sunulur.
- Kullanıcı emin değilse: "Emin değilim — kısa bir test yapalım" bağlantısı bulunur ve onboarding'deki testi çalıştırır.
- Değişiklik günün planını yeniler (bkz. Bölüm 3).

**Günlük süre**
- Onboarding'deki üç seçenekle **aynı kavram ve aynı adlarla** sunulur. Bir yerde "kısa/orta/uzun", diğer yerde ham dakika olamaz.
- Seçeneğin altında bunun ne demek olduğu yazar: kaç bölüm, yaklaşık kaç dakika.

**Koçluk tarzı**
- Üç seçenek: her hatada / anlamı bozan hatalarda / oturum sonunda.
- Her seçeneğin altında tek satır açıklama bulunur ve **nasıl göründüğüne dair minik bir örnek** gösterilir. Kullanıcı seçimini denemeden anlar.

**Klavye ipuçları**
- Ekran altındaki kısayol satırlarının görünürlüğü. Bu bir arayüz tercihidir ve koçlukla birlikte anılmaz; Öğrenme bölümünün sonunda "Arayüz" başlığı altında durur.

---

### 5.4 Konuşma ve dinleme

Bu bölüm tek bir sayfadır ve iki soruya cevap verir: *Verba nasıl konuşsun, beni nasıl duysun?*

**Verba'nın sesi**
- Açık/kapalı anahtarı en üstte. Kapalıyken alt seçenekler görünmez.
- Ses seçimi tek bir listedir. Her seçenek: sesin adı, hangi dillerde çalıştığı, boyutu ve **dinle** düğmesi.
- **Hiçbir ses, dinlenmeden indirilmez.** İndirilmemiş seslerin de kısa bir örneği çalınabilir.
- Yalnızca seçili hedef dille çalışan sesler öne çıkar; diğerleri "diğer diller" başlığı altında toplanır. Bir başlık, altındaki içerikle çelişemez.
- "Önerilen" etiketi **aynı anda yalnızca bir seçenekte** bulunur.
- İndirilmiş bir ses kaldırılabilir. Kullanımdaki ses kaldırılmak istendiğinde önce yerine ne geçeceği sorulur.
- Motor seçimi (paketli / yerel sunucu / bulut / sistem) ana akışta yoktur. Varsayılan otomatiktir; hangisinin kullanıldığı tek satır olarak yazılır ve **Gelişmiş**'ten değiştirilir.

**Verba'nın duyması**
- Mikrofon cihazı seçilir.
- **Mikrofon testi bulunur:** kullanıcı konuşur, seviye göstergesini görür, söylediğinin yazıya dökülmüş hâlini okur. Konuşma özelliği, çalıştığı görülmeden kullanılmaz.
- Dictation modelinin adı ve boyutu ana akışta geçmez; doğruluk/hız tercihi olarak sunulur ("hızlı" / "daha doğru, daha yavaş"), teknik karşılığı Gelişmiş'te durur.
- Mikrofon izni verilmemişse bu sayfa bunu söyler ve izne giden yolu gösterir.

**Kullanım talimatı burada durmaz.** "Konuşmak için şu düğmeye bas" bilgisi konuşmanın yapıldığı ekranda, ilk kullanımda gösterilir.

---

### 5.5 Gizlilik ve veri

Çevrimdışı kilidi ve veri yönetimi aynı sorunun iki parçasıdır; aynı sayfada dururlar.

**Çevrimdışı kilidi**
- Anahtarın adı bir ayar adıdır, bir slogan değil: "Yalnızca bu bilgisayarı kullan".
- Altında ne yaptığı yazar: bulut sağlayıcıların ve bulut seslerinin kapatılacağı, hiçbir öğrenci verisinin cihazdan çıkmayacağı.
- **Açıkken, adında veya tanımında bulut geçen hiçbir model veya ses seçili kalamaz.** Böyle bir seçim varsa kullanıcıya bu söylenir ve yerel bir alternatif önerilir. Bu çelişki hiçbir koşulda ekranda yan yana durmaz.
- Anahtarın durumu yazıyla da okunur ("Açık" / "Kapalı"); yalnızca renkle anlatılmaz.

**Verilerin yeri**
- Verilerin bulunduğu **klasör yolu görünür** ve klasörü açan bir düğme bulunur. Gizlilik iddiası olan bir üründe verinin yeri gösterilir, anlatılmaz.
- Ne saklandığı kısa bir listeyle yazılır: konuşmalar, kelimeler ve tekrar takvimi, metinler, günlük planlar, hafıza, ayarlar.

**Dışa ve içe aktarma**
- Yedeğin API anahtarlarını içerdiği uyarısı dışa aktarma düğmesinin yanında durur.
- İndirilmiş ses modellerinin yedeğe dahil edilmediği ve gerektiğinde yeniden indirileceği yazılır.
- **İçe aktarma mevcut verinin üzerine yazar.** Bu, işlemden önce açıkça söylenir ve onay istenir. Onaydan önce mevcut verinin otomatik bir yedeği alınır.

**Eşitleme klasörü**
- Ne işe yaradığı tek paragrafta anlatılır: kullanıcının kendi eşitleme servisinin izlediği bir klasöre tam bir kopya yazılır, başka bir makine aynı klasörü gösterdiğinde her şeyi bulur.
- Klasöre canlı veritabanının değil, **bütün hâlde yazılan bir kopyanın** konduğu bir cümleyle söylenir. Teknik gerekçe Gelişmiş'e taşınır.
- Klasör seçildikten sonra **durum görünür:** en son ne zaman yazıldığı, boyutu, bir sorun varsa nedeni.

**Her şeyi sil**
- Bu bölümün sonunda bulunur. Neyin silineceğini sayar, geri alınamayacağını söyler ve **yazarak onay** ister.
- Silmeden önce dışa aktarma teklif edilir.

---

### 5.6 Hakkımda

**Adlandırma:** Uygulamada iki farklı "hafıza" bulunamaz. Kelimeler ve tekrar destesi nav'da kendi adıyla anılır; koçun kullanıcı hakkında öğrendikleri bu sayfada **Hakkımda** adıyla durur. İki kavramı birbirinden ayırmak için açıklama yazmak zorunda kalınıyorsa, adlar yanlıştır.

**İçerik**
- Açıklama iki cümleyi geçmez: koçun konuşmalar sırasında öğrendikleri burada durur, oturumları buna göre kurar, buradan silinen bir şey anında etkisini kaybeder.
- Her satırda: bilginin kendisi, ne zaman öğrenildiği, ve düzenle / sil.
- **Kullanıcı kendi eliyle bilgi ekleyebilir.** "Bana X de", "vejetaryenim", "işte teknik konuşmam gerekiyor" gibi şeyler konuşmanın rastlantısına bırakılmaz.
- **Öğrenmeyi duraklat** anahtarı bulunur. Açıkken mevcut bilgiler kullanılmaya devam eder ama yenisi eklenmez.
- **Tümünü unut** işlemi onay ister.
- Bu kaydın hedef dile özel olduğu tek cümleyle yazılır.
- "Prompt" gibi terimler kullanılmaz; koçun bu bilgileri her oturumda okuduğu düz dille söylenir.

---

### 5.7 Gelişmiş

Bu bölüm varsayılan olarak **kapalı bir başlık** altındadır ve teknik olmayan kullanıcının işine yaramayacağı belirtilir. İçindeki hiçbir ayar, ana akıştaki bir işin ön koşulu değildir.

**Model**
- Sağlayıcı seçimi (yerel seçenekler ve bulut seçenekleri).
- **Model, kurulu modellerden seçilir.** Serbest metin alanı yalnızca listeye düşmeyen bir model için, ayrı ve açıkça işaretlenmiş bir alan olarak bulunur.
- Her modelin yanında: önerilen rozeti, hız/kalite göstergesi ve bu makine için fazla büyükse uyarı.
- **Bağlantıyı sına** düğmesi bulunur: modele gerçek bir istek gönderir, yanıtı ve geçen süreyi gösterir.
- Adres alanı (host) bu bölümdedir.
- Bulut sağlayıcılar için anahtar alanı, sağlayıcı seçildiğinde görünür; anahtarın nereden alınacağı bağlantıyla gösterilir.
- Devre dışı bir sağlayıcı **nedenini ve çözümünü** satır içinde yazar: hangi ayarın onu kapattığı ve o ayara giden bağlantı.

**Yanıt biçimi**
- Modelin önce düşünüp sonra cevaplaması tercihi, bir hız/kalite dengesi olarak sunulur. Başlık, altındaki seçeneğin yönüyle çelişmez.

**Ses ve dictation motorları**
- Konuşma bölümünde gizlenen motor seçimleri burada bulunur.

**Eklentiler**
- **Kurulu senaryolar listelenir.** Adı, nereden geldiği ve kaldırma seçeneği görünür. Sayı verilip liste verilmez olmaz.
- İçe aktarma **dosya seçerek** yapılır. Metin yapıştırma ikincil bir yoldur ve varsayılan değildir.
- Dosya biçimi, depo dosyası adı gibi geliştirici artıkları arayüzde geçmez; belgelere bağlantı verilir.
- Dil paketlerinin ne olduğu ve nereden bulunacağı bir cümleyle yazılır. Sıfır öğe varsa boş durum bunu anlatır.

---

## 6. Genel kurallar

### Metin
- Hiçbir cümle kendi içinde veya bir başka ekranla çelişmez.
- Teknik terim ana akışta geçmez; Gelişmiş'e taşınır.
- Gizlilik ifadeleri koşulludur ve koşul yazılır.
- Sayılar tek başına gösterilmez; ne anlama geldikleri yazılır.
- Bir eylemin adı, yaptığı işi söyler.

### Durum ve geri bildirim
- Her değişiklik anında kalıcı olur ve görünür bir onay verir.
- Sonucu geniş olan değişiklikler ne yaptığını yazar ve kısa süreli geri alma sunar.
- Devre dışı hiçbir öğe sebepsiz kalmaz.
- Boş durumların (kurulu eklenti yok, indirilmiş ses yok, hafızada bilgi yok) tasarlanmış bir karşılığı vardır.

### Yıkıcı işlemler
Onay isteyen işlemler: kullanımdaki bir sesin kaldırılması, hafızanın tümünün silinmesi, verinin içe aktarılması, her şeyin silinmesi, eklenti kaldırma.
Onay ekranı **ne kaybedileceğini sayar** ve geri alınıp alınamayacağını söyler.

### Klavye ve etkileşim
- Rakam tuşları bölümlere gider, Enter onaylar, Esc geri döner.
- Tüm işlevler fareyle de erişilebilir.
- Odak sırası görsel sırayla aynıdır.

### Düzen
- Sayfa başlığı bulunulan bölümün adıdır ve tüm bölümlerde aynı dikey konumda başlar.
- İçerik sütunu pencere genişliğinden bağımsız olarak ortalanır; geniş pencerede tek yana yığılmaz.
- Bölümler arası geçişte içerik zıplamaz.

---

## 7. Durum tablosu

| Durum | Karşılık |
|---|---|
| Çevrimdışı kilidi açık, bulut model seçili | Değişiklik engellenir, yerel alternatif önerilir |
| Model yanıt vermiyor | Ana ekranda uyarı + sına düğmesi + model değiştir yolu |
| Seçili ses indirilmemiş | Otomatik olarak paketli sese düşülür, bu söylenir |
| Mikrofon izni yok | Konuşma bölümü nedeni yazar, izne giden yolu gösterir |
| Hedef dil = ana dil denemesi | Uygulanmaz, hangisinin değişeceği sorulur |
| Eşitleme klasörü erişilemiyor | Son başarılı yazma zamanı + neden + yeniden seç |
| İçe aktarılan dosya geçersiz | Ne beklendiği yazılır, mevcut veri korunur |
| Plan günlük süre hedefine ulaşamıyor | Ana ekranda nedeni yazılır |
| Dil paketi eksik/bozuk | Hangi özelliğin çalışmayacağı yazılır, uygulama açık kalır |

Hiçbir durum kullanıcıyı çıkışsız bırakmaz.

---

## 8. Kapsam dışı

Bu spesifikasyon şunları kapsamaz ve bunlar ayarlarda **yer almaz**:

- Hesap, e-posta, oturum açma
- Bildirim ayrıntıları (hatırlatma saati dışında)
- Model parametreleri (sıcaklık, bağlam uzunluğu, örnekleme)
- Tema ve renk düzenlemesi (aydınlık/karanlık dışında)
- İçerik üretim istemlerinin doğrudan düzenlenmesi

---

## 9. Tamamlanma tanımı

Ayarlar ve ana ekran, aşağıdakilerin tümü sağlandığında hazır kabul edilir:

- [ ] Ayarlara fareyle, kısayol bilmeden ulaşılabiliyor
- [ ] Ayarlar içinde arama çalışıyor ve açıklama metinlerinde de eşleşiyor
- [ ] Ana ekranda görünen dil, seviye ve süre, ayarlardaki değerlerle birebir aynı
- [ ] Hiçbir ekranda sabit yazılmış dil adı kalmadı
- [ ] Ana dil ile hedef dil hiçbir yoldan aynı olamıyor
- [ ] Çevrimdışı kilidi açıkken bulut adı taşıyan hiçbir seçim ekranda duramıyor
- [ ] Devre dışı her öğe nedenini ve çözümünü satır içinde yazıyor
- [ ] Her ses, indirilmeden önce dinlenebiliyor
- [ ] Mikrofon testi konuşulanı yazıya dökerek gösteriyor
- [ ] Verilerin klasör yolu görünüyor ve klasör açılabiliyor
- [ ] "Her şeyi sil" mevcut ve yazarak onay istiyor
- [ ] Hafızaya elle bilgi eklenebiliyor ve öğrenme duraklatılabiliyor
- [ ] Uygulamada "hafıza" adını taşıyan tek bir kavram var
- [ ] Kurulu eklentiler listeleniyor ve kaldırılabiliyor
- [ ] Ana akışta hiçbir sağlayıcı adı, model etiketi, port veya dosya biçimi geçmiyor
- [ ] Her yıkıcı işlem ne kaybedileceğini sayan bir onay gösteriyor
- [ ] Her ayarın bir açıklama satırı var
- [ ] Tüm ekranlar hem klavyeyle hem fareyle eksiksiz kullanılabiliyor
