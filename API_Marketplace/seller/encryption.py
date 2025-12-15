"""
AES-256 Encryption module for Data Marketplace.
Handles encryption/decryption of dataset files and hash computation.
"""

import os
import hashlib
import base64
from typing import Tuple

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad


class DataEncryption:
    """AES-256-CBC encryption for dataset files."""

    BLOCK_SIZE = 16  # AES block size in bytes
    KEY_SIZE = 32    # 256-bit key

    @staticmethod
    def generate_key() -> bytes:
        """
        Generate a random 256-bit AES key.

        Returns:
            bytes: 32-byte random key
        """
        return get_random_bytes(DataEncryption.KEY_SIZE)

    @staticmethod
    def encrypt_data(data: bytes, key: bytes) -> Tuple[bytes, bytes]:
        """
        Encrypt data using AES-256-CBC.

        Args:
            data: Raw bytes to encrypt
            key: 32-byte AES key

        Returns:
            Tuple of (encrypted_data, iv)
        """
        iv = get_random_bytes(DataEncryption.BLOCK_SIZE)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded_data = pad(data, DataEncryption.BLOCK_SIZE)
        encrypted_data = cipher.encrypt(padded_data)
        return encrypted_data, iv

    @staticmethod
    def decrypt_data(encrypted_data: bytes, key: bytes, iv: bytes) -> bytes:
        """
        Decrypt data using AES-256-CBC.

        Args:
            encrypted_data: Encrypted bytes
            key: 32-byte AES key
            iv: 16-byte initialization vector

        Returns:
            Decrypted bytes
        """
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted_padded = cipher.decrypt(encrypted_data)
        decrypted_data = unpad(decrypted_padded, DataEncryption.BLOCK_SIZE)
        return decrypted_data

    @staticmethod
    def encrypt_file(file_path: str, key: bytes) -> Tuple[bytes, bytes]:
        """
        Encrypt a file using AES-256-CBC.

        Args:
            file_path: Path to file to encrypt
            key: 32-byte AES key

        Returns:
            Tuple of (encrypted_data, iv)
        """
        with open(file_path, 'rb') as f:
            data = f.read()
        return DataEncryption.encrypt_data(data, key)

    @staticmethod
    def decrypt_file(encrypted_data: bytes, key: bytes, iv: bytes, output_path: str) -> None:
        """
        Decrypt data and save to file.

        Args:
            encrypted_data: Encrypted bytes
            key: 32-byte AES key
            iv: 16-byte initialization vector
            output_path: Path to save decrypted file
        """
        decrypted_data = DataEncryption.decrypt_data(encrypted_data, key, iv)
        with open(output_path, 'wb') as f:
            f.write(decrypted_data)

    @staticmethod
    def compute_hash(data: bytes) -> str:
        """
        Compute SHA256 hash of data.

        Args:
            data: Raw bytes to hash

        Returns:
            Hex string of SHA256 hash
        """
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def compute_file_hash(file_path: str) -> str:
        """
        Compute SHA256 hash of a file.

        Args:
            file_path: Path to file

        Returns:
            Hex string of SHA256 hash
        """
        sha256_hash = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest()

    @staticmethod
    def key_to_base64(key: bytes) -> str:
        """Convert key bytes to base64 string for transport."""
        return base64.b64encode(key).decode('utf-8')

    @staticmethod
    def base64_to_key(key_b64: str) -> bytes:
        """Convert base64 string back to key bytes."""
        return base64.b64decode(key_b64.encode('utf-8'))

    @staticmethod
    def hash_to_bytes32(hash_hex: str) -> bytes:
        """
        Convert hex hash string to bytes32 for smart contract.

        Args:
            hash_hex: 64-character hex string (SHA256)

        Returns:
            32-byte bytes object
        """
        return bytes.fromhex(hash_hex)

    @staticmethod
    def bytes32_to_hash(data: bytes) -> str:
        """
        Convert bytes32 from smart contract to hex hash string.

        Args:
            data: 32-byte bytes object

        Returns:
            64-character hex string
        """
        return data.hex()
