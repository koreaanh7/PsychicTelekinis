const express = require('express');
const axios = require('axios');
const CryptoJS = require('crypto-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Tiện ích: Fake User-Agent để API gốc không chặn
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
};

app.get('/extract', async (req, res) => {
    // Nhận trực tiếp ID từ Cloudflare Worker truyền sang thay vì cả cái link dài
    const imdbId = req.query.id; 
    const season = req.query.s || '';
    const episode = req.query.e || '';

    if (!imdbId) return res.status(400).json({ error: "Thiếu IMDB ID" });

    try {
        console.log(`Đang tìm link cho: ${imdbId} - S${season}E${episode}`);

        // --- BƯỚC 1: LẤY BẢN ĐỒ MÃ HÓA TỪ MÁY CHỦ GỐC ---
        // Ghi chú: Ở đây mình ví dụ dùng API cộng đồng vidsrc.me (chung lõi với vidfast)
        const apiUrl = season && episode 
            ? `https://vidsrc.me/embed/tv?imdb=${imdbId}&season=${season}&episode=${episode}`
            : `https://vidsrc.me/embed/movie?imdb=${imdbId}`;

        const response = await axios.get(apiUrl, { headers: HEADERS });
        const html = response.data;

        // Tìm đoạn hash (mã hóa) ẩn trong HTML
        const hashMatch = html.match(/data-hash="([^"]+)"/i) || html.match(/id="hidden-data"\s+value="([^"]+)"/i);
        
        if (!hashMatch) {
            // Rất nhiều site giấu thẳng link m3u8 đã mã hóa Base64 như bạn thấy lúc nãy
            // Thử bắt m3u8 base64 ngay trong HTML gốc
            const base64M3u8 = html.match(/(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g);
            let foundDirect = null;
            if (base64M3u8) {
                for (let str of base64M3u8) {
                    try {
                        const decoded = Buffer.from(str, 'base64').toString('utf8');
                        if (decoded.includes('.m3u8')) foundDirect = decoded;
                    } catch (e) {}
                }
            }
            if (foundDirect) return res.json({ streamUrl: foundDirect });

            return res.status(404).json({ error: "Không tìm thấy dữ liệu mã hóa trên máy chủ gốc." });
        }

        const encryptedData = hashMatch[1];

        // --- BƯỚC 2: TỰ ĐỘNG CẬP NHẬT CHÌA KHÓA (KEYS) TỪ GITHUB ---
        // Thuật toán của bọn này đổi chìa khóa liên tục, cộng đồng lưu key cập nhật ở đây:
        const keyUrl = 'https://raw.githubusercontent.com/theusaf/rabbitstream/master/keys.json';
        const keysRes = await axios.get(keyUrl);
        const keys = keysRes.data;

        // --- BƯỚC 3: GIẢI MÃ BẰNG CRYPTO-JS ---
        // Giống hệt code this.subtle.decrypt mà bạn tìm thấy, nhưng chạy trên server!
        let decryptedStream = "";
        try {
            // Lọc ra key bí mật
            const secretKey = keys.filter(k => k.name === 'megacloud')[0]?.key || keys[0].key;
            
            // Dùng AES giải mã
            const bytes = CryptoJS.AES.decrypt(encryptedData, secretKey);
            const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            
            const jsonData = JSON.parse(decryptedText);
            
            // Lấy link m3u8 có độ phân giải cao nhất
            decryptedStream = jsonData.sources[0].file; 
        } catch (decryptError) {
            console.log("Giải mã thất bại, có thể server đổi key:", decryptError.message);
            return res.status(500).json({ error: "Lỗi giải mã AES" });
        }

        if (decryptedStream) {
            res.json({ streamUrl: decryptedStream });
        } else {
            res.status(404).json({ error: "Giải mã xong nhưng không thấy link m3u8" });
        }

    } catch (e) {
        console.error("Lỗi:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`🚀 API Giải mã siêu tốc đang chạy ở port ${PORT}`));
