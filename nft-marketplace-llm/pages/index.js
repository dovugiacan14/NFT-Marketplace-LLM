import { ethers } from 'ethers'
import { useEffect, useState } from 'react'
import web3 from 'web3'
import axios from 'axios'
import Web3Modal from "web3modal"
import Loading from '../components/Loading'
import Spinner from '../components/Spinner'
import { convert_src } from '../utils/utils'
import NFT from '../artifacts/contracts/NFT.sol/NFT.json'
import Market from '../artifacts/contracts/NFTMarket.sol/NFTMarket.json'
import Link from 'next/link';

const nftaddress = process.env.NEXT_PUBLIC_NFT_ADDRESS;
const nftmarketaddress = process.env.NEXT_PUBLIC_NFTMARKET_ADDRESS;

export default function Home() {
  const [nfts, setNfts] = useState([])
  const [loaded, setLoaded] = useState('not-loaded')
  const [purchasing, setPurchasing] = useState(null)

  useEffect(() => {
    loadNFTs()
  }, [])

  async function loadNFTs() {
    const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_ETH_NETWORK);
    const tokenContract = new ethers.Contract(nftaddress, NFT.abi, provider)
    const marketContract = new ethers.Contract(nftmarketaddress, Market.abi, provider)

    let data = [];
    try {
      data = await marketContract.fetchMarketItems()
    } catch (error) {
      console.error('Error fetching market items:', error)
      try {
        const itemCount = await marketContract._itemIds()
        const tempData = []
        for (let i = 1; i <= itemCount.toNumber(); i++) {
          try {
            const item = await marketContract.getMarketItem(i)
            if (item.owner === ethers.constants.AddressZero && item.price.gt(0)) {
              tempData.push(item)
            }
          } catch (err) {
            console.log(`Item ${i} not found or error:`, err)
          }
        }
        data = tempData
      } catch (fallbackError) {
        console.error('Fallback fetch also failed:', fallbackError)
        setLoaded('loaded')
        return
      }
    }

    const items = (
      await Promise.all(
        data.map(async (i) => {
          try {
            const tokenUri = await tokenContract.tokenURI(i.tokenId);
            const tokenUrl = convert_src(tokenUri);
            if (!tokenUrl) return null;
            const meta = await axios.get(tokenUrl);
            const price = web3.utils.fromWei(i.price.toString(), "ether");
            return {
              price,
              tokenId: i.tokenId.toNumber(),
              seller: i.seller,
              owner: i.owner,
              name: meta.data.name,
              description: meta.data.description,
              image: convert_src(meta.data.image),
            };
          } catch (error) {
            console.error("Failed to process tokenId:", i.tokenId.toString(), error);
            return null;
          }
        })
      )
    ).filter(Boolean);

    setNfts(items)
    setLoaded('loaded')
  }

  async function buyNft(nft) {
    try {
      setPurchasing(nft.tokenId)
      const web3Modal = new Web3Modal({
        network: "mainnet",
        cacheProvider: true,
      });
      const connection = await web3Modal.connect()
      const provider = new ethers.providers.Web3Provider(connection)
      const signer = provider.getSigner()
      const contract = new ethers.Contract(nftmarketaddress, Market.abi, signer)
      const price = web3.utils.toWei(nft.price.toString(), 'ether');
      const transaction = await contract.createMarketSale(nftaddress, nft.tokenId, {
        value: price
      })
      await transaction.wait()
      await loadNFTs()
    } catch (error) {
      console.error('Error purchasing NFT:', error)
      alert('Failed to purchase NFT. Please try again.')
    } finally {
      setPurchasing(null)
    }
  }

  if (loaded === 'not-loaded') return <Loading message="Loading NFTs..." />

  if (loaded === 'loaded' && !nfts.length) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <svg className="w-32 h-32 mx-auto text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-3">
          Chưa có NFT nào ở đây cả
        </h2>
        <p className="text-gray-600 mb-8">
          Hãy tạo NFT đầu tiên của bạn và bắt đầu hành trình trong thế giới NFT!
        </p>
        <Link href="/create-item">
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all duration-300 transform hover:scale-105 flex items-center gap-2 mx-auto">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo NFT ngay
          </button>
        </Link>
      </div>
    </div>
  )

  const cardColors = ['#F4ECC2', '#E8F5E9', '#FFF9C4', '#FFE0E0'];

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-7xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-8 pb-8">
          {nfts.map((nft, i) => (
            <div
              key={i}
              className="rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-shadow duration-300"
              style={{ backgroundColor: cardColors[i % cardColors.length] }}
            >
              <div className="relative p-4">
                <div className="absolute top-6 left-6 bg-gray-700 bg-opacity-60 rounded-full p-2">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="absolute top-6 right-6 bg-white rounded-full p-2 cursor-pointer hover:bg-gray-100">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <Link href={`/nft/${nft.tokenId}`}>
                  <img
                    src={nft.image}
                    className="rounded-2xl w-full h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    alt={nft.name}
                  />
                </Link>
              </div>
              <div className="px-4 pb-4">
                <div className="flex items-center mb-3 -mt-2">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 border-2 border-white"></div>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 border-2 border-white"></div>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-400 border-2 border-white"></div>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-teal-400 border-2 border-white"></div>
                  </div>
                  <span className="ml-3 text-sm text-gray-600 font-medium">99 in stock</span>
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-3">
                  {nft.name}
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Current Price</p>
                    <div className="inline-block border-2 border-green-500 rounded-lg px-3 py-1">
                      <p className="text-sm font-bold text-gray-800">{nft.price} ETH</p>
                    </div>
                  </div>
                  <button
                    onClick={() => buyNft(nft)}
                    className="bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={purchasing === nft.tokenId}
                  >
                    {purchasing === nft.tokenId ? (
                      <>
                        <Spinner size="sm" color="white" />
                        <span className="text-xs">Processing...</span>
                      </>
                    ) : (
                      <span className="text-xs">Buy NFT</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
