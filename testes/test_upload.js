import axios from "axios";
import 'dotenv/config';

async function testImgBB() {
    try {
        const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 dot

        const url = `https://api.imgbb.com/1/upload?key=${process.env.IMG_BB_KEY}`;

        const formData = new URLSearchParams();
        formData.append("image", base64Image);

        const response = await axios.post(url, formData.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        console.log("SUCCESS:", response.data.data.url);
    } catch (error) {
        console.error("ERROR:");
        console.error(error.response?.data || error.message);
    }
}
testImgBB();
