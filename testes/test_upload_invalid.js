import axios from "axios";
import 'dotenv/config';

async function testImgBBInvalidFile() {
    try {
        const fakeBuffer = Buffer.from("< ./pizza.jpg");
        const base64Image = fakeBuffer.toString("base64");

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
testImgBBInvalidFile();
