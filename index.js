const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Kích hoạt chế độ tàng hình chống Cloudflare Bot Detection
chromium.use(stealth);

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/extract', async (req, res) => {
    const vidUrl = req.query.url;
    if (!vidUrl) return res.status(400).json({ error: "Thiếu tham số url" });

    let browser;
    try {
        // Mở trình duyệt ẩn danh, tắt sandbox để chạy mượt trên Linux server
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let foundM3u8 = null;

        // Giăng lưới bắt link m3u8 ở tab Network
        page.on('request', request => {
            const reqUrl = request.url();
            if (reqUrl.includes('.m3u8') || reqUrl.includes('bTN1OA==')) {
                foundM3u8 = reqUrl;
            }
        });

        // Truy cập trang Vidfast và đợi tối đa 15 giây
        await page.goto(vidUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        
        // Đợi thêm 3 giây để đảm bảo JS của Vidfast giải mã xong
        if (!foundM3u8) {
            await page.waitForTimeout(3000); 
        }

        if (foundM3u8) {
            // Sửa lỗi JSON escape gạch chéo
            const cleanUrl = foundM3u8.replace(/\\\//g, '/').replace(/%3A/gi, ':').replace(/%2F/gi, '/');
            res.json({ streamUrl: cleanUrl });
        } else {
            res.status(404).json({ error: "Không bóc được link m3u8" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Extractor tàng hình đang chạy ở port ${PORT}`));
