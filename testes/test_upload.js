import axios from "axios";

async function testImgBB() {
    try {
        const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 dot

        const url = `https://api.imgbb.com/1/upload?key=d87221a48f813c45572c79d91351678d`;

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
