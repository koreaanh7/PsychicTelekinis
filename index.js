const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// URL nguồn từ CloudStream mà bạn cung cấp
const SOURCE_URL = "https://raw.githubusercontent.com/Sushan64/NetMirror-Extension/refs/heads/builds/Netflix.json";

// 1. Định nghĩa Manifest (Thông tin Addon)
const builder = new addonBuilder({
    id: "org.stremio.netmirror",
    version: "1.0.0",
    name: "NetMirror for Stremio",
    description: "Addon ported from CloudStream NetMirror extension",
    resources: ["catalog", "stream", "meta"],
    types: ["movie", "series"],
    catalogs: [
        {
            type: "movie",
            id: "netmirror_movies",
            name: "NetMirror Movies"
        },
        {
            type: "series",
            id: "netmirror_series",
            name: "NetMirror Series"
        }
    ],
    idPrefixes: ["nm_"] // Tiền tố ID riêng để tránh xung đột với IMDb
});

// Cache dữ liệu tạm thời (để không phải fetch Github liên tục)
let cachedData = null;

async function getData() {
    if (cachedData) return cachedData;
    try {
        console.log("Đang tải dữ liệu từ Github...");
        const response = await axios.get(SOURCE_URL);
        // LƯU Ý QUAN TRỌNG:
        // Bạn cần kiểm tra cấu trúc thực tế của file JSON này.
        // Code dưới đây giả định cấu trúc mảng đơn giản. 
        // Nếu file JSON là cấu hình plugin, bạn phải viết logic bóc tách sâu hơn.
        cachedData = response.data; 
        return cachedData;
    } catch (error) {
        console.error("Lỗi tải dữ liệu:", error.message);
        return [];
    }
}

// 2. Xử lý Catalog (Hiển thị danh sách phim)
builder.defineCatalogHandler(async ({ type, id }) => {
    const data = await getData();
    
    // Logic mapping: Chuyển dữ liệu nguồn -> Stremio Meta Object
    // Đây là phần bạn cần tùy chỉnh dựa trên cấu trúc thật của file JSON
    let metas = [];

    // Ví dụ giả định: data là một mảng các phim
    // Bạn cần log(data) để xem cấu trúc thật và sửa map() cho đúng
    if (Array.isArray(data)) {
        metas = data
            .filter(item => item.type === type || true) // Lọc theo loại nếu có
            .map(item => ({
                id: `nm_${item.id || Math.random().toString(36).substr(2, 9)}`,
                type: type,
                name: item.title || item.name || "Unknown Title",
                poster: item.poster || "",
                description: item.description || "No description provided."
            }));
    }

    return { metas: metas };
});

// 3. Xử lý Meta (Chi tiết phim khi bấm vào)
builder.defineMetaHandler(async ({ type, id }) => {
    // Trong thực tế, bạn sẽ fetch chi tiết từ ID.
    // Ở đây ta dùng lại data catalog cho đơn giản
    const data = await getData();
    const realId = id.replace("nm_", "");
    
    // Tìm phim trong data
    const item = data.find(i => i.id == realId || i.title == realId); // Logic tìm kiếm

    if (!item) return { meta: null };

    return {
        meta: {
            id: id,
            type: type,
            name: item.title || "Unknown",
            poster: item.poster,
            background: item.background,
            description: item.description,
            releaseInfo: item.year,
        }
    };
});

// 4. Xử lý Stream (Trả về link phim)
builder.defineStreamHandler(async ({ type, id }) => {
    const data = await getData();
    const realId = id.replace("nm_", "");
    const item = data.find(i => i.id == realId);

    if (!item || !item.source) {
        return { streams: [] };
    }

    // Trả về link trực tiếp (Direct URL) hoặc HLS/M3U8
    return {
        streams: [
            {
                title: "NetMirror Source",
                url: item.source // URL video (mp4, m3u8)
            }
        ]
    };
});

// Khởi chạy server
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("Addon đang chạy tại http://localhost:7000");
