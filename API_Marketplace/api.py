from contextlib import asynccontextmanager
from typing import List, Optional
import os
import tempfile
import base64
import uuid
import httpx

from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from seller.autoddg import AutoDDG
from seller.db import FaissDB
from seller.encryption import DataEncryption
from seller.key_storage import KeyStorage
from seller.blockchain_verify import BlockchainVerifier


# ==================== REQUEST/RESPONSE MODELS ====================

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


class SearchResult(BaseModel):
    cid: str
    title: str
    content: str
    score: float
    image_cid: Optional[str] = None


class EncryptDataRequest(BaseModel):
    file_content: str  # Base64 encoded file content
    item_cid: str
    filename: str = "data.csv"


class EncryptDataResponse(BaseModel):
    encrypted_content: str  # Base64 encoded encrypted content
    data_hash: str  # SHA256 hash for blockchain
    iv: str  # Base64 encoded IV for decryption
    success: bool
    error: Optional[str] = None


class DecryptionKeyRequest(BaseModel):
    item_id: int
    wallet_address: str
    signature: str  # Signed message to verify wallet ownership
    message: str  # Original message that was signed


class DecryptionKeyResponse(BaseModel):
    key: str  # Base64 encoded AES key
    iv: str  # Base64 encoded IV
    data_hash: str
    success: bool
    error: Optional[str] = None


class VerifyIntegrityRequest(BaseModel):
    item_id: int
    data_hash: str


class VerifyIntegrityResponse(BaseModel):
    valid: bool
    stored_hash: Optional[str] = None
    error: Optional[str] = None


# ==================== GLOBAL INSTANCES ====================

autoddg: AutoDDG = None
faiss_db: FaissDB = None
key_storage: KeyStorage = None
blockchain_verifier: BlockchainVerifier = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global autoddg, faiss_db, key_storage, blockchain_verifier

    print("Loading AutoDDG model...")
    autoddg = AutoDDG()
    print("AutoDDG model loaded successfully!")

    print("Loading FAISS database for search...")
    faiss_db = FaissDB()
    print("FAISS database loaded successfully!")

    print("Initializing Key Storage...")
    key_storage = KeyStorage()
    print("Key Storage initialized!")

    print("Initializing Blockchain Verifier...")
    blockchain_verifier = BlockchainVerifier()
    if blockchain_verifier.is_connected():
        print("Blockchain Verifier connected successfully!")
    else:
        print("Warning: Could not connect to blockchain. Verification will be limited.")

    yield


# Khoi tao FastAPI
app = FastAPI(
    lifespan=lifespan,
    title="Data Marketplace API",
    description="API for blockchain-based data marketplace with encryption and AI-powered search",
    version="2.0.0"
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== SELLER API ====================

@app.post("/generate_description")
async def generate_description(
    cid: Optional[str] = Form(None),
    title: str = Form(...),
    original_description: str = Form(""),
    csv_files_path: List[str] = Form(...),
    image_cid: Optional[str] = Form(None),
):
    """
    Generate AI-powered description for a dataset.

    - cid: Content ID (optional - will be auto-generated if not provided)
    - title: Dataset title
    - original_description: Original description (optional)
    - csv_files_path: List of URLs to CSV files for analysis
    - image_cid: IPFS CID of the cover image (optional)
    """
    try:
        # Auto-generate CID if not provided
        if not cid:
            cid = f"auto-{uuid.uuid4().hex[:16]}"

        user_focused_description, search_focused_description = autoddg.generate_dataset_description(
            cid=cid,
            title=title,
            original_description=original_description,
            csv_files_path=csv_files_path,
        )

        # Save search-focused description to FAISS vector DB for semantic search
        # Include title and image_cid for display in search results
        faiss_db.add_text(
            cid=cid,
            text=search_focused_description,
            title=title,
            image_cid=image_cid or ""
        )
        faiss_db.save()

        return {
            "cid": cid,
            "title": title,
            "original_description": original_description,
            "description": user_focused_description,
            "description_for_search": search_focused_description,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/encrypt_data", response_model=EncryptDataResponse)
async def encrypt_data(request: EncryptDataRequest):
    """
    Encrypt dataset file for secure storage.

    - file_content: Base64 encoded file content
    - item_cid: Content ID to associate with this encryption
    - filename: Original filename (for reference)

    Returns encrypted content and data hash for blockchain storage.
    """
    try:
        # Decode base64 file content
        file_bytes = base64.b64decode(request.file_content)

        # Compute hash of original data
        data_hash = DataEncryption.compute_hash(file_bytes)

        # Generate encryption key
        key = DataEncryption.generate_key()

        # Encrypt the data
        encrypted_data, iv = DataEncryption.encrypt_data(file_bytes, key)

        # Store the key
        key_storage.store_key(
            cid=request.item_cid,
            key=key,
            iv=iv,
            data_hash=data_hash,
            metadata={"filename": request.filename}
        )

        return EncryptDataResponse(
            encrypted_content=base64.b64encode(encrypted_data).decode('utf-8'),
            data_hash=data_hash,
            iv=base64.b64encode(iv).decode('utf-8'),
            success=True
        )

    except Exception as e:
        return EncryptDataResponse(
            encrypted_content="",
            data_hash="",
            iv="",
            success=False,
            error=str(e)
        )


@app.post("/encrypt_file")
async def encrypt_file(
    file: UploadFile = File(...),
    item_cid: str = Form(...)
):
    """
    Encrypt an uploaded file directly.

    - file: The file to encrypt
    - item_cid: Content ID to associate with this encryption
    """
    try:
        # Read file content
        file_bytes = await file.read()

        # Compute hash of original data
        data_hash = DataEncryption.compute_hash(file_bytes)

        # Generate encryption key
        key = DataEncryption.generate_key()

        # Encrypt the data
        encrypted_data, iv = DataEncryption.encrypt_data(file_bytes, key)

        # Store the key
        key_storage.store_key(
            cid=item_cid,
            key=key,
            iv=iv,
            data_hash=data_hash,
            metadata={"filename": file.filename}
        )

        return {
            "encrypted_content": base64.b64encode(encrypted_data).decode('utf-8'),
            "data_hash": data_hash,
            "iv": base64.b64encode(iv).decode('utf-8'),
            "filename": file.filename,
            "success": True
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== BUYER API ====================

@app.post("/search", response_model=List[SearchResult])
async def search_datasets(request: SearchRequest):
    """
    Search datasets by query using AI-powered semantic search.

    - query: Search text
    - top_k: Number of results to return (default 5)
    """
    results = faiss_db.search(request.query, k=request.top_k)
    return [
        SearchResult(
            cid=doc.metadata.get("cid", ""),
            title=doc.metadata.get("title", "Untitled Dataset"),
            content=doc.page_content,
            score=score,
            image_cid=doc.metadata.get("image_cid", None) or None
        )
        for doc, score in results
    ]


@app.post("/request_decryption_key", response_model=DecryptionKeyResponse)
async def request_decryption_key(request: DecryptionKeyRequest):
    """
    Request decryption key for a purchased dataset.
    Only NFT owners can request the decryption key.

    - item_id: Marketplace item ID
    - wallet_address: Requester's wallet address
    - signature: Signed message proving wallet ownership
    - message: Original message that was signed

    Returns the encryption key and IV if verification passes.
    """
    try:
        # Step 1: Verify signature to ensure requester controls the wallet
        if not blockchain_verifier.verify_signature(
            message=request.message,
            signature=request.signature,
            expected_address=request.wallet_address
        ):
            return DecryptionKeyResponse(
                key="",
                iv="",
                data_hash="",
                success=False,
                error="Invalid signature. Could not verify wallet ownership."
            )

        # Step 2: Verify ownership on blockchain
        if not blockchain_verifier.verify_ownership(
            item_id=request.item_id,
            wallet_address=request.wallet_address
        ):
            return DecryptionKeyResponse(
                key="",
                iv="",
                data_hash="",
                success=False,
                error="You do not own this item. Purchase required."
            )

        # Step 3: Get the encryption key from storage
        key_data = key_storage.get_key_by_item_id(request.item_id)

        if key_data is None:
            # Try to find by CID from blockchain data
            data_info = blockchain_verifier.get_data_info(request.item_id)
            if data_info:
                _, _, encrypted_url = data_info
                # Extract CID from URL if possible
                # For now, return error if key not found by item_id
                return DecryptionKeyResponse(
                    key="",
                    iv="",
                    data_hash="",
                    success=False,
                    error="Encryption key not found for this item."
                )

        key, iv, data_hash, cid = key_data

        return DecryptionKeyResponse(
            key=base64.b64encode(key).decode('utf-8'),
            iv=base64.b64encode(iv).decode('utf-8'),
            data_hash=data_hash,
            success=True
        )

    except Exception as e:
        return DecryptionKeyResponse(
            key="",
            iv="",
            data_hash="",
            success=False,
            error=str(e)
        )


@app.post("/verify_integrity", response_model=VerifyIntegrityResponse)
async def verify_integrity(request: VerifyIntegrityRequest):
    """
    Verify data integrity by comparing hash with blockchain record.

    - item_id: Marketplace item ID
    - data_hash: Hash of the data to verify
    """
    try:
        data_info = blockchain_verifier.get_data_info(request.item_id)

        if data_info is None:
            return VerifyIntegrityResponse(
                valid=False,
                error="Could not retrieve item data from blockchain"
            )

        stored_hash, _, _ = data_info

        # Compare hashes (normalize by removing leading zeros)
        stored_normalized = stored_hash.lstrip('0')
        provided_normalized = request.data_hash.lstrip('0')

        is_valid = stored_normalized == provided_normalized

        return VerifyIntegrityResponse(
            valid=is_valid,
            stored_hash=stored_hash
        )

    except Exception as e:
        return VerifyIntegrityResponse(
            valid=False,
            error=str(e)
        )


@app.post("/update_key_item_id")
async def update_key_item_id(cid: str = Form(...), item_id: int = Form(...)):
    """
    Update the item ID for a stored encryption key.
    Called after the item is successfully listed on the marketplace.

    - cid: Content ID of the encrypted data
    - item_id: Marketplace item ID from the smart contract
    """
    success = key_storage.update_item_id(cid, item_id)
    if success:
        return {"success": True, "message": "Key updated with item ID"}
    else:
        raise HTTPException(status_code=404, detail="Key not found for this CID")


# ==================== UTILITY ENDPOINTS ====================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "blockchain_connected": blockchain_verifier.is_connected() if blockchain_verifier else False
    }


@app.get("/item/{item_id}")
async def get_item_info(item_id: int):
    """
    Get marketplace item information from blockchain.

    - item_id: Marketplace item ID
    """
    if not blockchain_verifier:
        raise HTTPException(status_code=503, detail="Blockchain verifier not initialized")

    item = blockchain_verifier.get_market_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    return item


# ==================== SYNC ENDPOINTS ====================

PINATA_GATEWAY = os.getenv("PINATA_GATEWAY_URL", "green-delicate-badger-965.mypinata.cloud")
NFT_CONTRACT_ADDRESS = os.getenv("NFT_ADDRESS", "0x6f74b8A0466f75E9c19CC55757185757f0Ed123c")


def convert_ipfs_to_http(ipfs_url: str) -> str:
    """Convert ipfs:// URL to HTTP gateway URL."""
    if ipfs_url.startswith("ipfs://"):
        cid = ipfs_url.replace("ipfs://", "")
        return f"https://{PINATA_GATEWAY}/ipfs/{cid}"
    return ipfs_url


def extract_cid_from_url(url: str) -> Optional[str]:
    """Extract CID from IPFS URL."""
    if "ipfs://" in url:
        return url.replace("ipfs://", "")
    if "/ipfs/" in url:
        parts = url.split("/ipfs/")
        if len(parts) > 1:
            return parts[1].split("/")[0].split("?")[0]
    return None


@app.post("/sync_from_blockchain")
async def sync_from_blockchain():
    """
    Sync all NFT metadata from blockchain to FAISS vector DB.
    Fetches title, description, and image from IPFS metadata.
    """
    if not blockchain_verifier:
        raise HTTPException(status_code=503, detail="Blockchain verifier not initialized")

    synced = []
    errors = []

    # Load NFT contract ABI to get tokenURI
    nft_abi_path = os.path.join(
        os.path.dirname(__file__),
        "nft-marketplace-llm/artifacts/contracts/NFT.sol/NFT.json"
    )

    market_abi_path = os.path.join(
        os.path.dirname(__file__),
        "nft-marketplace-llm/artifacts/contracts/NFTMarket.sol/NFTMarket.json"
    )

    from web3 import Web3
    import json

    w3 = blockchain_verifier.w3
    nft_address = Web3.to_checksum_address(NFT_CONTRACT_ADDRESS)

    # Load NFT ABI
    if os.path.exists(nft_abi_path):
        with open(nft_abi_path, 'r') as f:
            nft_json = json.load(f)
            nft_abi = nft_json.get("abi", [])
    else:
        nft_abi = [
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}],
                "name": "tokenURI",
                "outputs": [{"name": "", "type": "string"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]

    nft_contract = w3.eth.contract(address=nft_address, abi=nft_abi)

    # Load Market ABI and get all items via fetchMarketItems
    if os.path.exists(market_abi_path):
        with open(market_abi_path, 'r') as f:
            market_json = json.load(f)
            market_abi = market_json.get("abi", [])
    else:
        raise HTTPException(status_code=500, detail="Market ABI not found")

    market_address = Web3.to_checksum_address(blockchain_verifier.market_address)
    market_contract = w3.eth.contract(address=market_address, abi=market_abi)

    # Fetch all market items at once
    try:
        market_items = market_contract.functions.fetchMarketItems().call()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch market items: {e}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        for item in market_items:
            try:
                # item is a tuple: (itemId, nftContract, tokenId, seller, owner, price, dataHash, licenseType, encryptedDataUrl)
                item_id = item[0]
                token_id = item[2]

                if token_id == 0:
                    continue

                # Get tokenURI from NFT contract
                try:
                    token_uri = nft_contract.functions.tokenURI(token_id).call()
                except Exception as e:
                    errors.append(f"Item {item_id}: Failed to get tokenURI - {e}")
                    continue

                # Convert to HTTP URL and fetch metadata
                metadata_url = convert_ipfs_to_http(token_uri)
                try:
                    response = await client.get(metadata_url)
                    if response.status_code != 200:
                        errors.append(f"Item {item_id}: Failed to fetch metadata from {metadata_url}")
                        continue
                    metadata = response.json()
                except Exception as e:
                    errors.append(f"Item {item_id}: Failed to parse metadata - {e}")
                    continue

                # Extract info from metadata
                title = metadata.get("name", "Untitled Dataset")
                description = metadata.get("description", "")
                image_url = metadata.get("image", "")
                image_cid = extract_cid_from_url(image_url) or ""

                # Use image CID as the document CID (matching the frontend behavior)
                doc_cid = image_cid or f"item-{item_id}"

                # Save to FAISS
                if description:
                    faiss_db.add_text(
                        cid=doc_cid,
                        text=description,
                        title=title,
                        image_cid=image_cid
                    )
                    synced.append({
                        "item_id": item_id,
                        "token_id": token_id,
                        "title": title,
                        "cid": doc_cid,
                        "image_cid": image_cid
                    })

            except Exception as e:
                errors.append(f"Item processing error: {str(e)}")
                continue

    # Save FAISS index
    if synced:
        faiss_db.save()

    return {
        "success": True,
        "synced_count": len(synced),
        "synced_items": synced,
        "errors": errors
    }
