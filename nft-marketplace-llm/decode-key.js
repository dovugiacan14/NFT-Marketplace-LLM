import fs from "fs";
import { Wallet } from "@ethereumjs/wallet";

const main = async () => {
  const keystorePath = "/workspace/keystore.json";
  const password = "1234@Abc";

  const keystoreJson = JSON.parse(fs.readFileSync(keystorePath, "utf8"));

  // Giải mã V3 (async)
  const wallet = await Wallet.fromV3(keystoreJson, password, true);

  // Lấy private key chuẩn
  const privateKey = "0x" + wallet.privateKey.toString("hex");

  console.log("Private key:", privateKey);
};

main();
