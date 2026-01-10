const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require("express");
const cors = require("cors");
const app = express();

// --- CẤU HÌNH ---
const TARGET_URL = "https://raw.githubusercontent.com/Sushan64/NetMirror-Extension/refs/heads/builds/Netflix.json";
const PORT = process.env.PORT || 7000; // Render sẽ tự điền PORT vào đây

// 1. Định nghĩa Addon
const builder = new addonBuilder({
    id: "org.stremio.netmirror.debug",
    version: "1.0.1",
    name: "NetMirror Fix",
    description: "Debug CloudStream JSON structure",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
        {
            type: "movie",
            id: "netmirror_debug",
            name: "NetMirror Debug"
        }
    ]
});

// 2. Hàm lấy dữ liệu (Giữ nguyên logic cũ)
async function fetchAndLogData() {
    try {
        console.log("--> Đang tải dữ liệu...");
        const response = await axios.get(TARGET_URL);
        return response.data;
    } catch (error) {
        console.error("--> Lỗi tải data: " + error.message);
        return [];
    }
}

// 3. Xử lý Catalog
builder.defineCatalogHandler(async ({ type, id }) => {
    const data = await fetchAndLogData();
    let metas = [];

    if (Array.isArray(data)) {
        metas = data.map((item, index) => ({
            id: "nm_" + index,
            type: "movie",
            name: item.title || item.name || "Unknown",
            description: JSON.stringify(item)
        }));
    } else {
        // Trường hợp lỗi cấu trúc (Dự kiến sẽ rơi vào đây)
        metas = [{
            id: "debug_error",
            type: "movie",
            name: "LỖI CẤU TRÚC JSON",
            description: "Dữ liệu trả về không phải mảng phim. Hãy xem Logs.",
            poster: "https://via.placeholder.com/300x450?text=ERROR"
        }];
        // Ghi log cấu trúc thực tế để debug
        console.log("--> CẤU TRÚC THỰC TẾ:", JSON.stringify(data, null, 2).substring(0, 500));
    }

    return { metas: metas };
});

// --- PHẦN QUAN TRỌNG: FIX LỖI TIMEOUT TRÊN RENDER ---

// Sử dụng Express middleware thay vì serveHTTP mặc định
app.use(cors());

// Tạo endpoint cho Stremio giao tiếp
const addonInterface = builder.getInterface();
app.get("/", (req, res) => {
    res.redirect("/manifest.json"); // Chuyển hướng về manifest khi mở trang chủ
});

app.get("/manifest.json", (req, res) => {
    res.setHeader('Cache-Control', 'max-age=86400'); // Cache 1 ngày
    res.send(addonInterface.manifest);
});

// Xử lý các request catalog, stream, meta
app.get("/:resource/:type/:id/:extra?.json", (req, res, next) => {
    const { resource, type, id, extra } = req.params;
    const args = { resource, type, id, extra: extra ? JSON.parse(extra) : {} };
    
    addonInterface.handle(args)
        .then(result => {
            if (result.redirect) {
                res.redirect(result.redirect);
            } else {
                res.setHeader('Cache-Control', 'max-age=86400'); 
                res.send(result);
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send({ error: "Internal Error" });
        });
});

// Lắng nghe port và báo cho Render biết ngay lập tức
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--> Addon đang chạy tại port: ${PORT}`);
    console.log(`--> Link cài đặt: http://localhost:${PORT}/manifest.json (hoặc URL Render)`);
});
