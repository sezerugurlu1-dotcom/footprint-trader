# Browser Smoke Test Rehberi

> Bu dosya `npm run dev` ile ayağa kaldırılmış bir instance üzerinde senin elle yapacağın test içindir.
> Mavis'in tarayıcı aracı 639px viewport sınırında takılı kaldı; sen geniş monitörde veya kendi tarayıcında doğrulayacaksın.

## 1. Dev server'ı başlat

```powershell
cd "C:\Users\SEZER\.minimax-agent\projects\footprint-trader"
npm run dev
```

Vite 5173 portunda dinlemeli. `http://localhost:5173` adresini aç.

## 2. Beklenen ilk yükleme sırası

| Saniye | Davranış | Beklenen |
|---|---|---|
| 0 | "Loading market data…" overlay | Görünür |
| 1-2 | "live" rozeti (yeşil) | WS bağlandı |
| 2-3 | İlk candle'lar chart'ta | Görünür olmalı |
| 3-5 | OrderBook seviyeleri doluyor | 10 ask + 10 bid |
| 5-10 | Backfill ilerliyor, sağ panelde "Aggregating trades" | StatsPanel sayıları artar |
| 10-30 | Tüm mumların footprint'i çizilir | POC + imbalance ◀/▶ görünür |

## 3. Manuel test listesi

- [ ] **Chart candle'ları görünüyor mu?** (geniş ekranda, >800px chart alanı)
- [ ] **F tuşu** footprint overlay'i açıp kapatıyor
- [ ] **A tuşu** imbalance marker'ları açıp kapatıyor
- [ ] **D tuşu** (Divergence) yeni eklenen delta divergence marker'ları açıp kapatıyor
- [ ] **Sembol değişimi** (BTCUSDT → ETHUSDT): chart, order book, ticker, stats 1s içinde güncelleniyor
- [ ] **Interval değişimi** (1m → 1h): mumlar yeniden çiziliyor
- [ ] **Mouse wheel zoom** chart'ta çalışıyor
- [ ] **Pencere resize**: chart otomatik yeniden boyutlanıyor
- [ ] **Hata console**: F12 → Console sekmesi → kırmızı hata yok

## 4. Eğer chart boş kalırsa

DevTools Console'u (F12) aç ve **ilk yükleme** sırasındaki hataları kontrol et.

Eğer sadece test ortamının 639px viewport'unda boş kalıyorsa:
- 1280×800 veya daha geniş bir pencerede dene
- DevTools → Device Toolbar (Ctrl+Shift+M) → Responsive → 1920×1080 seç

Eğer **gerçek geniş ekranda da boşsa**, console'da şunları kontrol et:
1. `[lightweight-charts]` ile başlayan uyarılar
2. `ResizeObserver loop completed with undelivered notifications` (cycle warning)
3. `Uncaught (in promise)` hataları

## 5. Yeni özellik: Delta Divergence

Toolbar'da **Divergence** checkbox'ı eklendi (varsayılan kapalı). Açtığında:
- Footprint üzerinde klasik order-flow sinyali: fiyat yeni extreme yapıyor ama delta teyit etmiyor
- Bearish divergence: kırmızı ▼ mumun üzerinde
- Bullish divergence: yeşil ▲ mumun altında
- Tuş kısayolu: **D**

## 6. Bilinen test ortamı sınırları

- Tarayıcı aracı 639px viewport'ta chart candle'larını göstermedi (muhtemelen lightweight-charts initial 0×0 layout problemi, normal viewport'ta olmuyor)
- Diğer tüm bileşenler (sembol, interval, footprint toggle, klavye kısayolları, order book, ticker, stats) doğrulandı
