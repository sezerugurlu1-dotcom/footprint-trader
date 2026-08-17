# Önemli Not: Test Ortamı Sorunu

Mavis'in çalıştığı Windows ortamından **Binance USDT-M Futures API'si (fapi.binance.com) 418 "I'm a teapot"** dönüyor. Bu IP seviyesinde bir engel; kodu etkilemiyor.

**Doğrulama:**
```powershell
PS> Invoke-WebRequest "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=10"
→ 418 I'm a teapot

PS> Invoke-WebRequest "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=10"
→ 200 OK (spot API çalışıyor)
```

Yani sadece **USDT-M Futures** endpoint'leri engellenmiş. Kod tarafında bir sorun yok.

---

## Bu turda düzeltilen gerçek bug'lar (3 adet)

### Bug #1 — useLiveTrades sonsuz reconnect döngüsü (KRİTİK)
**Önceki kod:** `useEffect(..., [symbol, builder, onTrade])` ve `onTrade = scheduleRender` her render'da yeni fonksiyon.
**Sonuç:** Effect her parent render'da tetikleniyor, WS bağlantısı her seferinde `close()` + yeni `connect()` ile yeniden kuruluyordu. Socket ilk frame'den önce kapanıyor, reconnect 2s sonra → cycle. **Hiç trade gelmiyordu → "price not live" senin yaşadığın sorunun kök nedeni.**

**Fix:** `onTradeRef.current = onTrade` ile ref güncellemesi, effect dep'ten `onTrade` çıkarıldı. WS bağlantısı artık `(symbol, builder)` çiftine sabit.

### Bug #2 — useBackfill stale closure
**Önceki kod:** `useBackfill()` her render'da yeni `BackfillHandle` döndürüyordu. Orchestrator effect'in dep array'inde `backfillHandle` yoktu, ilk render'daki `start` closure'ı eski `cancelledRef`'i yakalıyordu.
**Sonuç:** Sembol değiştiğinde backfill ya hiç başlamıyor ya da erken iptal oluyordu.

**Fix:** `useBackfill` artık `useCallback` ile stable `{ start, cancel }` döndürüyor, `cancelledRef` ref olarak kalıyor.

### Bug #3 — connected=true sinyali yanıltıcı
**Önceki kod:** `setConnected(true)` `stream.connect()`'ten hemen sonra çağrılıyordu.
**Sonuç:** Socket gerçek bağlanmasa bile `live` rozeti gösteriliyordu.

**Fix:** `setConnected(true)` artık ilk gerçek mesaj geldiğinde çağrılıyor.

### Bonus: Backfill tek-sefer tetikleme
**Önceki kod:** `useEffect(..., [symbol, interval, builder, candles.length === 0])` boolean dep yüzünden her candles update'inde effect yeniden çalışıyordu.
**Fix:** `candleSeedRef` ile sadece **boştan doluya geçişte** bir kez çalışıyor. Sonraki kline push'ları backfill'i yeniden başlatmıyor.

---

## Senin yapman gereken

1. **Senin makinende** `npm run dev` çalıştır (F12 → Console aç)
2. **İlk yükleme**: BTCUSDT 15m seçili, ~1-2 saniyede "live" rozetini görmelisin
3. **Price live**: 1-2 saniye içinde TickerInfo'da fiyat güncellenmeli
4. **Backfill**: Sağ panelde "Backfilling footprint X/100…" rozeti görünmeli, 15-30 saniyede tamamlanmalı (BTCUSDT 15m'de 100 mum × 4 paralel REST = hızlı)
5. **Interval değişimi**: 1m'ye basınca 1-2 saniye içinde tüm veri yenilenmeli (candles gelmeli, sonra backfill)
6. **Timeframe değişimi**: Çalışmıyorsa console'da hata olabilir; "Error: ..." mesajı görünmeli

Eğer hâlâ sorun varsa console log'larını paylaş, root cause'a bakarım.
