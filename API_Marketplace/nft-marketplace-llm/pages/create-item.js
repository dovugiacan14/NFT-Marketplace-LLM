import { useState } from 'react'
import { ethers } from 'ethers'
import { useRouter } from 'next/router'
import Web3Modal from 'web3modal'
import web3 from 'web3'
import axios from 'axios'
import Loading from '../components/Loading'
import Spinner from '../components/Spinner'

const nftaddress = process.env.NEXT_PUBLIC_NFT_ADDRESS;
const nftmarketaddress = process.env.NEXT_PUBLIC_NFTMARKET_ADDRESS;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

import NFT from '../artifacts/contracts/NFT.sol/NFT.json'
import Market from '../artifacts/contracts/NFTMarket.sol/NFTMarket.json'

export default function CreateItem() {
  // Basic form state
  const [fileUrl, setFileUrl] = useState(null)
  const [fileCid, setFileCid] = useState(null)
  const [formInput, updateFormInput] = useState({ price: '', name: '', description: '' })
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const router = useRouter()

  // Data marketplace state
  const [csvFiles, setCsvFiles] = useState([])
  const [csvUrls, setCsvUrls] = useState([])
  const [licenseType, setLicenseType] = useState('personal')
  const [dataHash, setDataHash] = useState('')
  const [encryptedDataUrl, setEncryptedDataUrl] = useState('')
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
  const [isEncrypting, setIsEncrypting] = useState(false)
  const [encryptedContent, setEncryptedContent] = useState(null)

  // Upload image to IPFS
  async function onImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true)
      setLoadingMessage('Uploading image to IPFS...')

      const res = await fetch("/api/files", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      setFileUrl(data.url);
      setFileCid(data.cid);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setLoading(false)
    }
  }

  // Upload CSV files to IPFS
  async function onCsvChange(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setCsvFiles(files);

    try {
      setLoading(true);
      setLoadingMessage('Uploading CSV files to IPFS...');

      const uploadedUrls = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/files", {
          method: "POST",
          body: formData
        });

        const data = await res.json();
        const url = `https://${process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL}/ipfs/${data.cid}`;
        uploadedUrls.push(url);
      }

      setCsvUrls(uploadedUrls);
    } catch (err) {
      console.error("CSV upload error:", err);
    } finally {
      setLoading(false);
    }
  }

  // Generate AI description from CSV files
  async function generateAIDescription() {
    if (!csvUrls.length || !formInput.name) {
      return;
    }

    try {
      setIsGeneratingDescription(true);
      setLoadingMessage('Generating AI description...');

      const formData = new FormData();
      // CID is optional - backend will auto-generate if not provided
      if (fileCid) {
        formData.append('cid', fileCid);
        formData.append('image_cid', fileCid);  // Also send image CID for search results
      }
      formData.append('title', formInput.name);
      formData.append('original_description', formInput.description || '');
      csvUrls.forEach(url => formData.append('csv_files_path', url));

      const res = await axios.post(`${apiUrl}/generate_description`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (res.data.description) {
        updateFormInput({ ...formInput, description: res.data.description });
      }
      // If backend generated a CID, save it for later use
      if (res.data.cid && !fileCid) {
        setFileCid(res.data.cid);
      }
    } catch (err) {
      console.error("AI description error:", err);
    } finally {
      setIsGeneratingDescription(false);
    }
  }

  // Encrypt CSV data before listing
  async function encryptData() {
    if (!csvFiles.length || !fileCid) {
      return;
    }

    try {
      setIsEncrypting(true);
      setLoadingMessage('Encrypting data...');

      // Read the first CSV file (or merge if needed)
      const file = csvFiles[0];
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const base64Content = btoa(e.target.result);

          const res = await axios.post(`${apiUrl}/encrypt_data`, {
            file_content: base64Content,
            item_cid: fileCid,
            filename: file.name
          });

          if (res.data.success) {
            setDataHash(res.data.data_hash);
            setEncryptedContent(res.data.encrypted_content);

            // Upload encrypted content to IPFS
            const encryptedBlob = new Blob(
              [atob(res.data.encrypted_content)],
              { type: 'application/octet-stream' }
            );
            const encryptedFile = new File([encryptedBlob], 'encrypted_data.bin');

            const formData = new FormData();
            formData.append("file", encryptedFile);

            const uploadRes = await fetch("/api/files", {
              method: "POST",
              body: formData
            });

            const uploadData = await uploadRes.json();
            const encUrl = `https://${process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL}/ipfs/${uploadData.cid}`;
            setEncryptedDataUrl(encUrl);
          } else {
            throw new Error(res.data.error || 'Encryption failed');
          }
        } catch (err) {
          console.error("Encryption error:", err);
        } finally {
          setIsEncrypting(false);
        }
      };

      reader.readAsBinaryString(file);
    } catch (err) {
      console.error("Encryption error:", err);
      setIsEncrypting(false);
    }
  }

  // Create NFT and list on marketplace
  async function createSale(url) {
    if (!url) throw new Error("TokenURI is required")

    const web3Modal = new Web3Modal({
      network: "mainnet",
      cacheProvider: false,
    });
    await web3Modal.clearCachedProvider();
    const connection = await web3Modal.connect()
    const provider = new ethers.providers.Web3Provider(connection)
    const { chainId } = await provider.getNetwork()

    if (chainId !== 1337) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x539' }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x539',
                  chainName: 'ETH',
                  rpcUrls: [process.env.NEXT_PUBLIC_ETH_NETWORK],
                  nativeCurrency: {
                    name: 'ETH',
                    symbol: 'ETH',
                    decimals: 18,
                  },
                },
              ],
            });
          } catch (addError) {
            console.error("Failed to add network:", addError);
            return;
          }
        } else {
          console.error("Failed to switch network:", switchError);
          return;
        }
      }
    }

    const newProvider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = newProvider.getSigner();

    // Mint NFT
    let contract = new ethers.Contract(nftaddress, NFT.abi, signer)
    let transaction = await contract.createToken(url)
    let tx = await transaction.wait()
    let event = tx.events[0]
    let value = event.args[2]
    let tokenId = value.toNumber()

    const price = web3.utils.toWei(formInput.price, 'ether')
    const listingPrice = web3.utils.toWei('0.1', 'ether')

    // Convert dataHash to bytes32 format
    let dataHashBytes32;
    if (dataHash) {
      // Ensure hash is 64 characters (32 bytes)
      const cleanHash = dataHash.startsWith('0x') ? dataHash.slice(2) : dataHash;
      dataHashBytes32 = '0x' + cleanHash.padStart(64, '0');
    } else {
      dataHashBytes32 = '0x' + '0'.repeat(64); // Empty hash
    }

    // Create market item with data fields
    contract = new ethers.Contract(nftmarketaddress, Market.abi, signer)
    transaction = await contract.createMarketItem(
      nftaddress,
      tokenId,
      price,
      dataHashBytes32,
      licenseType,
      encryptedDataUrl || '',
      { value: listingPrice }
    )

    const receipt = await transaction.wait()

    // Extract itemId from event
    const marketItemCreatedEvent = receipt.events.find(e => e.event === 'MarketItemCreated');
    if (marketItemCreatedEvent && encryptedDataUrl) {
      const itemId = marketItemCreatedEvent.args.itemId.toNumber();

      // Update key storage with item ID
      try {
        const formData = new FormData();
        formData.append('cid', fileCid);
        formData.append('item_id', itemId);

        await axios.post(`${apiUrl}/update_key_item_id`, formData);
      } catch (err) {
        console.error("Failed to update key item ID:", err);
      }
    }

    router.push('/')
  }

  // Create market listing
  async function createMarket() {
    const { name, description, price } = formInput;

    if (!name || !description || !price || !fileCid) {
      return;
    }

    const image = `ipfs://${fileCid}`;
    const metadata = {
      name,
      description,
      image,
      // Include data marketplace fields in metadata
      licenseType,
      dataHash: dataHash || null,
      encryptedDataUrl: encryptedDataUrl || null,
      hasEncryptedData: !!encryptedDataUrl
    };

    try {
      setLoading(true)
      setLoadingMessage('Uploading metadata to IPFS...')

      const res = await fetch("/api/json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(metadata)
      });

      const data = await res.json();
      if (res.status !== 200) {
        throw new Error(data.error);
      }

      const url = data.url;
      console.log("Metadata uploaded to IPFS:", url);

      setLoadingMessage('Minting NFT and creating market listing...')
      await createSale(url);
    } catch (error) {
      console.error("Error creating NFT:", error);
      setLoading(false)
    }
  }

  return (
    <>
      {(loading || isGeneratingDescription || isEncrypting) && (
        <Loading message={loadingMessage} />
      )}
      <div className="flex justify-center px-4 py-8">
        <div className="w-full max-w-4xl">
          <div className="bg-white rounded-2xl shadow-lg p-8">

            <h1 className="text-3xl font-bold text-gray-800 mb-6">
              Create Data Asset
            </h1>

            {/* Image Upload Section */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Cover Image
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Upload an image to represent your data asset. JPG, PNG, GIF supported.
              </p>

              <div className="relative border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={onImageChange}
                  accept="image/*"
                  disabled={loading}
                />
                <div className="flex flex-col items-center">
                  <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-600">
                    <span className="text-blue-500 font-semibold">Upload image</span>
                  </p>
                </div>
              </div>

              {fileUrl && (
                <div className="mt-4">
                  <img className="rounded-xl w-full max-w-md mx-auto shadow-md" src={fileUrl} alt="Preview" />
                </div>
              )}
            </div>

            {/* CSV Data Upload Section */}
            <div className="mb-8 p-6 bg-blue-50 rounded-xl">
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Data Files (CSV)
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Upload your dataset CSV files. These will be encrypted and only accessible to buyers.
              </p>

              <div className="relative border-2 border-dashed border-blue-300 rounded-xl p-6 text-center hover:border-blue-500 transition-colors bg-white">
                <input
                  type="file"
                  multiple
                  accept=".csv"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={onCsvChange}
                  disabled={loading}
                />
                <div className="flex flex-col items-center">
                  <svg className="w-10 h-10 text-blue-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-gray-600">
                    <span className="text-blue-500 font-semibold">Upload CSV files</span>
                  </p>
                </div>
              </div>

              {csvFiles.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Uploaded files:</p>
                  <ul className="text-sm text-gray-600">
                    {csvFiles.map((file, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        {file.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AI Description & Encrypt Buttons */}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={generateAIDescription}
                  disabled={!csvUrls.length || !formInput.name || isGeneratingDescription}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGeneratingDescription ? (
                    <>
                      <Spinner size="sm" color="white" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <span>Generate AI Description</span>
                    </>
                  )}
                </button>

                <button
                  onClick={encryptData}
                  disabled={!csvFiles.length || !fileCid || isEncrypting}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isEncrypting ? (
                    <>
                      <Spinner size="sm" color="white" />
                      <span>Encrypting...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span>Encrypt Data</span>
                    </>
                  )}
                </button>
              </div>

              {/* Encryption Status */}
              {dataHash && (
                <div className="mt-4 p-3 bg-green-100 rounded-lg">
                  <p className="text-sm font-medium text-green-800">Data Encrypted!</p>
                  <p className="text-xs text-green-600 font-mono break-all mt-1">
                    Hash: {dataHash.slice(0, 20)}...{dataHash.slice(-20)}
                  </p>
                </div>
              )}
            </div>

            {/* Item Name */}
            <div className="mb-6">
              <label className="block text-gray-800 font-semibold mb-2">
                Item Name *
              </label>
              <input
                type="text"
                placeholder="e.g., Financial Transaction Dataset 2024"
                className="w-full border border-gray-300 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                onChange={e => updateFormInput({ ...formInput, name: e.target.value })}
                value={formInput.name}
                disabled={loading}
              />
            </div>

            {/* Description */}
            <div className="mb-6">
              <label className="block text-gray-800 font-semibold mb-2">
                Description *
              </label>
              <textarea
                placeholder="Describe your dataset..."
                rows="5"
                className="w-full border border-gray-300 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                onChange={e => updateFormInput({ ...formInput, description: e.target.value })}
                value={formInput.description}
                disabled={loading}
              />
              <p className="text-sm text-gray-500 mt-2">
                Use the "Generate AI Description" button to auto-generate from your CSV files.
              </p>
            </div>

            {/* License Type */}
            <div className="mb-6">
              <label className="block text-gray-800 font-semibold mb-2">
                License Type
              </label>
              <select
                value={licenseType}
                onChange={e => setLicenseType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                disabled={loading}
              >
                <option value="personal">Personal Use Only</option>
                <option value="research">Research Only</option>
                <option value="commercial">Commercial Use</option>
              </select>
              <p className="text-sm text-gray-500 mt-2">
                Define how buyers can use your data.
              </p>
            </div>

            {/* Price */}
            <div className="mb-8">
              <label className="block text-gray-800 font-semibold mb-2">
                Price (ETH) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                onChange={e => updateFormInput({ ...formInput, price: e.target.value })}
                value={formInput.price}
                disabled={loading}
              />
              <p className="text-sm text-gray-500 mt-2">
                Listing fee: 0.1 ETH
              </p>
            </div>

            {/* Submit Button */}
            <button
              onClick={createMarket}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={!formInput.name || !formInput.description || !formInput.price || !fileUrl || loading}
            >
              {loading ? (
                <>
                  <Spinner size="md" color="white" />
                  <span>Creating...</span>
                </>
              ) : (
                'Create Data Asset'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
