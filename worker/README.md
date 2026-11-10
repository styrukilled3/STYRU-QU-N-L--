# Worker thông báo 19:00

File `push-worker.js` chạy trên Cloudflare Workers. Cấu hình trong dashboard:

- KV binding: tên `SUBS`, namespace `dong-tien-push`
- Secret: `VAPID_PRIVATE_JWK` (khoá riêng, không đưa vào repo)
- Variable: `VAPID_PUBLIC` (khoá công khai, trùng `VAPID_PUB` trong `app.js`)
- Cron trigger: `0 12 * * *` (12:00 UTC = 19:00 giờ Việt Nam)
- Tuỳ chọn: `TEST_TOKEN` để thử gửi ngay qua `/test?t=<token>`
