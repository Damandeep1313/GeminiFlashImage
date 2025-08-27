import express from "express";
import "dotenv/config";
import multer from "multer";
import fs from "node:fs";
import morgan from "morgan";
import { v2 as cloudinary } from "cloudinary";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));
const upload = multer({ dest: "/tmp" });

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
 * Multipart: prompt, file
 */
app.post("/edit-image", upload.single("file"), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    const filePath = req.file?.path;

    console.log("👉 Edit request:", { prompt, file: filePath });
    if (!prompt || !filePath) {
      return res.status(400).json({ error: "Missing prompt or file" });
    }

    const base64 = fs.readFileSync(filePath).toString("base64");

    const contents = [
      { text: prompt },
      { inlineData: { mimeType: req.file.mimetype, data: base64 } },
    ];

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents,
    });

    const part = result.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data
    );
    if (!part) return res.status(500).json({ error: "No edited image returned" });

    const buffer = Buffer.from(part.inlineData.data, "base64");
    const filename = `edit_${Date.now()}`;

    console.log("⚡ Uploading edited image to Cloudinary...");
    const url = await uploadToCloudinary(buffer, filename);

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
