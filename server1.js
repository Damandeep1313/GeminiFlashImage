import express from "express";
import "dotenv/config";
import morgan from "morgan";
import { v2 as cloudinary } from "cloudinary";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Gemini client
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});


/**
 * Convert Google Drive "view" links to direct download links
 */
function normalizeDriveUrl(url) {
  const match = url.match(/\/file\/d\/([^/]+)\//);
  if (match) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  return url; // return unchanged if it's already direct
}




/**
 * Upload buffer to Cloudinary
 */
async function uploadToCloudinary(buffer, filename) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ public_id: filename, resource_type: "image" }, (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      })
      .end(buffer);
  });
}

/**
 * POST /generate-image
 */
app.post("/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;
    console.log("👉 Prompt:", prompt);
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: prompt,
    });

    const part = result.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data
    );
    if (!part) return res.status(500).json({ error: "No image returned" });

    const buffer = Buffer.from(part.inlineData.data, "base64");
    const filename = `gen_${Date.now()}`;

    console.log("⚡ Uploading to Cloudinary...");
    const url = await uploadToCloudinary(buffer, filename);

    console.log("✅ Image available at:", url);
    res.json({ message: "Image generated", url });
  } catch (err) {
    console.error("🔥 Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /edit-image
 * JSON: { prompt, image_url }
 */
app.post("/edit-image", async (req, res) => {
  try {
    let { prompt, image_url } = req.body;
    console.log("👉 Raw Edit request:", { prompt, image_url });

    if (!prompt || !image_url) {
      return res.status(400).json({ error: "Missing prompt or image_url" });
    }

    // Normalize Google Drive URLs
    image_url = normalizeDriveUrl(image_url);
    console.log("🔗 Normalized image_url:", image_url);

    // Fetch image
    const response = await fetch(image_url);
    if (!response.ok) throw new Error("Failed to fetch image from URL");

    const mimeType = response.headers.get("content-type");
    if (!mimeType.startsWith("image/")) {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");

    const contents = [
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ];

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents,
    });

    const part = result.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data
    );
    if (!part) return res.status(500).json({ error: "No edited image returned" });

    const editedBuffer = Buffer.from(part.inlineData.data, "base64");
    const filename = `edit_${Date.now()}`;

    console.log("⚡ Uploading edited image to Cloudinary...");
    const url = await uploadToCloudinary(editedBuffer, filename);

    console.log("✅ Edited image available at:", url);
    res.json({ message: "Image edited", url });
  } catch (err) {
    console.error("🔥 Error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
