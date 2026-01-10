const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const TorrentSearchApi = require("torrent-search-api");
const axios = require("axios");

// --- CẤU HÌNH ---
// Điền tài khoản PikPak của bạn vào đây
const PIKPAK_USER = process.env.PIKPAK_USER || "EMAIL_CUA_BAN@GMAIL.COM"; 
const PIKPAK_PASS = process.env.PIKPAK_PASS || "MAT_KHAU_CUA_BAN";

const builder = new addonBuilder({
    id: "org.community.pikpakstream",
    version: "1.0.1",
    name: "PikPak Fast Stream",
    description: "Auto-download torrents to PikPak and stream instantly.",
    resources: ["stream"],
    types: ["movie"], // Tạm thời hỗ trợ Movie cho đơn giản
    catalogs: []
});

// Kích hoạt nguồn tìm kiếm Torrent (1337x và YTS thường ổn định nhất)
TorrentSearchApi.enableProvider("1337x");
TorrentSearchApi.enableProvider("Yts");

// --- PIKPAK API HELPER ---
let cachedToken = null;

async function loginPikPak() {
    try {
        const response = await axios.post("https://user.mypikpak.com/v1/auth/signin", {
            username: PIKPAK_USER,
            password: PIKPAK_PASS
        }, {
            headers: { "Content-Type": "application/json" }
        });
        cachedToken = response.data.access_token;
        console.log("PikPak Login thành công!");
        return cachedToken;
    } catch (e) {
        console.error("Lỗi Login PikPak:", e.response ? e.response.data : e.message);
        return null;
    }
}

async function addMagnetToPikPak(magnet) {
    if (!cachedToken) await loginPikPak();
    
    try {
        // Gửi Magnet lên PikPak
        const payload = {
            kind: "drive#file",
            folder_type: "DOWNLOAD",
            upload_type: "UPLOAD_TYPE_URL",
            url: { url: magnet }
        };
        
        const res = await axios.post("https://api-drive.mypikpak.com/drive/v1/files", payload, {
            headers: { "Authorization": `Bearer ${cachedToken}` }
        });
        
        return res.data.task.id; // Trả về Task ID để theo dõi
    } catch (e) {
        // Nếu lỗi 401 (Unauthorized), thử login lại 1 lần
        if (e.response && e.response.status === 401) {
            console.log("Token hết hạn, đang login lại...");
            await loginPikPak();
            return addMagnetToPikPak(magnet); // Thử lại
        }
        console.error("Lỗi Add Magnet:", e.message);
        return null;
    }
}

async function waitForFile(taskId) {
    // Vòng lặp kiểm tra xem file đã tải xong chưa (Timeout 30s)
    let attempts = 0;
    while (attempts < 10) { // Thử 10 lần, mỗi lần 3 giây = 30s
        await new Promise(r => setTimeout(r, 3000));
        
        try {
            const res = await axios.get(`https://api-drive.mypikpak.com/drive/v1/tasks/${taskId}`, {
                headers: { "Authorization": `Bearer ${cachedToken}` }
            });
            
            const task = res.data;
            if (task.phase === "PHASE_COMPLETE") {
                // File đã tải xong, lấy File ID
                return task.file_id;
            }
        } catch (e) {
            console.error("Lỗi Check Task:", e.message);
        }
        attempts++;
    }
    return null;
}

async function getStreamLink(fileId) {
    try {
        const res = await axios.get(`https://api-drive.mypikpak.com/drive/v1/files/${fileId}`, {
            headers: { "Authorization": `Bearer ${cachedToken}` }
        });
        return res.data.web_content_link; // Link xem trực tiếp
    } catch (e) {
        console.error("Lỗi Get Link:", e.message);
        return null;
    }
}

// --- XỬ LÝ CHÍNH CỦA STREMIO ---

builder.defineStreamHandler(async ({ type, id }) => {
    // 1. Chặn request không phải movie (giữ logic đơn giản cho bản đầu tiên)
    if (type !== "movie") return { streams: [] };

    console.log("Đang tìm phim cho ID:", id);

    // 2. Tìm kiếm Torrent
    // ID Stremio dạng "tt1234567". TorrentSearchApi cần từ khóa.
    // Hack nhỏ: Search chính mã "tt..." trên 1337x thường ra kết quả chính xác hơn tên.
    const torrents = await TorrentSearchApi.search(id, "Video", 1); 

    if (!torrents || torrents.length === 0) {
        console.log("Không tìm thấy torrent nào.");
        return { streams: [] };
    }

    const magnet = torrents[0].magnet;
    console.log(`Tìm thấy magnet: ${torrents[0].title}`);

    // 3. Quy trình PikPak
    const taskId = await addMagnetToPikPak(magnet);
    if (!taskId) return { streams: [] };

    console.log("Đã gửi sang PikPak, đang chờ tải...");
    const fileId = await waitForFile(taskId);
    
    if (fileId) {
        const streamUrl = await getStreamLink(fileId);
        if (streamUrl) {
            console.log("Thành công! Link:", streamUrl);
            return {
                streams: [
                    {
                        title: `🚀 PikPak Stream\n${torrents[0].title}\nSize: ${torrents[0].size}`,
                        url: streamUrl
                    }
                ]
            };
        }
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
