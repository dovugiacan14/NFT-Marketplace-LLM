import { ethers } from 'ethers'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import web3 from 'web3'
import axios from 'axios'
import Web3Modal from "web3modal"
import { convert_src } from '../../utils/utils'
import Loading from '../../components/Loading'
import Spinner from '../../components/Spinner'
import { BigNumber } from "ethers"
import NFT from '../../artifacts/contracts/NFT.sol/NFT.json'
import Market from '../../artifacts/contracts/NFTMarket.sol/NFTMarket.json'

const nftaddress = process.env.NEXT_PUBLIC_NFT_ADDRESS;
const nftmarketaddress = process.env.NEXT_PUBLIC_NFTMARKET_ADDRESS;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function NFTDetail() {
    const router = useRouter()
    const { id } = router.query
    const [nft, setNft] = useState(null)
    const [histories, setHistories] = useState([])
    const [loading, setLoading] = useState(true)
    const [purchasing, setPurchasing] = useState(false)
    const [activeTab, setActiveTab] = useState('activities')
    const [currentUser, setCurrentUser] = useState(null)
    const [newPrice, setNewPrice] = useState('')

    // Data marketplace state
    const [dataInfo, setDataInfo] = useState(null)
    const [isDownloading, setIsDownloading] = useState(false)
    const [downloadError, setDownloadError] = useState(null)

    useEffect(() => {
        if (id) {
            loadNFT()
            getCurrentUser()
        }
    }, [id])

    async function loadNFT() {
        try {
            const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_ETH_NETWORK);
            const tokenContract = new ethers.Contract(nftaddress, NFT.abi, provider)
            const marketContract = new ethers.Contract(nftmarketaddress, Market.abi, provider)

            const itemId = Number(id);
            const item = await marketContract.getMarketItem(itemId)

            if (!item) {
                setLoading(false)
                return
            }

            const tokenUri = await tokenContract.tokenURI(item.tokenId)
            const meta = await axios.get(convert_src(tokenUri))
            let price = web3.utils.fromWei(item.price.toString(), 'ether');

            const nftData = {
                price,
                tokenId: item.tokenId.toNumber(),
                seller: item.seller,
                owner: item.owner,
                image: convert_src(meta.data.image),
                name: meta.data.name,
                description: meta.data.description,
            }

            setNft(nftData)
            setNewPrice(nftData.price)

            // Load data info (dataHash, licenseType, encryptedDataUrl)
            try {
                const dataInfoResult = await marketContract.getDataInfo(itemId)
                setDataInfo({
                    dataHash: dataInfoResult.dataHash,
                    licenseType: dataInfoResult.licenseType || 'personal',
                    encryptedDataUrl: dataInfoResult.encryptedDataUrl || ''
                })
            } catch (err) {
                console.log('Data info not available (contract may not support it)')
            }

            const histories = await fetchItemHistories(marketContract, itemId);
            setHistories(histories)
            setLoading(false)
        } catch (error) {
            console.error('Error loading NFT:', error)
            setLoading(false)
        }
    }

    async function getCurrentUser() {
        try {
            if (typeof window.ethereum !== 'undefined') {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' })
                if (accounts.length > 0) {
                    setCurrentUser(accounts[0].toLowerCase())
                }
            }
        } catch (error) {
            console.error('Error getting current user:', error)
        }
    }

    async function fetchItemHistories(marketContract, itemId) {
        const idBN = ethers.BigNumber.from(itemId);

        const [created, sold, relisted, canceled] = await Promise.all([
            marketContract.queryFilter(marketContract.filters.MarketItemCreated(idBN)),
            marketContract.queryFilter(marketContract.filters.MarketItemSold(idBN)),
            marketContract.queryFilter(marketContract.filters.MarketItemRelisted(idBN)),
            marketContract.queryFilter(marketContract.filters.MarketItemCanceled(idBN))
        ]);

        const events = [];

        created.forEach(e => {
            events.push({
                type: "LISTED",
                itemId: e.args.itemId.toString(),
                tokenId: e.args.tokenId.toString(),
                actor: e.args.seller,
                price: ethers.utils.formatEther(e.args.price),
                timestamp: e.args.timestamp ? e.args.timestamp.toNumber() : null
            });
        });

        sold.forEach(e => {
            events.push({
                type: "SOLD",
                itemId: e.args.itemId.toString(),
                tokenId: e.args.tokenId.toString(),
                actor: e.args.buyer,
                seller: e.args.seller,
                price: ethers.utils.formatEther(e.args.price),
                timestamp: e.args.timestamp ? e.args.timestamp.toNumber() : null
            });
        });

        relisted.forEach(e => {
            events.push({
                type: "RELISTED",
                itemId: e.args.itemId.toString(),
                tokenId: e.args.tokenId.toString(),
                actor: e.args.seller,
                price: ethers.utils.formatEther(e.args.price),
                timestamp: e.args.timestamp ? e.args.timestamp.toNumber() : null
            });
        });

        canceled.forEach(e => {
            events.push({
                type: "CANCELED",
                itemId: e.args.itemId.toString(),
                tokenId: e.args.tokenId.toString(),
                actor: e.args.seller,
                timestamp: e.args.timestamp ? e.args.timestamp.toNumber() : null
            });
        });

        events.sort((a, b) => a.timestamp - b.timestamp);
        return events;
    }

    async function buyNft() {
        if (!nft) return

        try {
            setPurchasing(true)
            const web3Modal = new Web3Modal({
                network: "mainnet",
                cacheProvider: true,
            });
            const connection = await web3Modal.connect()
            const provider = new ethers.providers.Web3Provider(connection)
            const signer = provider.getSigner()
            const contract = new ethers.Contract(nftmarketaddress, Market.abi, signer)

            const price = web3.utils.toWei(nft.price.toString(), 'ether');
            const itemId = Number(id);
            const transaction = await contract.createMarketSale(nftaddress, itemId, {
                value: price
            })
            await transaction.wait()
            router.push('/')
        } catch (error) {
            console.error('Error purchasing NFT:', error)
            alert('Failed to purchase NFT. Please try again.')
        } finally {
            setPurchasing(false)
        }
    }

    async function relistNFT() {
        if (!nft || !newPrice) return

        try {
            setPurchasing(true)
            const web3Modal = new Web3Modal({
                network: "mainnet",
                cacheProvider: true,
            });
            const connection = await web3Modal.connect()
            const provider = new ethers.providers.Web3Provider(connection)
            const signer = provider.getSigner()
            const contract = new ethers.Contract(nftmarketaddress, Market.abi, signer)

            const price = web3.utils.toWei(newPrice.toString(), 'ether');
            const listingPrice = web3.utils.toWei('0.1', 'ether')

            const item = await contract.getMarketItem(id)
            const transaction = await contract.relistMarketItem(item.itemId, price, {
                value: listingPrice
            })
            await transaction.wait()
            router.push('/')
        } catch (error) {
            console.error('Error re-listing NFT:', error)
            alert('Failed to re-list NFT. Please try again.')
        } finally {
            setPurchasing(false)
        }
    }

    // Download encrypted data (only for owners)
    async function downloadData() {
        if (!nft || !currentUser) return
        if (currentUser !== nft.owner.toLowerCase()) {
            alert('Only the owner can download the data')
            return
        }
        if (!dataInfo || !dataInfo.encryptedDataUrl) {
            alert('No encrypted data available for this item')
            return
        }

        setIsDownloading(true)
        setDownloadError(null)

        try {
            // Step 1: Sign message to prove ownership
            const web3Modal = new Web3Modal({
                network: "mainnet",
                cacheProvider: true,
            })
            const connection = await web3Modal.connect()
            const provider = new ethers.providers.Web3Provider(connection)
            const signer = provider.getSigner()

            const message = `Request decryption key for item ${id} at ${Date.now()}`
            const signature = await signer.signMessage(message)

            // Step 2: Request decryption key from backend
            const keyResponse = await axios.post(`${apiUrl}/request_decryption_key`, {
                item_id: parseInt(id),
                wallet_address: currentUser,
                signature: signature,
                message: message
            })

            if (!keyResponse.data.success) {
                throw new Error(keyResponse.data.error || 'Failed to get decryption key')
            }

            const { key, iv } = keyResponse.data

            // Step 3: Download encrypted file
            const encryptedResponse = await fetch(dataInfo.encryptedDataUrl)
            const encryptedData = await encryptedResponse.arrayBuffer()

            // Step 4: Decrypt in browser using Web Crypto API
            const keyBuffer = Uint8Array.from(atob(key), c => c.charCodeAt(0))
            const ivBuffer = Uint8Array.from(atob(iv), c => c.charCodeAt(0))

            const cryptoKey = await window.crypto.subtle.importKey(
                'raw',
                keyBuffer,
                { name: 'AES-CBC' },
                false,
                ['decrypt']
            )

            const decryptedData = await window.crypto.subtle.decrypt(
                { name: 'AES-CBC', iv: ivBuffer },
                cryptoKey,
                encryptedData
            )

            // Step 5: Remove PKCS7 padding
            const decryptedArray = new Uint8Array(decryptedData)
            const paddingLength = decryptedArray[decryptedArray.length - 1]
            const unpaddedData = decryptedArray.slice(0, decryptedArray.length - paddingLength)

            // Step 6: Create download blob
            const blob = new Blob([unpaddedData], { type: 'text/csv' })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `data_${id}.csv`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            window.URL.revokeObjectURL(url)

            alert('Data downloaded successfully!')
        } catch (error) {
            console.error('Error downloading data:', error)
            setDownloadError(error.message || 'Failed to download data')
            alert('Failed to download data: ' + (error.message || 'Unknown error'))
        } finally {
            setIsDownloading(false)
        }
    }

    const isOwner = currentUser && nft && currentUser === nft.owner.toLowerCase()
    const isSeller = currentUser && nft && currentUser === nft.seller.toLowerCase()
    const hasEncryptedData = dataInfo && dataInfo.encryptedDataUrl

    if (loading) {
        return <Loading message="Loading NFT details..." />
    }

    if (!nft) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <div className="text-xl text-gray-600">NFT not found</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Left Column - Image */}
                    <div className="space-y-6">
                        <div className="bg-gradient-to-br from-pink-200 to-pink-300 rounded-3xl overflow-hidden shadow-lg">
                            <img
                                src={nft.image}
                                alt={nft.name || `NFT #${nft.tokenId}`}
                                className="w-full h-auto object-cover"
                            />
                        </div>

                        {/* Descriptions Section */}
                        <div className="bg-white rounded-2xl shadow-md p-6">
                            <button className="flex items-center justify-between w-full text-left font-semibold text-gray-800 text-lg mb-4">
                                <span>Descriptions</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <p className="text-gray-600 leading-relaxed">
                                {nft.description || `${nft.name || 'This NFT'} is a unique digital collectible on the blockchain.`}
                            </p>
                        </div>

                        {/* Data Info Section */}
                        {dataInfo && (
                            <div className="bg-white rounded-2xl shadow-md p-6">
                                <h3 className="font-semibold text-gray-800 text-lg mb-4 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Data Asset Info
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">License Type</span>
                                        <span className={`font-semibold px-2 py-1 rounded ${
                                            dataInfo.licenseType === 'commercial' ? 'bg-green-100 text-green-700' :
                                            dataInfo.licenseType === 'research' ? 'bg-blue-100 text-blue-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                            {dataInfo.licenseType === 'commercial' ? 'Commercial Use' :
                                             dataInfo.licenseType === 'research' ? 'Research Only' :
                                             'Personal Use'}
                                        </span>
                                    </div>
                                    {dataInfo.dataHash && dataInfo.dataHash !== '0x' + '0'.repeat(64) && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Data Hash</span>
                                            <span className="text-gray-800 font-mono text-xs">
                                                {dataInfo.dataHash.slice(0, 10)}...{dataInfo.dataHash.slice(-8)}
                                            </span>
                                        </div>
                                    )}
                                    {hasEncryptedData && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                            </svg>
                                            <span className="text-sm text-green-600 font-medium">Encrypted Data Available</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Details Section */}
                        <div className="bg-white rounded-2xl shadow-md p-6">
                            <button className="flex items-center justify-between w-full text-left font-semibold text-gray-800 text-lg mb-4">
                                <span>Details</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Contract Address</span>
                                    <span className="text-blue-600 font-mono text-xs">
                                        {nftaddress.slice(0, 6)}...{nftaddress.slice(-4)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Token ID</span>
                                    <span className="text-gray-800 font-semibold">{nft.tokenId}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Token Standard</span>
                                    <span className="text-gray-800">ERC-721</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Blockchain</span>
                                    <span className="text-gray-800">Ethereum</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Details */}
                    <div className="space-y-6">

                        {/* Creator and Collection */}
                        <div className="flex items-center gap-8">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-semibold">
                                    {nft.seller.slice(2, 3).toUpperCase()}
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500">Seller</p>
                                    <p className="text-sm font-semibold text-gray-800">
                                        {nft.seller.slice(0, 6)}...{nft.seller.slice(-4)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center text-white font-semibold">
                                    D
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500">Collection</p>
                                    <p className="text-sm font-semibold text-gray-800">Data Marketplace</p>
                                </div>
                            </div>
                        </div>

                        {/* Price and Actions */}
                        <div className="bg-white rounded-2xl shadow-md p-6">
                            <div className="border-2 border-green-500 rounded-xl p-4 mb-4">
                                <p className="text-sm text-gray-500 mb-2">
                                    {isSeller ? 'Set New Price' : 'Current Price'}
                                </p>

                                {isSeller ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            value={newPrice}
                                            onChange={(e) => setNewPrice(e.target.value)}
                                            className="text-3xl font-bold text-green-600 border-2 border-gray-300 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Enter price"
                                            disabled={!isOwner}
                                        />
                                        <span className="text-2xl font-bold text-green-600">ETH</span>
                                    </div>
                                ) : (
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-bold text-green-600">{nft.price} ETH</span>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={relistNFT}
                                    className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={purchasing || !currentUser || !isSeller || !newPrice}
                                >
                                    {purchasing ? (
                                        <>
                                            <Spinner size="sm" color="white" />
                                            <span>Processing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                            Listing Item
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={buyNft}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={purchasing || !currentUser || isSeller}
                                >
                                    {purchasing ? (
                                        <>
                                            <Spinner size="sm" color="white" />
                                            <span>Processing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                            </svg>
                                            Buy Now
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Download Data Button - Only for owners */}
                            {isOwner && hasEncryptedData && (
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                    <button
                                        onClick={downloadData}
                                        disabled={isDownloading}
                                        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isDownloading ? (
                                            <>
                                                <Spinner size="sm" color="white" />
                                                <span>Downloading & Decrypting...</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                                Download Data
                                            </>
                                        )}
                                    </button>
                                    {downloadError && (
                                        <p className="text-red-500 text-sm mt-2 text-center">{downloadError}</p>
                                    )}
                                </div>
                            )}

                            {/* Ownership badge */}
                            {isOwner && (
                                <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                                    <p className="text-green-700 text-sm font-medium flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        You own this data asset
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Activities Tab */}
                        <div className="bg-white rounded-2xl shadow-md p-6">
                            <div className="flex gap-4 border-b border-gray-200 mb-4">
                                <button
                                    onClick={() => setActiveTab('activities')}
                                    className={`pb-3 px-4 font-semibold transition-colors ${activeTab === 'activities'
                                        ? 'text-gray-800 border-b-2 border-gray-800'
                                        : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    Activities
                                </button>

                                <button
                                    onClick={() => setActiveTab('owner')}
                                    className={`pb-3 px-4 font-semibold transition-colors ${activeTab === 'owner'
                                        ? 'text-gray-800 border-b-2 border-gray-800'
                                        : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    Owner
                                </button>
                            </div>

                            {/* Activities Content */}
                            {activeTab === 'activities' && (
                                <div className="space-y-4">
                                    {histories.length > 0 ? (
                                        histories.map((history, index) => (
                                            <div key={index} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${history.type === 'LISTED' ? 'bg-gradient-to-br from-blue-400 to-blue-600' :
                                                    history.type === 'SOLD' ? 'bg-gradient-to-br from-green-400 to-green-600' :
                                                        history.type === 'RELISTED' ? 'bg-gradient-to-br from-purple-400 to-purple-600' :
                                                            'bg-gradient-to-br from-red-400 to-red-600'
                                                    }`}>
                                                    {history.type === 'LISTED' ? '📝' :
                                                        history.type === 'SOLD' ? '✅' :
                                                            history.type === 'RELISTED' ? '🔄' :
                                                                '❌'}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold text-gray-800">
                                                        {history.type === 'LISTED' && `Listed for ${history.price} ETH`}
                                                        {history.type === 'SOLD' && `Sold for ${history.price} ETH`}
                                                        {history.type === 'RELISTED' && `Relisted for ${history.price} ETH`}
                                                        {history.type === 'CANCELED' && 'Listing canceled'}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {history.type === 'SOLD' ? 'Buyer' : 'Seller'}: {' '}
                                                        <span className="text-blue-600 font-mono">
                                                            {history.actor.slice(0, 6)}...{history.actor.slice(-4)}
                                                        </span>
                                                        {history.timestamp && (
                                                            <span className="ml-2">
                                                                • {new Date(history.timestamp * 1000).toLocaleString()}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-500 text-center py-4">No activities yet</p>
                                    )}
                                </div>
                            )}

                            {activeTab === 'owner' && (
                                <div className="text-gray-600">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white font-semibold">
                                            {nft.owner.slice(2, 3).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500">Current Owner</p>
                                            <p className="text-sm font-semibold text-gray-800 font-mono">
                                                {nft.owner === '0x0000000000000000000000000000000000000000'
                                                    ? 'Not sold yet'
                                                    : `${nft.owner.slice(0, 10)}...${nft.owner.slice(-8)}`}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
