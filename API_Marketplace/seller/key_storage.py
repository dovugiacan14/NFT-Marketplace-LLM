"""
Key Storage module for Data Marketplace.
Securely stores encryption keys mapped to item CIDs.
"""

import os
import json
import base64
from pathlib import Path
from typing import Optional, Tuple
from datetime import datetime


KEY_STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "encryption_keys")


class KeyStorage:
    """
    Secure file-based storage for encryption keys.
    Keys are stored as JSON files indexed by CID.
    """

    def __init__(self, storage_dir: str = KEY_STORAGE_DIR):
        """
        Initialize key storage.

        Args:
            storage_dir: Directory to store key files
        """
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)

    def _get_key_path(self, cid: str) -> str:
        """Get file path for a CID's key file."""
        # Sanitize CID for filename
        safe_cid = cid.replace("/", "_").replace("\\", "_")
        return os.path.join(self.storage_dir, f"{safe_cid}.json")

    def store_key(
        self,
        cid: str,
        key: bytes,
        iv: bytes,
        data_hash: str,
        item_id: Optional[int] = None,
        metadata: Optional[dict] = None
    ) -> bool:
        """
        Store encryption key for an item.

        Args:
            cid: Content ID (IPFS hash) of the item
            key: AES encryption key (32 bytes)
            iv: Initialization vector (16 bytes)
            data_hash: SHA256 hash of original data
            item_id: Optional marketplace item ID
            metadata: Optional additional metadata

        Returns:
            True if stored successfully
        """
        key_data = {
            "cid": cid,
            "key": base64.b64encode(key).decode('utf-8'),
            "iv": base64.b64encode(iv).decode('utf-8'),
            "data_hash": data_hash,
            "item_id": item_id,
            "created_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }

        key_path = self._get_key_path(cid)
        with open(key_path, 'w') as f:
            json.dump(key_data, f, indent=2)

        return True

    def get_key(self, cid: str) -> Optional[Tuple[bytes, bytes, str]]:
        """
        Retrieve encryption key for an item.

        Args:
            cid: Content ID of the item

        Returns:
            Tuple of (key, iv, data_hash) or None if not found
        """
        key_path = self._get_key_path(cid)

        if not os.path.exists(key_path):
            return None

        with open(key_path, 'r') as f:
            key_data = json.load(f)

        key = base64.b64decode(key_data["key"])
        iv = base64.b64decode(key_data["iv"])
        data_hash = key_data["data_hash"]

        return key, iv, data_hash

    def get_key_info(self, cid: str) -> Optional[dict]:
        """
        Get full key information including metadata.

        Args:
            cid: Content ID of the item

        Returns:
            Dict with all key data or None if not found
        """
        key_path = self._get_key_path(cid)

        if not os.path.exists(key_path):
            return None

        with open(key_path, 'r') as f:
            return json.load(f)

    def update_item_id(self, cid: str, item_id: int) -> bool:
        """
        Update the item ID for a stored key.
        Called after the item is listed on the marketplace.

        Args:
            cid: Content ID of the item
            item_id: Marketplace item ID

        Returns:
            True if updated successfully
        """
        key_path = self._get_key_path(cid)

        if not os.path.exists(key_path):
            return False

        with open(key_path, 'r') as f:
            key_data = json.load(f)

        key_data["item_id"] = item_id
        key_data["updated_at"] = datetime.utcnow().isoformat()

        with open(key_path, 'w') as f:
            json.dump(key_data, f, indent=2)

        return True

    def delete_key(self, cid: str) -> bool:
        """
        Delete key for an item.

        Args:
            cid: Content ID of the item

        Returns:
            True if deleted, False if not found
        """
        key_path = self._get_key_path(cid)

        if os.path.exists(key_path):
            os.remove(key_path)
            return True
        return False

    def key_exists(self, cid: str) -> bool:
        """Check if key exists for a CID."""
        return os.path.exists(self._get_key_path(cid))

    def list_keys(self) -> list:
        """
        List all stored CIDs.

        Returns:
            List of CIDs with stored keys
        """
        cids = []
        for filename in os.listdir(self.storage_dir):
            if filename.endswith('.json'):
                cid = filename[:-5].replace("_", "/")
                cids.append(cid)
        return cids

    def get_key_by_item_id(self, item_id: int) -> Optional[Tuple[bytes, bytes, str, str]]:
        """
        Find key by marketplace item ID.

        Args:
            item_id: Marketplace item ID

        Returns:
            Tuple of (key, iv, data_hash, cid) or None if not found
        """
        for filename in os.listdir(self.storage_dir):
            if filename.endswith('.json'):
                key_path = os.path.join(self.storage_dir, filename)
                with open(key_path, 'r') as f:
                    key_data = json.load(f)
                if key_data.get("item_id") == item_id:
                    key = base64.b64decode(key_data["key"])
                    iv = base64.b64decode(key_data["iv"])
                    return key, iv, key_data["data_hash"], key_data["cid"]
        return None
