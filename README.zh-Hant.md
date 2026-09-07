<div align="center">
  <img src="docs/assets/logo.svg" alt="Packet Pigeon" width="180" />
  <h1>Packet Pigeon</h1>
  <p><em>讓 AI agents 能透過 email 讀取與行動。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Packet Pigeon** 是跑在 Cloudflare Workers 上的收信服務：經由 Email Routing 收信，將原始 MIME 存入 R2，再透過 Queues 非同步解析。

## 運作方式

```text
寄件者 ─▶ Email Routing ─▶ Worker email() ─▶ R2 raw.eml
                                                ─▶ Queue ─▶ Worker queue() ─▶ R2 解析結果
```

- `email()` 以 `FixedLengthStream(message.rawSize)` 將 `message.raw` 直接串流寫入 R2，並在 custom metadata 記下 `emailId`（UUIDv7）、envelope from/to 與接收時間。收信熱路徑上不做解析。
- R2 的物件建立通知會轉發到 `packet-pigeon-email-parse` queue。
- `queue()` 從 R2 讀回 `.eml`，以 `postal-mime` 解析，再把 HTML 內文與附件寫回 R2。

## 儲存結構

```text
emails/
└── {emailId}/
    ├── raw.eml
    ├── body.html                  # 僅在郵件含 HTML 時寫入
    └── attachments/
        └── {ordinal}/{filename}
```

`raw.eml` 的 R2 custom metadata 帶有 `emailId`、`envelopeFrom`、`envelopeTo`、`workerReceivedAt`。附件檔名會做清理（`/ \ : * ? " < > |` 與控制字元改為 `_`）；無檔名時以 `untitled` 代替。

## 部署與設定

必要資源：R2 bucket（`packet-pigeon`）、接上 R2 事件通知的 queue（`packet-pigeon-email-parse`），以及指向此 Worker 的 Email Routing 地址（例如 `ai@agent.asyncat.app`）。

```bash
npm install
npm run deploy
```

## 開發

需求：Node.js 22+、已登入的 Wrangler CLI。

```bash
npm install
npm run dev
```
