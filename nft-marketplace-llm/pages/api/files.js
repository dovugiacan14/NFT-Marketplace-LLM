import formidable from "formidable";
import { PinataSDK } from "pinata";
import fs from "fs";

export const config = { api: { bodyParser: false } };

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_API_JWT });

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const form = new formidable.IncomingForm({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: err.message });

    let uploadedFile = files.file;
    if (Array.isArray(uploadedFile)) {
      uploadedFile = uploadedFile[0];
    }
    // Fallback if 'file' key is not used
    if (!uploadedFile) {
      const values = Object.values(files);
      if (values.length > 0) {
        uploadedFile = values[0];
        if (Array.isArray(uploadedFile)) uploadedFile = uploadedFile[0];
      }
    }

    if (!uploadedFile) return res.status(400).json({ error: "No file uploaded" });

    try {
      const buffer = fs.readFileSync(uploadedFile.filepath);
      const file = new File([buffer], uploadedFile.originalFilename, { type: uploadedFile.mimetype });

      const result = await pinata.upload.public.file(file);
      const url = `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${result.cid}`
      return res.status(200).json({ cid: result.cid, url });
    } catch (error) {
      console.error("Pinata file upload error:", error);
      return res.status(500).json({ error: error.message });
    }
  });
}
