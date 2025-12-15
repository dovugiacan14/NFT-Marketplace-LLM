export const convert_src = (ipfs) => {
    if (!ipfs) return null;

    return ipfs.startsWith("ipfs://")
        ? ipfs.replace(
            "ipfs://",
            `https://green-delicate-badger-965.mypinata.cloud/ipfs/`
        )
        : ipfs;
};