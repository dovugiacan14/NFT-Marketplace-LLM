geth account new
1234@Abc
our new account is locked with a password. Please give a password. Do not forget this password.
Password:
Repeat password: 

Your new key was generated

Public address of the key:   0xEC0430B1a16b8e6d32f6f0C405554269b3befC05
PRV: 0x723baefac83c0da725a428a8f513e96ca29e017e0f5bf4f4cfed2ad31e4c564d
Path of the secret key file: /root/.ethereum/keystore/UTC--2025-12-05T17-14-17.178916744Z--ec0430b1a16b8e6d32f6f0c405554269b3befc05

- You can share your public address with anyone. Others need it to interact with you.
- You must NEVER share the secret key with anyone! The key controls access to your funds!
- You must BACKUP your key file! Without the key, it's impossible to access account funds!
- You must REMEMBER your password! Without the password, it's impossible to decrypt the key!

geth attach process.env.NEXT_PUBLIC_ETH_NETWORK
personal.unlockAccount("0xd230A15180A7570E081C363d3f5f41E6D3010651", "1234@Abc", 0)

docker exec -it geth-node geth account list
docker exec -it geth-node geth account export 0xYourAccountAddress