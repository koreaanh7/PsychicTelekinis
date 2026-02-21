const express = require('express');
const axios = require('axios');
const CryptoJS = require('crypto-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Giả dạng trình duyệt thật để không bị 403 Forbidden
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://vidsrc.me/',
    'Accept-Language': 'en-US,en;q=0.9'
};

app.get('/extract', async (req, res) => {
    const imdbId = req.query.id; 
    const season = req.query.s || '';
    const episode = req.query.e || '';

    if (!imdbId) return res.status(400).json({ error: "Thiếu IMDB ID" });

    try {
        console.log(`Đang bẻ khóa: ${imdbId} - S${season}E${episode}`);

        // --- BƯỚC 1: VÀO CỬA CHÍNH VIDSRC (Đã sửa URL chuẩn để không bị 404) ---
        const vidsrcUrl = season && episode 
            ? `https://vidsrc.me/embed/tv/${imdbId}/${season}/${episode}`
            : `https://vidsrc.me/embed/movie/${imdbId}`;

        const pageRes = await axios.get(vidsrcUrl, { headers: HEADERS });
        
        // --- BƯỚC 2: TÌM CỬA TRUNG CHUYỂN (Iframe) ---
        // Vidsrc sẽ giấu một cái iframe trỏ tới máy chủ phát video
        const iframeMatch = pageRes.data.match(/id="player_iframe"\s+src="([^"]+)"/i) 
                         || pageRes.data.match(/iframe\s+src="([^"]+vidsrc[^"]+)"/i);
                         
        if (!iframeMatch) return res.status(404).json({ error: "Lớp 1: Không tìm thấy Iframe nhúng" });

        let rcpUrl = iframeMatch[1];
        if (rcpUrl.startsWith('//')) rcpUrl = 'https:' + rcpUrl;

        // --- BƯỚC 3: VÀO MÁY CHỦ MEGACLOUD VÀ LẤY CỤC MẬT MÃ ---
        const rcpRes = await axios.get(rcpUrl, { headers: { ...HEADERS, 'Referer': vidsrcUrl } });
        
        // Nó có thể chứa thẳng data-hash, hoặc chứa link sang Megacloud
        let encryptedData = null;
        const hashMatch = rcpRes.data.match(/data-hash="([^"]+)"/i) || rcpRes.data.match(/id="hidden-data"\s+value="([^"]+)"/i);

        if (hashMatch) {
            encryptedData = hashMatch[1];
        } else {
            // Tìm link redirect sang megacloud/rabbitstream
            const megaMatch = rcpRes.data.match(/src="([^"]+(megacloud|rabbitstream)[^"]+)"/i);
            if (megaMatch) {
                let megaUrl = megaMatch[1];
                if (megaUrl.startsWith('//')) megaUrl = 'https:' + megaUrl;
                
                const megaRes = await axios.get(megaUrl, { headers: { ...HEADERS, 'Referer': rcpUrl } });
                const finalHash = megaRes.data.match(/data-hash="([^"]+)"/i) || megaRes.data.match(/id="hidden-data"\s+value="([^"]+)"/i);
                if (finalHash) encryptedData = finalHash[1];
            }
        }

        if (!encryptedData) return res.status(404).json({ error: "Lớp 3: Không bóc được cục mã hóa AES" });

        // --- BƯỚC 4: LẤY CHÌA KHÓA TỪ GITHUB ---
        const keysRes = await axios.get('https://raw.githubusercontent.com/theusaf/rabbitstream/master/keys.json');
        const keys = keysRes.data;
        // Bọn nó thường dùng chung 1 khóa cho toàn hệ thống
        const secretKey = keys.find(k => k.name === 'megacloud')?.key || keys[0].key;

        // --- BƯỚC 5: MỞ KHÓA BẰNG CRYPTO-JS ---
        const bytes = CryptoJS.AES.decrypt(encryptedData, secretKey);
        const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedText) return res.status(500).json({ error: "Mở khóa thất bại, khóa AES có thể đã bị đổi" });

        const jsonData = JSON.parse(decryptedText);
        
        // Lấy link video nét nhất
        const streamUrl = jsonData.sources && jsonData.sources[0] ? jsonData.sources[0].file : null;

        if (streamUrl) {
            console.log("Thành công! Trả link về cho Stremio.");
            res.json({ streamUrl: streamUrl });
        } else {
            res.status(404).json({ error: "Giải mã xong nhưng file rỗng" });
        }

    } catch (e) {
        // Log lỗi chi tiết nếu axios lại vấp phải 404
        const errorMsg = e.response ? `HTTP ${e.response.status}` : e.message;
        console.error("Lỗi Sever:", errorMsg);
        res.status(500).json({ error: errorMsg });
    }
});

app.listen(PORT, () => console.log(`🚀 API Node.js Extractor đang chạy ở port ${PORT}`));
