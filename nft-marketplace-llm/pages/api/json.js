import { PinataSDK } from "pinata";

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_API_JWT });

/**
 * Handles JSON metadata uploads.
 * Separated from files.js because this route uses the default Next.js body parser (bodyParser: true)
 * to parse JSON bodies, whereas files.js requires bodyParser: false to handle multipart/form-data.
 */
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const metadata = req.body;
        const result = await pinata.upload.public.json(metadata);
        const url = `https://${process.env.PINATA_GATEWAY_URL}/ipfs/${result.cid}`
        return res.status(200).json({ cid: result.cid, url });
    } catch (error) {
        console.error("Pinata JSON upload error:", error);
        return res.status(500).json({ error: error.message });
    }
}
