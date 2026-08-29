# Verba — Erişilebilirlik Spesifikasyonu

> **Bu dökümanın amacı:** Verba'nın erişilebilirlik katmanının **olması gereken** halini tanımlamak.
> Bu bir hata listesi veya düzeltme planı değildir. Mevcut kodun bu spesifikasyondan nerede ayrıldığını tespit etmek ve düzeltme planını çıkarmak okuyucunun işidir.
> Çelişki durumunda bu döküman esas alınır.
> Etkinlik katmanı spesifikasyonu (§3.3, §5) erişilebilirliği buraya devreder; bu döküman onun zorunlu devamıdır.

---

## 0. Ürün niyeti

Verba bir dil öğrenme **döngüsüdür** (bkz. `3-verba-activity-layer-spec.md` §0). Erişilebilirlik bu döngünün ayrı bir özelliği değil, döngünün **herkes için kapanabilmesinin** koşuludur. Bir öğrenci klavyeyle, ekran okuyucuyla veya yalnızca dokunmayla çalışıyorsa, döngünün her adımına o araçla ulaşabilmelidir.

### Üç yönlendirici ilke

1. **Hiçbir eylem tek bir giriş yoluna bağlı değildir.** Fareyle yapılan her şey klavyeyle de yapılabilir; klavyeyle yapılan her şeyin bir görünür karşılığı vardır.
2. **Hiçbir bilgi yalnızca renkle veya yalnızca konumla anlatılmaz.** Etiketsiz gösterge, renk kodu ve ikon tek başına anlam taşımaz.
3. **Duyurulan ile çalışan aynıdır.** Ekranda ilan edilen her kısayol gerçekten çalışır; çalışan her kısayol duyurulur. Bu, klavye haritasının (`src/lib/keys.ts`) yapısal garantisidir.

---

## 1. Klavye

### 1.1 Tek harita

Uygulamanın tek klavye haritası `src/lib/keys.ts`'tir. Her global `keydown` dinleyicisi `live(surface, key)` kapısının arkasında durur; tabloda olmayan bir tuş ateşleyemez. İpucu satırları `keysFor(surface)`'dan türetilir; tabloda olmayan bir tuş duyurulamaz.

**Değişmez kurallar:**

- Aynı yüzeyde bir tuş iki farklı eylem taşımaz. (Örnek: `Space` uygulamanın tamamında tek bir şey demektir — medya yüzeylerinde oynat/duraklat.)
- Bir yüzeyin ipucu satırı yalnızca o yüzeyde gerçekten canlı olan kısayolları gösterir. Koşullu kısayollar (`when`) yalnızca koşul sağlandığında duyurulur.
- Topbar'daki her rakam, bulunulan ekranda yazdığı yere gider; gitmediği ekranda yazmaz. (Talk'ta `1`–`3` öneri gönderir, dolayısıyla topbar orada rakam göstermez.)
- `Esc` her yüzeyde "bir seviye yukarı" anlamındadır; bir üst seviye yoksa (ör. onboarding'in ilk adımı) odaktan çıkar.

### 1.2 Odak sırası

- Odak sırası görsel düzenle izler: soldan sağa, yukarıdan aşağı. `tabindex` ile doğal sıra bozulmaz.
- Modal ve palet açıldığında odak içine taşınır; kapatıldığında açan öğeye geri döner.
- `Esc` modal ve paleti kapatır.
- Odak, ekran okuyucu kullanıcısının nerede olduğunu her zaman bilir; odaklanan öğe görünür bir çerçeveyle işaretlenir.

### 1.3 Görünür odak

- Klavyeyle gezinirken odaklanan öğe her zaman görünür bir odak halkası taşır. Odak halkası yalnızca fareyle tıklamada gizlenebilir; klavye kullanımında asla kaybolmaz.

---

## 2. Ekran okuyucu

### 2.1 Etiketler

- Her etkileşimli öğenin erişilebilir bir adı vardır. İkon tek başına anlam taşıyorsa `aria-label` taşır; yanında metin varsa metin yeterlidir.
- Görsel olarak gizli ama ekran okuyucuya açık metin (`sr-only`) yalnızca görsel etiketin anlamı metinden çıkarılamadığında kullanılır.
- Form alanları `aria-label` veya ilişkili bir `<label>` ile adlandırılır; placeholder etiket yerine geçmez.

### 2.2 Canlı bölgeler

- Asenkron durum değişiklikleri (yükleniyor, hata, "Sending…", "Checking…") ekran okuyucuya duyurulur. Bir düğmenin etiketi durumu söylüyorsa (ör. "Send" → "Sending…") bu yeterlidir; ayrı bir canlı bölge gerekmez.
- Hata mesajları kullanıcıya ulaştığında duyurulur; yalnızca renk değişimiyle bildirilmez.

### 2.3 Anlamlı yapı

- Başlıklar (`h1`–`h3`) sayfa yapısını doğru hiyerarşiyle anlatır. Bölüm başlıkları gerçek başlık öğesidir, yalnızca stillenmiş metin değil.
- Liste öğeleri gerçek `<ul>`/`<li>` içindedir; düğme dizileri liste olarak işaretlenmez.

---

## 3. Kontrast ve renk

### 3.1 Kontrast

- Normal metin ile arka plan arasındaki kontrast oranı en az **4.5:1**'dir; büyük metin (18px+ veya 14px+ kalın) için **3:1**.
- İpucu satırları, ikincil metinler ve soluk rozetler bu eşiğin altına inmez. "Soluk" görünüm, okunabilirlikten ödün vermez.

### 3.2 Renk bağımsızlığı

- Hiçbir bilgi yalnızca renkle iletilmez. Durum (doğru/yanlış, aktif/pasif, tamamlandı/bekliyor) renge ek olarak metin, ikon veya şekille de anlatılır.
- Renk körlüğü güvenli palet: kırmızı/yeşil ayrımı tek başına anlam taşımaz.

---

## 4. Hareket ve animasyon

- Animasyonlar `prefers-reduced-motion` tercihine saygı duyar; tercih açıksa hareketli geçişler kısaltılır veya kaldırılır.
- Hiçbir kritik bilgi yalnızca animasyonla iletilmez; animasyon bitince aynı bilgi statik olarak da görünür.
- Otomatik oynatma (ör. Listening) kullanıcı kontrolünde başlar; sayfa yüklenince kendiliğinden başlamaz.

---

## 5. Dokunma ve hedef boyutu

- Etkileşimli hedeflerin minimum dokunma alanı en az **44×44px**'tir (WCAG 2.5.8 hedef boyutu). Küçük düğmeler (ör. `.k` rozetleri) yalnızca bilgi gösterir, etkileşimli değilse bu kuraldan muaftır.
- Birbirine yakın hedefler arasında yeterli boşluk vardır; yanlış dokunma riski düşüktür.

---

## 6. Sessiz disabled'lar

Bir kontrol `disabled` olduğunda, neden kapalı olduğu kullanıcıya **sessizce** bırakılmaz. Üç kabul edilebilir desen vardır:

1. **Etiket durumu söyler.** Uçuş hâlindeki disabled'lar (ör. "Send" → "Sending…", "Check for updates" → "Checking…") etiketi değişiyorsa sessiz sayılmaz.
2. **Gerekçe satırı.** Kontrolün yanında neden kapalı olduğunu söyleyen kısa bir metin ("Paste something first", "Answer the question first", "Type a model name to continue").
3. **Cümle.** Düğme yerine durumu anlatan bir cümle ("ships with Verba").

**Değişmez kural:** Bir disabled kontrolün neden kapalı olduğu, ya etiketinden ya yanındaki bir gerekçeden anlaşılır. İkisi de yoksa o kontrol sessizdir ve düzeltilmesi gerekir.

---

## 7. Değişmezler (doğrulanabilir kabul kriterleri)

Aşağıdakiler her zaman doğru olmalıdır. Bunlar test edilebilir iddialardır.

**Klavye**
1. Ekranda ilan edilen kısayol sayısı === çalışan kısayol sayısı.
2. Aynı yüzeyde bir tuş iki farklı eylem taşımaz.
3. Topbar'daki her rakam, bulunulan ekranda yazdığı yere gider; gitmediği ekranda yazmaz.
4. `Esc` her yüzeyde "bir seviye yukarı" anlamındadır.
5. Fareyle yapılan her eylemin bir klavye karşılığı vardır.

**Ekran okuyucu**
6. Her etkileşimli öğenin erişilebilir bir adı vardır.
7. Form alanları placeholder ile değil, etiketle adlandırılır.
8. Asenkron durum değişiklikleri ekran okuyucuya duyurulur.

**Kontrast ve renk**
9. Normal metin kontrastı en az 4.5:1'dir.
10. Hiçbir bilgi yalnızca renkle iletilmez.

**Hareket**
11. Animasyonlar `prefers-reduced-motion`'a saygı duyar.
12. Otomatik oynatma kullanıcı kontrolünde başlar.

**Disabled'lar**
13. Hiçbir disabled kontrol sessiz değildir; nedeni etiketten veya gerekçeden anlaşılır.

---

## 8. Kapsam dışı

Bu döküman erişilebilirlik katmanını tanımlar. Aşağıdakiler ayrı spesifikasyonların konusudur ve buradaki kararlar onları bağlamaz:

- Klavye haritasının kendisi (hangi tuşun ne yaptığı) — `2-verba-ana-ekran-ve-ayarlar-spec.md` §3.1 ve `src/lib/keys.ts`
- İçerik üretimi, model seçimi, üretim maliyeti
- Kimlik, senkronizasyon, çoklu cihaz
- Fiyatlandırma, kota
