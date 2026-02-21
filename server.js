const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/extract', async (req, res) => {
    const vidUrl = req.query.url;
    if (!vidUrl) return res.status(400).send("Missing URL parameter");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-web-security',
                '--window-size=1280,720' // Đặt kích thước màn hình chuẩn để click
            ]
        });

        const page = await browser.newPage();
        
        // Đặt Viewport và User-Agent
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let foundM3u8 = null;

        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('bTN1OA==')) {
                foundM3u8 = url;
            }
            request.continue();
        });

        // Đi tới trang web
        await page.goto(vidUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        // Mô phỏng người dùng: Đợi 2 giây rồi Click chuột vào giữa màn hình để kích hoạt Video Player
        await page.waitForTimeout(2000);
        try {
            await page.mouse.click(640, 360); // Tọa độ giữa màn hình 1280x720
            await page.waitForTimeout(1000);
            await page.mouse.click(640, 360); // Click đúp phòng hờ có quảng cáo popup che mất
        } catch (e) {
            console.log("Không click được:", e.message);
        }

        // Chờ thêm tối đa 10 giây để xem link m3u8 có văng ra không
        let waitTime = 0;
        while (!foundM3u8 && waitTime < 10) {
            await page.waitForTimeout(1000);
            waitTime++;
        }

        if (foundM3u8) {
            res.json({ streamUrl: foundM3u8.replace(/\\\//g, '/') });
        } else {
            // TUYỆT CHIÊU CUỐI: Chụp ảnh màn hình để xem bot đang bị kẹt ở đâu
            const base64Screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
            
            // Trả về một trang HTML hiển thị luôn bức ảnh
            const htmlResponse = `
                <html>
                    <body style="background-color: #222; color: white; text-align: center; font-family: sans-serif;">
                        <h2>Bot không tìm thấy link m3u8!</h2>
                        <p>Dưới đây là hình ảnh thực tế mà Bot đang nhìn thấy (Screenshot):</p>
                        <img src="data:image/png;base64,${base64Screenshot}" style="border: 2px solid red; max-width: 90%; box-shadow: 0 0 20px rgba(0,0,0,0.5);" />
                    </body>
                </html>
            `;
            res.status(404).send(htmlResponse);
        }
    } catch (e) {
        res.status(500).send(`Lỗi Server: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Server đang chạy ở port ${PORT}`));
