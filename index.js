const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// URL bạn cung cấp
const TARGET_URL = "https://raw.githubusercontent.com/Sushan64/NetMirror-Extension/refs/heads/builds/Netflix.json";

const builder = new addonBuilder({
    id: "org.stremio.netmirror.debug",
    version: "1.0.0",
    name: "NetMirror Debugger",
    description: "Testing CloudStream JSON structure",
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

// Hàm lấy dữ liệu và GHI LOG (Quan trọng để test)
async function fetchAndLogData() {
    try {
        console.log("--> BẮT ĐẦU TẢI DỮ LIỆU TỪ: " + TARGET_URL);
        const response = await axios.get(TARGET_URL);
        const data = response.data;

        console.log("--> TRẠNG THÁI: Tải thành công!");
        console.log("--> KIỂU DỮ LIỆU: " + typeof data);
        
        // In ra 500 ký tự đầu tiên của dữ liệu để xem cấu trúc
        console.log("--> NỘI DUNG DATA (PREVIEW):");
        console.log(JSON.stringify(data, null, 2).substring(0, 1000)); 

        return data;
    } catch (error) {
        console.error("--> LỖI TẢI DATA: " + error.message);
        return [];
    }
}

builder.defineCatalogHandler(async ({ type, id }) => {
    const data = await fetchAndLogData();
    let metas = [];

    // [TEST CASE 1]: Kiểm tra xem Data có phải là mảng phim không?
    if (Array.isArray(data)) {
        console.log("--> KẾT QUẢ TEST: Data là một Mảng (Array). Đang thử map dữ liệu...");
        metas = data.map((item, index) => ({
            id: "nm_" + index,
            type: "movie",
            name: item.title || item.name || "Unknown Name",
            description: "Dữ liệu tìm thấy: " + JSON.stringify(item)
        }));
    } else {
        // [TEST CASE 2]: Data không phải mảng (Khả năng cao rơi vào đây)
        console.log("--> KẾT QUẢ TEST: Data KHÔNG phải mảng phim. Nó là Object cấu hình.");
        
        // Tạo một item giả để báo lỗi lên màn hình Stremio
        metas = [{
            id: "debug_error",
            type: "movie",
            name: "LỖI: Cấu trúc không khớp",
            description: "Dữ liệu tải về không phải danh sách phim. Hãy xem Logs trên Render để biết chi tiết.",
            poster: "https://via.placeholder.com/300x450?text=DEBUG+ERROR"
        }];
    }

    return { metas: metas };
});

// Render cung cấp cổng qua biến môi trường process.env.PORT
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`--> Addon đang chạy trên port: ${port}`);
