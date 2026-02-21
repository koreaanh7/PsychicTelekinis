const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/extract', async (req, res) => {
    const vidUrl = req.query.url;
    if (!vidUrl) return res.status(400).json({ error: "Missing URL" });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--autoplay-policy=no-user-gesture-required', // CỰC KỲ QUAN TRỌNG: Ép Chrome cho phép video tự động chạy
                '--disable-web-security'
            ]
        });

        const page = await browser.newPage();
        
        // Đặt User-Agent giống người thật nhất có thể
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let foundM3u8 = null;

        // Giăng lưới bắt link m3u8
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('bTN1OA==')) {
                foundM3u8 = url;
            }
            request.continue();
        });

        // Chỉ cần đợi DOM load xong, không cần đợi networkidle (vì web phim hay có quảng cáo load liên tục)
        await page.goto(vidUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Vòng lặp chờ tối đa 10 giây để JavaScript của trang web giải mã xong link
        let waitTime = 0;
        while (!foundM3u8 && waitTime < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            waitTime++;
        }

        if (foundM3u8) {
            res.json({ streamUrl: foundM3u8.replace(/\\\//g, '/') });
        } else {
            // Nếu thất bại, lấy Tiêu đề trang web để xem Bot đang kẹt ở màn hình nào
            const pageTitle = await page.title();
            res.status(404).json({ 
                error: "Không tìm thấy m3u8", 
                title: pageTitle,
                message: "Bot có thể bị Cloudflare chặn hoặc video không tự động play."
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
