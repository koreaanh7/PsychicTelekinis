// pikpak.js
const axios = require('axios');
const crypto = require('crypto');

class PikPakClient {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.deviceId = crypto.randomUUID(); // Tạo ID thiết bị giả
        this.accessToken = null;
        this.baseUrl = "https://api-drive.mypikpak.com/drive/v1";
        this.authUrl = "https://user.mypikpak.com/v1/auth/signin";
    }

    async login() {
        try {
            const payload = {
                client_id: "YNxT9w7GMdWvEOKa", // Client ID mặc định của PikPak Web
                username: this.username,
                password: this.password,
                device_id: this.deviceId
            };

            const response = await axios.post(this.authUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token;
            console.log("✅ PikPak Login Success!");
        } catch (error) {
            console.error("❌ PikPak Login Failed:", error.response?.data || error.message);
            throw error;
        }
    }

    // Hàm thêm Magnet và chờ file tải về
    async addMagnetAndGetLink(magnetLink) {
        if (!this.accessToken) await this.login();

        try {
            // 1. Gửi lệnh upload magnet
            const uploadPayload = {
                kind: "drive#file",
                folder_type: "DOWNLOAD",
                upload_type: "UPLOAD_TYPE_URL",
                url: { url: magnetLink }
            };

            const uploadRes = await axios.post(`${this.baseUrl}/files`, uploadPayload, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });

            const task = uploadRes.data.task;
            const fileId = uploadRes.data.file?.id; // Đôi khi nó tạo file ngay lập tức

            console.log(`🚀 Magnet added. Task ID: ${task?.id}, File ID: ${fileId}`);

            // 2. Chờ PikPak tải file về (Polling)
            // Lặp lại mỗi 2 giây để kiểm tra trạng thái
            let finalFileId = fileId;
            let attempts = 0;
            const maxAttempts = 15; // Chờ tối đa 30s (15 * 2s)

            while (attempts < maxAttempts) {
                if (finalFileId) break; // Nếu đã có FileID thì thoát vòng lặp

                // Nếu chưa có FileID (đang ở dạng Task), kiểm tra Task
                if (task?.id) {
                    const taskRes = await axios.get(`${this.baseUrl}/tasks/${task.id}`, {
                         headers: { 'Authorization': `Bearer ${this.accessToken}` }
                    });
                    
                    const taskStatus = taskRes.data;
                    if (taskStatus.phase === "PHASE_TYPE_COMPLETE") {
                        finalFileId = taskStatus.file_id;
                        break;
                    }
                }
                
                attempts++;
                await new Promise(r => setTimeout(r, 2000)); // Sleep 2s
            }

            if (!finalFileId) {
                console.log("⚠️ Timeout waiting for PikPak download.");
                return null;
            }

            // 3. Lấy link stream trực tiếp (Direct Link)
            const fileRes = await axios.get(`${this.baseUrl}/files/${finalFileId}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });

            // PikPak trả về web_content_link (link tải)
            const videoUrl = fileRes.data.web_content_link;
            const fileName = fileRes.data.name;
            const fileSize = fileRes.data.size;

            return { url: videoUrl, name: fileName, size: fileSize };

        } catch (error) {
            console.error("❌ Error processing magnet:", error.response?.data || error.message);
            // Nếu lỗi token hết hạn (401), nên login lại (logic đơn giản bỏ qua ở đây)
            return null;
        }
    }
}

module.exports = PikPakClient;
