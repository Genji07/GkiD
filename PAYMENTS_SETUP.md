# GkiD Advance — persediaan pembayaran FPX (ToyyibPay)

Status: **skeleton backend sahaja — belum live dan belum menerima wang**.

## Harga yang disediakan
- Bulanan manual: RM4.99 untuk 30 hari. Pembeli perlu membayar semula setiap bulan; ini bukan auto-debit.
- Lifetime: RM29.99 sekali bayar.

## Seni bina
GitHub Pages tidak boleh menyimpan API secret atau menjalankan callback server-side. Backend disediakan sebagai Cloudflare Worker dan memerlukan KV untuk menyimpan rujukan pesanan serta token akses.

## Penting sebelum guna
Akaun merchant, kelulusan dan kunci pembayaran mesti diurus oleh ibu bapa/penjaga dewasa. Kunci API yang pernah dikongsi dalam chat perlu dianggap terdedah dan dibatalkan/dijana semula. Jangan commit sebarang secret ke GitHub.

## Deploy (oleh penjaga dewasa)
1. Cipta Cloudflare Worker dan deploy fail `workers/toyyibpay-worker.js`.
2. Cipta KV namespace dan bind namanya sebagai `GKID_ORDERS`.
3. Tetapkan Worker secret `TOYYIBPAY_SECRET` dan `TOYYIBPAY_CATEGORY` melalui dashboard Cloudflare (jangan masukkan dalam repo).
4. Tetapkan variable `GKID_APP_URL` kepada `https://genji07.github.io/GkiD`.
5. Tetapkan `TOYYIBPAY_BASE_URL` kepada `https://dev.toyyibpay.com` untuk ujian sandbox. Tukar ke `https://toyyibpay.com` hanya selepas akaun merchant diluluskan dan ujian selesai.
6. Daftarkan callback URL Worker di tetapan/konfigurasi ToyyibPay jika diperlukan oleh akaun.
7. Uji aliran penuh dengan sandbox; semak callback, hash, jumlah transaksi dan token akses. Jangan gunakan transaksi sebenar sehingga penjaga mengesahkan semuanya.

## API Worker
- `POST /api/create-bill` JSON `{"plan":"monthly"}` atau `{"plan":"lifetime"}`
- `GET /api/payment-status?order=<orderId>`
- `GET /api/verify-access?token=<accessToken>`
- `POST /api/toyyibpay/callback` (callback server-side)

Worker memeriksa tandatangan callback MD5 mengikut dokumentasi ToyyibPay dan mengesahkan transaksi semula melalui `getBillTransactions` sebelum menyimpan status berbayar.

## Had yang belum selesai
- Worker belum dideploy kerana memerlukan akaun Cloudflare penjaga dan konfigurasi rahsia.
- Butang checkout di laman web sengaja kekal tidak aktif sehingga URL Worker dan ujian sandbox disediakan.
- Penguncian semua aktiviti Premium dan skrin pemulihan token belum dihubungkan lagi. Jangan anggap pembayaran sudah membuka akses dalam laman semasa.
- Bulanan ialah pembaharuan manual, bukan recurring billing.
- Polisi privasi, terma jualan, pemulangan wang, sokongan pelanggan dan pengurusan data perlu disediakan sebelum jualan awam.
